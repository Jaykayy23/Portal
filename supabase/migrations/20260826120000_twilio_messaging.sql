-- Twilio Programmable Messaging: the credentials, and who the messages come from.
--
-- Until now every alert left the portal through a human tapping a pre-filled
-- wa.me or sms: link in the Notify modal. lib/deliveryMessages.ts was written for
-- this moment — it composes the message list and has no opinion about who dials —
-- so wiring a provider in needs somewhere to keep that provider's credentials.
-- app_settings is that somewhere: granted to no public role, read only by the
-- service-role client, and already the home of every other provider key.
--
-- Why five columns rather than one more entry in `other_keys`:
--
--   other_keys is a free-form name/value list. It is the right place for a key
--   nothing in the code reads by name — an admin parks it there and a future
--   integration looks it up. Twilio is read by name, on a send path, and it needs
--   a *set* of values that only make sense together. Spelling them out means the
--   send path cannot mistake the API Key SID for the Account SID, the shapes can
--   be checked here as well as in the app, and "enabled" can be made to mean
--   something (see the twilio_ready constraint at the bottom).
--
-- Which of these are secret, because it decides what the Settings page shows:
--
--   twilio_auth_secret            IS the secret. Never leaves the server; the
--                                 Settings page only ever sees a mask.
--   everything else               identifiers. They grant nothing on their own,
--                                 and an admin needs to be able to read them
--                                 back to spot a mis-paste — a masked Account
--                                 SID would make a wrong one impossible to find.
alter table public.app_settings
  add column twilio_enabled boolean not null default false,
  add column twilio_account_sid text not null default '',
  add column twilio_api_key_sid text not null default '',
  add column twilio_auth_secret text not null default '',
  add column twilio_from_number text not null default '',
  add column twilio_messaging_service_sid text not null default '';

comment on column public.app_settings.twilio_enabled is
  'Master switch for automated SMS. Off leaves the credentials stored but dormant.';
comment on column public.app_settings.twilio_account_sid is
  'Twilio Account SID (AC…). Goes in the request path; an identifier, not a secret.';
comment on column public.app_settings.twilio_api_key_sid is
  'API Key SID (SK…). Blank means twilio_auth_secret is the account Auth Token instead.';
comment on column public.app_settings.twilio_auth_secret is
  'The API Key Secret, or the account Auth Token when twilio_api_key_sid is blank. Secret.';
comment on column public.app_settings.twilio_from_number is
  'Sender: a Twilio number in E.164, or an alphanumeric sender ID. Ignored when a Messaging Service is set.';
comment on column public.app_settings.twilio_messaging_service_sid is
  'Messaging Service SID (MG…). Preferred over twilio_from_number — Twilio picks the sender from the pool.';

-- ---------------------------------------------------------------------------
-- Shapes
-- ---------------------------------------------------------------------------
-- Twilio SIDs are a two-letter prefix and 32 hex characters, and the prefix says
-- which resource it is. Checking that here is not about trusting the app less —
-- lib/twilioConfig.ts checks the same thing and gives the admin a sentence they
-- can act on. It is about the one mistake that is otherwise invisible: an
-- Account SID pasted into the API Key SID box authenticates fine and then fails
-- with Twilio's own "authentication error", which sends whoever is debugging it
-- looking at the secret instead of at the box above it.
--
-- '' is allowed throughout: unconfigured is a legitimate state, and the default.
--
-- The sender is deliberately unconstrained. `From` accepts an E.164 number, a
-- short code, or an alphanumeric sender ID — and alphanumeric senders are how
-- most Ghanaian traffic is actually branded — so any pattern narrow enough to be
-- worth writing would reject something Twilio accepts. The app checks it, and
-- Twilio is the final authority either way.
alter table public.app_settings
  add constraint app_settings_twilio_account_sid_shape
    check (twilio_account_sid = '' or twilio_account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  add constraint app_settings_twilio_api_key_sid_shape
    check (twilio_api_key_sid = '' or twilio_api_key_sid ~ '^SK[0-9a-fA-F]{32}$'),
  add constraint app_settings_twilio_messaging_service_sid_shape
    check (twilio_messaging_service_sid = '' or twilio_messaging_service_sid ~ '^MG[0-9a-fA-F]{32}$');

-- ---------------------------------------------------------------------------
-- "Enabled" has to mean something
-- ---------------------------------------------------------------------------
-- Without this, twilio_enabled could be true over a half-filled row, and the
-- send path would have to re-derive "is this actually usable?" every time it ran
-- — in a place where getting it wrong means an alert that silently never arrives.
-- With it, the flag is the whole answer: enabled implies an account, a secret,
-- and somebody to send from.
--
-- The practical consequence is that clearing a credential while sending is on is
-- refused rather than quietly breaking it. saveTwilioSettingsAsAdmin() catches
-- that case first and says so in a sentence; this constraint is what makes sure
-- there is no other route to the same broken row.
alter table public.app_settings
  add constraint app_settings_twilio_ready
    check (
      not twilio_enabled
      or (
        twilio_account_sid <> ''
        and twilio_auth_secret <> ''
        and (twilio_from_number <> '' or twilio_messaging_service_sid <> '')
      )
    );
