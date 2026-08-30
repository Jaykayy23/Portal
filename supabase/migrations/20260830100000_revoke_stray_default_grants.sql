-- The rest of the unintended default grants.
--
-- 20260818144747_revoke_unintended_default_table_grants.sql closed this on the
-- six tables that existed when it was written, and explained why: Supabase sets
-- ALTER DEFAULT PRIVILEGES on the public schema that hand anon and authenticated
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on every newly created
-- table. It also decided, deliberately, not to change that schema default —
-- a table added through the dashboard would then be silently unreachable, which
-- is a worse thing to debug months later.
--
-- The cost of that decision is that this recurs with every new table, and it
-- did. Six tables created in the days after it went in picked the grants up
-- again and nobody revoked them:
--
--   settlements, settlement_lines   REFERENCES, TRIGGER, TRUNCATE  (both roles)
--   delivery_links                  REFERENCES, TRIGGER, TRUNCATE  (both roles)
--   delivery_options                REFERENCES, TRIGGER, TRUNCATE  (both roles)
--   rate_limits, idempotency_keys   REFERENCES, TRIGGER, TRUNCATE  (both roles)
--
-- The later tables show the discipline arriving: delivery_notifications and
-- user_activity both revoke explicitly in their own migrations, and so does
-- portal_pulse. This file catches up the ones in between.
--
-- --- what is actually at risk ------------------------------------------------
--
-- Not much today, which is presumably why it went unnoticed for a fortnight.
-- The Data API exposes no TRUNCATE verb, so none of this is reachable from a
-- browser as things stand. But TRUNCATE is not a row operation and RLS does not
-- apply to it, so on these tables RLS is not a second line of defence — it is
-- the only line, exactly the situation the earlier migration was written to
-- correct. Two of them are the money ledger.
--
-- --- what this does not touch ------------------------------------------------
--
-- service_role keeps what it has. It has BYPASSRLS, so for that role the grant
-- is always the only layer and narrowing it is a real hardening — settlements
-- and settlement_lines in particular are documented as "written only by
-- record_settlement() / void_settlement()", both SECURITY DEFINER, so neither
-- needs service_role to hold INSERT or UPDATE at all. That is a separate change
-- from this one: it is a behavioural claim about every server write path rather
-- than a clerical correction, and it deserves a test that records and voids a
-- settlement end to end rather than a grep. Left alone on purpose, not missed.

-- ---------------------------------------------------------------------------
-- Start from nothing for the two browser-reachable roles
-- ---------------------------------------------------------------------------
revoke all on public.settlements       from anon, authenticated;
revoke all on public.settlement_lines  from anon, authenticated;
revoke all on public.delivery_links    from anon, authenticated;
revoke all on public.delivery_options  from anon, authenticated;
revoke all on public.rate_limits       from anon, authenticated;
revoke all on public.idempotency_keys  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-grant exactly what the app uses, stated positively
-- ---------------------------------------------------------------------------
-- Each line below has a matching RLS policy, and every policy on these tables
-- has a matching line. That is the property worth keeping: a granted verb with
-- no policy is a hole waiting for someone to add one, and a policy with no
-- granted verb is dead code that reads like protection.

-- The ledger, read through the caller's own session so the SELECT policies
-- decide whose figures come back. No write verbs: record_settlement() and
-- void_settlement() are SECURITY DEFINER and are the only way in, which is what
-- keeps the one-obligation-one-leg rules unavoidable rather than merely usual.
grant select on public.settlements      to authenticated;
grant select on public.settlement_lines to authenticated;

-- Everyone signed in reads the item category list to file a delivery; admin
-- writes it, which the UPDATE policy is what enforces.
grant select, update on public.delivery_options to authenticated;

-- delivery_links gets nothing, including from anon. The rider confirmation page
-- is anonymous, but the token is redeemed by this server with its service-role
-- client after lib/deliveryLinks.ts has checked it — the browser never queries
-- the table, and a capability token that could be listed would not be one.

-- rate_limits and idempotency_keys get nothing. Both are infrastructure for the
-- server's own requests: one would tell a caller how close they are to a limit,
-- the other holds response bodies belonging to whoever made the original
-- request. Neither has ever been touched by anything but the service-role
-- client and public.rate_limit_hit().
