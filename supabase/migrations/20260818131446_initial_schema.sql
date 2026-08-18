-- SomoExpress merchant delivery portal — initial schema.
--
-- Replaces the JSON-file database (data/db.json). Notable change from that
-- format: deliveries now link to a merchant by foreign key instead of by
-- matching the company name as a string, so renaming a merchant no longer
-- detaches their delivery history.
--
-- Identity lives in auth.users (Supabase Auth). public.profiles carries the
-- portal-specific fields: username, role, company name, phone, active flag.

-- ---------------------------------------------------------------------------
-- Helper schema for RLS predicates. Not exposed to the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- What people actually type at the login screen. The app appends the
  -- synthetic email domain before handing it to Supabase Auth.
  username text not null,
  role text not null,
  -- For merchants this is the corporate client's name (Jumia, Mr Wu). For
  -- admin/ops it mirrors the username, matching the original app's behaviour.
  company_name text not null,
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint profiles_role_check check (role in ('admin', 'ops', 'merchant')),
  -- Usernames are matched case-insensitively at login, so uniqueness has to be
  -- case-insensitive too or 'Jumia' and 'jumia' could both be created.
  constraint profiles_username_lower_check check (username = lower(username))
);

create unique index profiles_username_key on public.profiles (username);
-- Supports the ops/admin account list and the merchant lookup for notifications.
create index profiles_role_idx on public.profiles (role);

comment on table public.profiles is
  'Portal identity: role, company name and contact details for each auth user.';

-- ---------------------------------------------------------------------------
-- riders — the internal motorbike fleet
-- ---------------------------------------------------------------------------
create table public.riders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  reg_number text not null,
  model text not null,
  status text not null default 'Available',
  created_at timestamptz not null default now(),

  constraint riders_status_check check (status in ('Available', 'On delivery', 'Offline')),
  constraint riders_name_not_blank check (length(btrim(name)) > 0),
  constraint riders_phone_not_blank check (length(btrim(phone)) > 0),
  constraint riders_reg_not_blank check (length(btrim(reg_number)) > 0),
  constraint riders_model_not_blank check (length(btrim(model)) > 0)
);

comment on table public.riders is 'Internal rider fleet, managed by ops/admin.';

-- ---------------------------------------------------------------------------
-- deliveries — the delivery request log
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- The merchant this request belongs to. Every RLS check for merchants keys
  -- off this column.
  merchant_id uuid not null references public.profiles (id) on delete restrict,
  -- Company name captured at submission time, so the log still reads correctly
  -- if the merchant is later renamed.
  customer text not null,
  submitted_by uuid not null references public.profiles (id) on delete restrict,

  pickup text not null,
  dropoff text not null,
  distance numeric(8, 2) not null,
  type text not null default 'Standard',
  surcharges text[] not null default '{}',
  declared_value numeric(12, 2) not null,

  -- Money is numeric, never float — these are prices people argue about.
  recommended numeric(12, 2) not null,
  minimum numeric(12, 2) not null,
  agreed numeric(12, 2) not null,

  status text not null default 'Requested',

  -- Rider assignment. The snapshot columns are deliberately denormalised: a
  -- delivery record should still say who carried it and on what bike even if
  -- that rider's details are later edited. It also means merchants never need
  -- read access to the riders table at all.
  rider_id uuid references public.riders (id) on delete set null,
  rider_name text not null default '',
  rider_phone text not null default '',
  rider_reg text not null default '',
  rider_model text not null default '',

  constraint deliveries_type_check check (type in ('Standard', 'Express', 'Fragile')),
  constraint deliveries_status_check check (
    status in ('Requested', 'Requires approval', 'Approved', 'Assigned', 'Delivered')
  ),
  constraint deliveries_distance_positive check (distance > 0),
  constraint deliveries_declared_value_positive check (declared_value > 0),
  constraint deliveries_prices_non_negative check (
    recommended >= 0 and minimum >= 0 and agreed >= 0
  )
);

-- The log is always "newest first", scoped to a merchant for merchant users.
-- This composite index serves both that and the unscoped ops/admin view.
create index deliveries_merchant_created_idx
  on public.deliveries (merchant_id, created_at desc);
create index deliveries_created_idx on public.deliveries (created_at desc);
-- Foreign keys are not indexed automatically; these keep joins and the
-- ON DELETE SET NULL cascade from scanning the whole table.
create index deliveries_rider_id_idx on public.deliveries (rider_id);
create index deliveries_submitted_by_idx on public.deliveries (submitted_by);

comment on table public.deliveries is
  'Delivery requests. Prices are computed server-side; merchants see only their own rows.';

-- ---------------------------------------------------------------------------
-- pricing_params — single row of pricing configuration
-- ---------------------------------------------------------------------------
create table public.pricing_params (
  -- Singleton: the check constraint makes a second row impossible.
  id smallint primary key default 1,
  base numeric(12, 2) not null default 10,
  rate numeric(12, 2) not null default 6,
  min_fare numeric(12, 2) not null default 25,
  min_pct numeric(5, 2) not null default 85,
  ops_phone text not null default '',
  updated_at timestamptz not null default now(),

  constraint pricing_params_singleton check (id = 1),
  constraint pricing_params_min_pct_range check (min_pct >= 0 and min_pct <= 100),
  constraint pricing_params_non_negative check (base >= 0 and rate >= 0 and min_fare >= 0)
);

insert into public.pricing_params (id) values (1);

comment on table public.pricing_params is
  'Single row. Readable by every signed-in user (the quote preview needs it), writable by admin.';

-- ---------------------------------------------------------------------------
-- branding — the portal logo
-- ---------------------------------------------------------------------------
-- Split from app_settings because the login screen has to render the logo
-- before anyone is signed in. Keeping it in its own table means "readable by
-- anonymous visitors" never has to overlap with the provider secrets below.
create table public.branding (
  id smallint primary key default 1,
  logo_data_url text not null default '',
  updated_at timestamptz not null default now(),

  constraint branding_singleton check (id = 1)
);

insert into public.branding (id) values (1);

comment on table public.branding is
  'Single row. Logo is world-readable by design (it renders on the login screen).';

-- ---------------------------------------------------------------------------
-- app_settings — API keys
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1,
  maps_api_key text not null default '',
  whatsapp_otp_key text not null default '',
  sms_api_key text not null default '',
  other_keys jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),

  constraint app_settings_singleton check (id = 1)
);

insert into public.app_settings (id) values (1);

comment on table public.app_settings is
  'Single row of provider API keys. Admin-only: never exposed to anon or authenticated.';

-- ---------------------------------------------------------------------------
-- keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger pricing_params_touch_updated_at
  before update on public.pricing_params
  for each row execute function private.touch_updated_at();

create trigger branding_touch_updated_at
  before update on public.branding
  for each row execute function private.touch_updated_at();

create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function private.touch_updated_at();
