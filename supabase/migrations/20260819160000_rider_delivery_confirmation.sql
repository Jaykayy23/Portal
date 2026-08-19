-- Rider-confirmed completion.
--
-- Until now "Delivered" was ops ticking a dropdown on the strength of a phone
-- call. This adds proof from the person who actually carried the parcel: when
-- ops opens the Notify modal for an assigned delivery, the portal mints a
-- single-purpose link, the rider gets it in the same WhatsApp/SMS message, and
-- tapping it when the parcel is handed over flips the row to Delivered and
-- records the moment.
--
-- Why the link is a capability and not a login:
--
--   Riders have no portal account and no password to reset. A 256-bit random
--   token in the URL is the whole credential — it is scoped to one delivery, it
--   does exactly one thing, it expires, and it cannot be guessed. That is a much
--   smaller blast radius than issuing the fleet real accounts.
--
-- What stops a leaked link from doing damage: it can only mark one specific
-- delivery complete. It exposes no prices, no declared value, no other order,
-- and it stops working the moment the delivery is reassigned to another rider.

-- ---------------------------------------------------------------------------
-- deliveries.delivered_at
-- ---------------------------------------------------------------------------
-- Denormalised out of delivery_confirmations on purpose: the log and the export
-- want "when was this actually delivered" on every row without a join, and a row
-- that ops marked Delivered by hand legitimately has no confirmation at all.
-- Null therefore means "no rider confirmation", not "not delivered".
alter table public.deliveries
  add column delivered_at timestamptz;

comment on column public.deliveries.delivered_at is
  'When the rider confirmed completion via their link. Null if never confirmed by a rider.';

-- ---------------------------------------------------------------------------
-- delivery_confirmations — one row per issued link
-- ---------------------------------------------------------------------------
create table public.delivery_confirmations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,

  -- The sha256 of the token, never the token itself. The raw value is shown to
  -- ops once, at issue time, and lives only in the message they send. A dump of
  -- this table therefore hands an attacker nothing they can click.
  token_hash text not null,

  -- Who the link was issued for, snapshotted like the delivery's own rider
  -- columns. rider_id is the live check: if the delivery is later reassigned,
  -- the old rider's link stops working rather than confirming someone else's job.
  rider_id uuid references public.riders (id) on delete set null,
  rider_name text not null default '',
  rider_phone text not null default '',

  issued_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,

  constraint delivery_confirmations_expiry_after_issue check (expires_at > created_at)
);

-- The confirm path looks a link up by nothing but its hash, so this index is the
-- entire query plan for that request. Unique because two links can never share a
-- token, and the collision would otherwise be silent.
create unique index delivery_confirmations_token_hash_key
  on public.delivery_confirmations (token_hash);
-- Ops re-opening the Notify modal mints a fresh link rather than reusing one
-- (impossible — only the hash was kept), so a delivery accumulates a handful of
-- rows and this index serves "what is outstanding for this delivery".
create index delivery_confirmations_delivery_idx
  on public.delivery_confirmations (delivery_id, created_at desc);

comment on table public.delivery_confirmations is
  'One-delivery capability links sent to riders. Issued and redeemed only by the server''s service-role client.';

-- ---------------------------------------------------------------------------
-- RLS — the app_settings shape: enabled, and deliberately no policies
-- ---------------------------------------------------------------------------
-- Nobody redeems a link with a session: the rider is an anonymous visitor with a
-- token. That path has to run as service_role regardless, so rather than grant
-- `authenticated` an access it would never use, this table is closed to every
-- public role and reachable only through lib/deliveryConfirmation.ts, which
-- checks the caller is ops/admin before issuing.
alter table public.delivery_confirmations enable row level security;
alter table public.delivery_confirmations force row level security;

grant select, insert, update, delete on public.delivery_confirmations to service_role;
