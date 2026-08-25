-- Deactivating an account locks it out of the database, not just out of the app.
--
-- Until now the `active` flag was checked in exactly one place: getSessionUser()
-- in lib/session.ts, which re-reads the profile row on every request. That is a
-- real guarantee for every path that goes through the Next.js app, and it is not
-- a guarantee at all for the path that does not.
--
-- Sign-in happens in the browser, through @supabase/ssr's browser client, so the
-- session cookies have to be readable by page JavaScript. The publishable key is
-- in the client bundle by design. So a signed-in user can lift their own access
-- token and call PostgREST directly. Nothing in this schema was stopping them:
-- every policy read the role out of the JWT's app_metadata and asked no further
-- questions.
--
-- Banning the auth user does not close that. A ban stops refresh and stops new
-- sign-ins; it cannot invalidate a JWT that has already been issued, because
-- verification is a local signature check against the project's JWKS. With
-- jwt_expiry at 3600 that leaves a deactivated ops, finance or admin account up
-- to an hour of continued read access — and, through record_settlement, up to an
-- hour of continued write access to the remittance book.
--
-- So the flag moves into the policies, and the authoritative profile row decides
-- rather than a claim minted minutes ago.
--
-- ---------------------------------------------------------------------------
-- Why a boolean-only helper
-- ---------------------------------------------------------------------------
-- private.is_active_profile() returns true or false and nothing else. It is not
-- a "read my profile" function: no row, no role, no company name leaves it, so
-- exposing it to `authenticated` — which policy evaluation requires — adds no
-- readable surface. It lives in `private`, which is not exposed to the Data API,
-- and EXECUTE is granted to exactly one role.
--
-- SECURITY DEFINER, and it works whether or not the definer bypasses RLS. That
-- is deliberate, because the answer depends on the function owner's BYPASSRLS
-- attribute and this migration should not depend on it:
--
--   owner bypasses RLS    the read is unfiltered. Fine.
--   owner does not        the read is subject to the profiles policies. It asks
--                         only for `p.id = auth.uid()`, which
--                         profiles_select_own_or_admin already permits for
--                         every caller. Also fine.
--
-- Either way a caller with no profile row at all — a self-registered auth user,
-- see the signup change in supabase/config.toml — gets false, which is what
-- closes the two `using (true)` policies below to them.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT changed, and why
-- ---------------------------------------------------------------------------
-- The five policies on `public.profiles` keep reading only the JWT role. A
-- policy on profiles cannot call a helper that reads profiles: the inner read is
-- evaluated against the same policies, which call the helper again, and Postgres
-- stops it with `infinite recursion detected in policy for relation "profiles"`.
-- Adding the check there would take the whole portal down, not tighten it.
--
-- The residual is bounded and worth stating plainly: for up to one token
-- lifetime, a deactivated admin can still read the account list through the Data
-- API, and a deactivated ops or finance account can still read merchant profile
-- rows. Usernames, company names, phone numbers and roles — no credentials, and
-- no deliveries, settlements or money. Closing it needs the active flag
-- somewhere a profiles policy can reach without recursing, which is a schema
-- change rather than a policy change. Track it with the actor/session work in
-- the production-hardening plan.
--
-- `branding_select_everyone` also stays as it is. It is granted to `anon`
-- because the login screen renders the portal logo before anyone has a session,
-- which is the one genuinely public read in this schema.

-- ---------------------------------------------------------------------------
-- The helper
-- ---------------------------------------------------------------------------
create or replace function private.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.active
  )
$$;

comment on function private.is_active_profile() is
  'True when the caller has a profile row and it is active. Boolean only — no profile data reaches the Data API through it.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so the revoke is not
-- decorative. `authenticated` needs it because policy expressions are evaluated
-- with the querying role's privileges; `anon` does not, because every policy
-- below is scoped `to authenticated`.
revoke execute on function private.is_active_profile() from public, anon;
grant execute on function private.is_active_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
drop policy if exists deliveries_select_own_or_ops on public.deliveries;

create policy deliveries_select_own_or_ops
  on public.deliveries
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (
      merchant_id = (select auth.uid())
      or (select private.portal_role()) in ('admin', 'ops')
    )
  );

comment on policy deliveries_select_own_or_ops on public.deliveries is
  'A merchant reads their own rows, ops and admin read every row. Active accounts only.';

drop policy if exists deliveries_select_finance on public.deliveries;

create policy deliveries_select_finance
  on public.deliveries
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'finance'
  );

comment on policy deliveries_select_finance on public.deliveries is
  'Finance reads every delivery. Read-only, and active accounts only.';

drop policy if exists deliveries_insert_own_or_ops on public.deliveries;

