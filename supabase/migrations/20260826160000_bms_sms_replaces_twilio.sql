-- SMS moves from Twilio to BMS (developer.bms.africa, mNotify's API).
--
-- Twilio was wired up first and never configured — no credential was ever
-- entered, which is why the six twilio_* columns are dropped outright below
-- rather than left behind as dead schema. If you are applying this to a database
-- where somebody did fill them in, take a copy of the row first: DROP COLUMN
-- takes the values with it.
--
-- --- why the new columns are named sms_*, not bms_* -------------------------
--
-- Because this migration is the second one to answer the same question, and the
-- lesson is cheap to learn once. The portal sends one channel's worth of SMS. It
-- does not care which company carries it, and naming the columns after the
-- carrier means every future swap costs a migration, a type regeneration and a
-- rename through eleven files — which is exactly what this one is.
--
-- sms_api_key already existed as a generic placeholder ("e.g. Twilio / Africa's
-- Talking API key") that nothing read. It is now the real thing, which is why it
-- is reused rather than joined by a near-duplicate: two columns that both look
-- like the SMS key is a worse problem than one column whose comment has changed.
--
-- --- what BMS needs ---------------------------------------------------------
--
--   sms_api_key    the whole credential. BMS takes it as a query parameter on
--                  every request (?key=…), so there is no SID/secret pair and
--                  nothing to scope — the key IS the account. Secret, and the
--                  only field here that is.
--   sms_sender_id  who the message appears to come from. Up to 11 characters,
--                  and it has to be registered and approved by BMS before it
--                  will send — an unapproved sender is the failure that looks
--                  like a broken integration. Not a secret.
--
-- Note what is absent: no sending number. BMS sends from a sender ID only, so
-- there is no equivalent of a Twilio number and no reply path. Every alert this
-- portal sends carries a tap-through link rather than asking for a text back, so
-- that costs nothing here — but it is why nobody should reply to these.

-- ---------------------------------------------------------------------------
-- 1. Out with Twilio
-- ---------------------------------------------------------------------------
-- Constraints first and by name, even though DROP COLUMN would take them anyway:
-- naming them is what makes this migration readable as a record of what was
-- removed, rather than leaving a future reader to infer it.
--
-- `if exists` throughout, deliberately. This has to apply cleanly to a database
-- that got the Twilio migration and to one that never did — the two differ by
-- minutes in this project's history, and a migration that only works on one of
-- them is a migration that strands whichever deploy guessed wrong.
alter table public.app_settings
  drop constraint if exists app_settings_twilio_ready,
  drop constraint if exists app_settings_twilio_account_sid_shape,
  drop constraint if exists app_settings_twilio_api_key_sid_shape,
  drop constraint if exists app_settings_twilio_messaging_service_sid_shape;

alter table public.app_settings
  drop column if exists twilio_enabled,
  drop column if exists twilio_account_sid,
  drop column if exists twilio_api_key_sid,
  drop column if exists twilio_auth_secret,
  drop column if exists twilio_from_number,
  drop column if exists twilio_messaging_service_sid;

-- ---------------------------------------------------------------------------
-- 2. In with BMS
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column sms_enabled boolean not null default false,
  add column sms_sender_id text not null default '';

comment on column public.app_settings.sms_api_key is
  'BMS (mNotify) API key. Sent as the ?key= query parameter on every request. Secret.';
comment on column public.app_settings.sms_sender_id is
  'BMS sender ID, at most 11 characters. Must be registered and approved in the BMS dashboard.';
comment on column public.app_settings.sms_enabled is
  'Master switch for automated SMS. Off leaves the credentials stored but dormant.';

-- BMS's own limit, checked here as well as in the app. Eleven characters is not
-- a guess or a safety margin — it is the field width, and a twelfth character is
-- rejected at send time with a validation error rather than truncated.
alter table public.app_settings
  add constraint app_settings_sms_sender_id_length
    check (char_length(sms_sender_id) <= 11);

-- ---------------------------------------------------------------------------
-- 3. "Enabled" has to mean something
-- ---------------------------------------------------------------------------
-- Carried over from the Twilio migration, because the reasoning did not depend
-- on the provider. Without this the flag could sit true over a half-filled row
-- and the send path would have to re-derive "is this actually usable?" every
-- time it ran — in a place where getting it wrong means an alert that silently
-- never arrives. With it, the flag is the whole answer.
--
-- The practical consequence is that clearing the key while sending is on is
-- refused rather than quietly breaking it. saveSmsSettingsAsAdmin() catches that
-- first and says so in a sentence; this is what makes sure there is no other
-- route to the same broken row.
alter table public.app_settings
  add constraint app_settings_sms_ready
    check (
      not sms_enabled
      or (sms_api_key <> '' and sms_sender_id <> '')
    );
