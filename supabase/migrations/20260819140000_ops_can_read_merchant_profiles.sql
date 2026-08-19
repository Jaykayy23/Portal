-- Ops can see merchant accounts.
--
-- Ops now provisions merchant logins: they onboard the merchants, so waiting on
-- an admin to issue credentials was the bottleneck. What ops gets is deliberately
-- narrow — merchant rows only, never another ops or admin account.
--
-- Only SELECT is added here. Provisioning creates an auth user first and so runs
-- through the service-role client (lib/accounts.ts), which bypasses RLS entirely;
-- an ops INSERT policy would therefore be unused by the app while handing an ops
-- token the ability to write a profile row with no auth user behind it. The
-- Route Handler is what confines ops to role = 'merchant' on create, and the
-- existing admin-only INSERT/UPDATE policies stay exactly as they were.
create policy profiles_select_merchants_ops
  on public.profiles
  for select
  to authenticated
  using (
    (select private.portal_role()) = 'ops'
    and role = 'merchant'
  );

comment on policy profiles_select_merchants_ops on public.profiles is
  'Ops reads merchant accounts only — the list behind the ops Merchants tab.';