create policy deliveries_insert_own_or_ops
  on public.deliveries
  for insert
  to authenticated
  with check (
    (select private.is_active_profile())
    and submitted_by = (select auth.uid())
    and (
      (
        (select private.portal_role()) = 'merchant'
        and merchant_id = (select auth.uid())
      )
      or (select private.portal_role()) in ('admin', 'ops')
    )
  );

drop policy if exists deliveries_update_ops_admin on public.deliveries;

create policy deliveries_update_ops_admin
  on public.deliveries
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  );

drop policy if exists deliveries_update_merchant_pickup on public.deliveries;

create policy deliveries_update_merchant_pickup
  on public.deliveries
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Assigned'
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Picked up'
  );

comment on policy deliveries_update_merchant_pickup on public.deliveries is
  'An active merchant may move their own assigned delivery to Picked up, and nothing else.';

-- ---------------------------------------------------------------------------
-- riders
-- ---------------------------------------------------------------------------
drop policy if exists riders_select_ops_admin on public.riders;

create policy riders_select_ops_admin
  on public.riders
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  );

drop policy if exists riders_insert_ops_admin on public.riders;

create policy riders_insert_ops_admin
  on public.riders
  for insert
  to authenticated
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  );

drop policy if exists riders_update_ops_admin on public.riders;

create policy riders_update_ops_admin
  on public.riders
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- pricing_params
-- ---------------------------------------------------------------------------
-- Two changes here, not one. The active check, and closing `using (true)`.
--
-- The old policy read `using (true)` for `authenticated`, on the reasoning that
-- every signed-in role needs the fares for the quote preview. That reasoning is
-- right about the roles and wrong about the audience: `authenticated` is not the
-- set of portal accounts, it is the set of anyone holding a valid Supabase token
-- for this project. With signup open — which it was, see supabase/config.toml —
-- that included anyone on the internet who called /auth/v1/signup, and this
-- table holds the base fare, the per-km and per-minute rates, the minimum fare,
-- the ops phone number, and every surge charge with its amount.
--
-- Naming the four roles fixes that without narrowing it for anyone who should
-- have it. A token carrying no portal_role now reads nothing.
drop policy if exists pricing_params_select_authenticated on public.pricing_params;

create policy pricing_params_select_authenticated
  on public.pricing_params
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops', 'merchant', 'finance')
  );

comment on policy pricing_params_select_authenticated on public.pricing_params is
  'Every active portal account reads pricing — merchants need it for the quote preview. A token with no portal role reads nothing.';

drop policy if exists pricing_params_update_admin on public.pricing_params;

create policy pricing_params_update_admin
  on public.pricing_params
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- delivery_options
-- ---------------------------------------------------------------------------
-- The same `using (true)` and the same reasoning as pricing_params above. Less
-- sensitive on its own — it is a list of item categories — but it is the second
-- half of what an unauthorised token could read, and it closes the same way.
drop policy if exists delivery_options_select_authenticated on public.delivery_options;

create policy delivery_options_select_authenticated
  on public.delivery_options
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops', 'merchant', 'finance')
  );

comment on policy delivery_options_select_authenticated on public.delivery_options is
  'Every active portal account reads the item category list to pick from it. A token with no portal role reads nothing.';

drop policy if exists delivery_options_update_admin on public.delivery_options;

create policy delivery_options_update_admin
  on public.delivery_options
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- branding
-- ---------------------------------------------------------------------------
-- Only the write. The anonymous read stays exactly as it is: the login screen
-- renders the logo before anyone has a session.
drop policy if exists branding_update_admin on public.branding;

create policy branding_update_admin
  on public.branding
  for update
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  )
  with check (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- settlements and settlement_lines
-- ---------------------------------------------------------------------------
-- Reads only. Both tables are written exclusively by record_settlement and
-- void_settlement, which grow their own active check in the next migration.
drop policy if exists settlements_select_money_roles on public.settlements;

create policy settlements_select_money_roles
  on public.settlements
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops', 'finance')
  );

drop policy if exists settlements_select_own_merchant on public.settlements;

create policy settlements_select_own_merchant
  on public.settlements
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
  );

drop policy if exists settlement_lines_select_money_roles on public.settlement_lines;

create policy settlement_lines_select_money_roles
  on public.settlement_lines
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) in ('admin', 'ops', 'finance')
  );

drop policy if exists settlement_lines_select_own_delivery on public.settlement_lines;

create policy settlement_lines_select_own_delivery
  on public.settlement_lines
  for select
  to authenticated
  using (
    (select private.is_active_profile())
    and (select private.portal_role()) = 'merchant'
    and exists (
      select 1
        from public.deliveries d
       where d.id = settlement_lines.delivery_id
         and d.merchant_id = (select auth.uid())
    )
  );
