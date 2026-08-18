-- Silences two Security Advisor warnings:
--   0028_anon_security_definer_function_executable
--   0029_authenticated_security_definer_function_executable
--
-- Both point at public.rls_auto_enable(), the SECURITY DEFINER function behind
-- the `ensure_rls` event trigger, which auto-enables RLS on any table created in
-- the public schema. The function is not created by this project — it predates
-- these migrations — but it lives in this database, so the fix belongs here where
-- it is version-controlled and survives a restore.
--
-- Why it was flagged: Supabase sets default privileges that grant EXECUTE on
-- every new function in `public` to anon, authenticated and service_role. That
-- applies to this function too, so PostgREST advertises it at
-- /rest/v1/rpc/rls_auto_enable.
--
-- Practical risk was nil — a function returning `event_trigger` cannot be invoked
-- through PostgREST (verified: the endpoint returns
-- 400 "cannot display a value of type event_trigger"), and
-- pg_event_trigger_ddl_commands() errors outside event-trigger context anyway.
-- Revoking is still correct on least-privilege grounds and costs nothing.
--
-- Revoking EXECUTE does NOT disable the event trigger. Event triggers are invoked
-- by the DDL machinery as the function owner; the privilege check happens at
-- CREATE EVENT TRIGGER time, not per firing.
--
-- Guarded so this migration is a no-op on a project where the function is absent
-- (a fresh project, or if Supabase stops installing it).
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    revoke execute on function public.rls_auto_enable()
      from public, anon, authenticated;
    raise notice 'revoked EXECUTE on public.rls_auto_enable() from public, anon, authenticated';
  else
    raise notice 'public.rls_auto_enable() not present — nothing to revoke';
  end if;
end $$;

-- Deliberately NOT changing the schema-wide default here:
--
--   alter default privileges in schema public
--     revoke execute on functions from anon, authenticated;
--
-- It would prevent a recurrence, but it also means any future function you add to
-- `public` and legitimately want to call over RPC would silently 404 for signed-in
-- users until you granted EXECUTE by hand. Keeping this project's own helpers in
-- the unexposed `private` schema addresses the same risk without that trap.
