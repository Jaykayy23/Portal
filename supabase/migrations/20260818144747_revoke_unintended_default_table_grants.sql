-- Tightens table privileges to match what the schema actually intends.
--
-- CORRECTION to a comment in 20260818131448_rls_policies.sql, which claims
-- "app_settings is deliberately NOT granted to anon or authenticated". Not
-- granting it turned out not to be the same as it not being granted: Supabase
-- sets ALTER DEFAULT PRIVILEGES on the public schema that hand anon and
-- authenticated INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on every
-- newly created table. So app_settings — which holds the WhatsApp and SMS provider
-- keys — was fully granted to both roles.
--
-- No data was exposed. RLS is enabled on app_settings with zero policies, so reads
-- returned [] and writes affected zero rows (verified against the live project:
-- an anonymous PATCH setting sms_api_key='pwned' returned 204 and changed
-- nothing — PostgREST reports 204 for a zero-row update just as it does for a
-- successful one, which is worth remembering when testing this sort of thing).
--
-- But it means RLS was the only thing standing there, not the second line of
-- defence the comment described. This migration removes the grants so both layers
-- are real.

-- Start from nothing for the two public roles, then re-grant exactly what the app
-- uses. Stated positively so the intended surface is readable in one place.
revoke all on public.profiles       from anon, authenticated;
revoke all on public.riders         from anon, authenticated;
revoke all on public.deliveries     from anon, authenticated;
revoke all on public.pricing_params from anon, authenticated;
revoke all on public.branding       from anon, authenticated;
revoke all on public.app_settings   from anon, authenticated;

-- anon: the login screen renders the portal logo before anyone signs in. That is
-- the entire anonymous surface — anon never writes anything, anywhere.
grant select on public.branding to anon;

-- authenticated: RLS decides which rows; these decide which verbs. No DELETE and
-- no TRUNCATE anywhere, because nothing in the portal deletes a record — accounts
-- are deactivated, riders are set Offline, deliveries are marked Delivered.
grant select, update         on public.branding       to authenticated;
grant select, update         on public.pricing_params to authenticated;
grant select, insert, update on public.profiles       to authenticated;
grant select, insert, update on public.riders         to authenticated;
grant select, insert, update on public.deliveries     to authenticated;

-- app_settings gets nothing: the provider secrets are only ever read by the
-- server's service-role client, after the caller has been checked as admin.

-- Not touching ALTER DEFAULT PRIVILEGES for tables. A future table added through
-- the dashboard would pick the broad grants up again, but the `ensure_rls` event
-- trigger enables RLS on it automatically, so it stays closed by default. Changing
-- the schema default would instead make new tables silently unreachable and be a
-- confusing thing to debug months from now.
