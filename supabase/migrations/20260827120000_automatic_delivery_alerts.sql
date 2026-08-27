-- Alerts stop waiting for somebody to press a button.
--
-- Until now every message this portal sends was dispatched by a person: ops
-- assigns a rider, a modal opens, they press "Send by SMS". The wording, the
-- capability link and the sending were all already server-side — the only thing
-- the human contributed was the decision to send, and that decision was never
-- actually theirs to make. A rider who has been offered a job is always told. A
-- recipient whose parcel has been collected is always told. The modal was a
-- prompt for a step with one correct answer.
--
-- So the portal now sends on the transition itself, and the modal becomes what
-- it should always have been: the place you go when something did not arrive, or
-- when SMS is switched off entirely and WhatsApp is the channel.
--
-- Two things in the schema had to give way for that.

-- ---------------------------------------------------------------------------
-- 1. A link can now be minted by nobody
-- ---------------------------------------------------------------------------
-- `issued_by` was `not null references profiles(id)` because every link used to
-- be minted inside a request from a signed-in ops user. Three of the six
-- transitions are no longer like that: a rider tapping accept, a recipient
-- confirming receipt and a rider closing a job are all anonymous requests
-- carrying a capability token and no session at all — and each of them is
-- immediately followed by an alert that has to carry the *next* link.
--
-- The honest record of who minted that link is "the portal did, on its own", and
-- null is how this table says that. The alternative — attributing it to the
-- merchant or to whoever last touched the row — would put a name in an audit
-- column that did not do the thing.
alter table public.delivery_links
  alter column issued_by drop not null;

comment on column public.delivery_links.issued_by is
  'The portal user who minted this link, or null when the portal minted it itself as part of an automatic alert. Automatic mints follow a status change that no signed-in user necessarily caused.';

-- ---------------------------------------------------------------------------
-- 2. delivery_notifications — what was sent, to whom, and whether it landed
-- ---------------------------------------------------------------------------
-- An automatic send has no one watching it. The result used to go straight back
-- to the person who pressed the button; now the send happens after the response
-- has gone, so unless it is written down, "the rider says he was never told"
-- has no answer.
--
-- This is a log, not a lock. It is deliberately NOT unique on
-- (delivery_id, event, message_id): duplicate suppression is done upstream, by
-- only firing an alert when a delivery genuinely changes status, and every one
-- of those writes is anchored so exactly one concurrent request can win it (see
-- patchDelivery, confirmPickup and redeemLink). A unique index here would look
-- like a safety net and would actually be a trap — a rider who declines a job
-- and is then offered the same job again must be texted twice, and a constraint
-- could not tell that apart from a double send.
create table public.delivery_notifications (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,

  -- The lifecycle moment being announced — NotifyTrigger in
  -- lib/deliveryMessages.ts ('created', 'offered', 'accepted', …). Named `event`
  -- rather than `trigger` because the latter is a reserved word in Postgres and
  -- a column that has to be quoted forever is a poor trade for one word.
  event text not null,
  -- OutboundMessage.id — which of that moment's messages this row is.
  message_id text not null,

  -- Snapshotted rather than joined: the ops number can be changed in Settings
  -- and a rider can be swapped off a delivery, and this table's job is to say
  -- what was sent at the time, not what would be sent now.
  who text not null default '',
  phone text not null default '',

  -- False for a re-send from the Notify modal. The distinction is the first
  -- question anyone asks of this table: did the portal fail to tell them, or did
  -- someone tell them twice?
  automatic boolean not null default true,
  -- Null for an automatic send. There is no user behind one.
  sent_by uuid references public.profiles (id) on delete set null,

  ok boolean not null default false,
  -- BMS's campaign id, which is what their support and their delivery reports
  -- are looked up by. Empty when the send never reached them.
  campaign_id text not null default '',
  parts integer not null default 0,
  -- The provider's or the portal's account of the failure. Empty when ok.
  error text not null default '',

  created_at timestamptz not null default now()
);

-- The only query: "what has been sent for this delivery", newest first, which
-- the Notify modal asks on open so it can show what already went out instead of
-- offering a button that would send it again.
create index delivery_notifications_delivery_idx
  on public.delivery_notifications (delivery_id, created_at desc);

comment on table public.delivery_notifications is
  'One row per SMS this portal attempted for a delivery, automatic or re-sent by hand. Written and read only by the server''s service-role client.';
comment on column public.delivery_notifications.event is
  'The lifecycle moment announced — matches NotifyTrigger in lib/deliveryMessages.ts.';
comment on column public.delivery_notifications.automatic is
  'True when the portal sent this on a status change; false for a re-send from the Notify modal.';

-- ---------------------------------------------------------------------------
-- RLS — the delivery_links shape: enabled, and deliberately no policies
-- ---------------------------------------------------------------------------
-- The rows are written from after() callbacks and from anonymous link
-- redemptions, neither of which has a session for a policy to describe. Reads
-- go through lib/autoNotify.ts, which the Notify route calls only after
-- requireUser() — and the delivery itself is fetched under RLS in the same
-- handler, so a merchant asking about someone else's delivery is turned away
-- before this table is reached.
--
-- The `ensure_rls` event trigger enables RLS on new public tables by itself;
-- stating it here means the intent survives a project where that trigger is
-- absent.
alter table public.delivery_notifications enable row level security;
alter table public.delivery_notifications force row level security;

-- And the counterpart to that: Supabase's default privileges hand anon and
-- authenticated every verb on a newly created table (see the
-- revoke-unintended-default-grants migration for how that was found). RLS with
-- no policies already reduces both to nothing, but the grant should not be there
-- to begin with.
revoke all on public.delivery_notifications from anon, authenticated;
grant select, insert, update, delete on public.delivery_notifications to service_role;
