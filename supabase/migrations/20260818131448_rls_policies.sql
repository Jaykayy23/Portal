-- Row Level Security for the SomoExpress portal.
--
-- The original app enforced "a merchant sees only their own deliveries" in
-- application code. These policies move that guarantee into Postgres, so a
-- forgotten filter in a Route Handler can no longer leak another merchant's
-- data.
--
-- Role source: the portal role is read from the JWT's app_metadata, NOT
-- user_metadata. user_metadata is user-editable in Supabase and must never be
-- trusted for authorization. Reading it from the token also avoids the infinite
-- recursion you get when profiles' own policies need to query profiles.
--
-- Because JWT claims only refresh when the token does, a role change takes
-- effect on the user's next token refresh. Locking someone out immediately is
-- handled separately: the app bans the auth user and flips profiles.active,
-- and the server re-reads that flag on every request.
--
-- Note: since 2026-04-28 Supabase no longer auto-exposes new tables to the Data
-- API, so the GRANTs below are required, not decorative.

-- ---------------------------------------------------------------------------
-- Role helper
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: this reads only the caller's own token and
-- touches no tables, so it needs no elevated privileges.
create or replace function private.portal_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'portal_role', '')
$$;

comment on function private.portal_role() is
  'The caller''s portal role (admin | ops | merchant) from JWT app_metadata, or empty string.';

-- Policy expressions are evaluated with the querying user's privileges, so the
-- roles that hit these policies need EXECUTE on any function the policy calls.
grant usage on schema private to authenticated, anon;
grant execute on function private.portal_role() to authenticated, anon;

-- Postgres grants EXECUTE to PUBLIC by default on every new function, so the
-- trigger helper from the previous migration is callable by anyone. It is
-- SECURITY INVOKER and useless outside a trigger, but least privilege says
-- close it anyway.
revoke execute on function private.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable (and force) RLS everywhere in the exposed schema
-- ---------------------------------------------------------------------------
-- FORCE also subjects the table owner to these policies. Roles with BYPASSRLS
-- (service_role) still bypass, which is what the admin-only server paths use.
alter table public.profiles        enable row level security;
alter table public.profiles        force row level security;
alter table public.riders          enable row level security;
alter table public.riders          force row level security;
alter table public.deliveries      enable row level security;
alter table public.deliveries      force row level security;
alter table public.pricing_params  enable row level security;
alter table public.pricing_params  force row level security;
alter table public.branding        enable row level security;
alter table public.branding        force row level security;
alter table public.app_settings    enable row level security;
alter table public.app_settings    force row level security;

-- ---------------------------------------------------------------------------
-- Grants — table-level reachability. RLS then decides which rows.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- The logo renders on the login screen, before anyone signs in.
grant select on public.branding to anon, authenticated;
grant update on public.branding to authenticated;

grant select on public.profiles to authenticated;
grant insert, update on public.profiles to authenticated;

grant select, insert, update on public.riders to authenticated;
grant select, insert, update on public.deliveries to authenticated;

grant select, update on public.pricing_params to authenticated;

-- app_settings is deliberately NOT granted to anon or authenticated. The
-- WhatsApp/SMS provider keys live here; only the server's service-role client
-- ever reads them. RLS is still enabled above as a second line of defence.

-- Explicit for service_role rather than relying on default privileges, since
-- the 2026-04-28 change altered what new tables are reachable by default.
grant select, insert, update, delete on
  public.profiles, public.riders, public.deliveries,
  public.pricing_params, public.branding, public.app_settings
  to service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Everyone can read their own row; admins can read the whole account list.
create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.portal_role()) = 'admin'
  );

create policy profiles_insert_admin
  on public.profiles
  for insert
  to authenticated
  with check ((select private.portal_role()) = 'admin');

-- WITH CHECK as well as USING, otherwise an admin-shaped request could rewrite
-- a row into a state the policy would not have allowed it to select.
create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using ((select private.portal_role()) = 'admin')
  with check ((select private.portal_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- riders
-- ---------------------------------------------------------------------------
-- Merchants get no access at all: the rider details they need are snapshotted
-- onto their own delivery rows.
create policy riders_select_ops_admin
  on public.riders
  for select
  to authenticated
  using ((select private.portal_role()) in ('admin', 'ops'));

create policy riders_insert_ops_admin
  on public.riders
  for insert
  to authenticated
  with check ((select private.portal_role()) in ('admin', 'ops'));

create policy riders_update_ops_admin
  on public.riders
  for update
  to authenticated
  using ((select private.portal_role()) in ('admin', 'ops'))
  with check ((select private.portal_role()) in ('admin', 'ops'));

-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
-- The core isolation guarantee: a merchant's rows are those where they are the
-- merchant. Ops and admin see everything.
create policy deliveries_select_own_or_ops
  on public.deliveries
  for select
  to authenticated
  using (
    merchant_id = (select auth.uid())
    or (select private.portal_role()) in ('admin', 'ops')
  );

-- A merchant may only file under their own id. Ops/admin may file on behalf of
-- any merchant. Whoever inserts is always recorded as the submitter — nobody
-- can attribute a request to someone else.
create policy deliveries_insert_own_or_ops
  on public.deliveries
  for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and (
      (
        (select private.portal_role()) = 'merchant'
        and merchant_id = (select auth.uid())
      )
      or (select private.portal_role()) in ('admin', 'ops')
    )
  );

-- Only ops/admin move a request along or assign a rider. A merchant can create
-- a request but never edit one — including their own.
create policy deliveries_update_ops_admin
  on public.deliveries
  for update
  to authenticated
  using ((select private.portal_role()) in ('admin', 'ops'))
  with check ((select private.portal_role()) in ('admin', 'ops'));

-- ---------------------------------------------------------------------------
-- pricing_params
-- ---------------------------------------------------------------------------
-- Every signed-in role reads pricing: merchants need it for the live quote
-- preview. Only admin writes it.
create policy pricing_params_select_authenticated
  on public.pricing_params
  for select
  to authenticated
  using (true);

create policy pricing_params_update_admin
  on public.pricing_params
  for update
  to authenticated
  using ((select private.portal_role()) = 'admin')
  with check ((select private.portal_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- branding
-- ---------------------------------------------------------------------------
-- Genuinely public: the login screen needs the logo pre-authentication.
create policy branding_select_everyone
  on public.branding
  for select
  to anon, authenticated
  using (true);

create policy branding_update_admin
  on public.branding
  for update
  to authenticated
  using ((select private.portal_role()) = 'admin')
  with check ((select private.portal_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- app_settings — no policies on purpose
-- ---------------------------------------------------------------------------
-- RLS is enabled with zero policies, so anon and authenticated are denied even
-- if a future GRANT is added by mistake. Only service_role (BYPASSRLS) reads it.
