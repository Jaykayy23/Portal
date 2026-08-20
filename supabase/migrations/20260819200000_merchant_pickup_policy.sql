-- Let a merchant confirm pickup — under RLS, not around it.
--
-- The pickup transition is genuinely the merchant's: they are the person handing
-- the parcel to the rider. But `deliveries` grants UPDATE to ops/admin only, so
-- the first implementation reached for the service-role client and checked
-- ownership in TypeScript.
--
-- That works and is wrong. It puts the only guarantee in application code while
-- holding a key that bypasses every policy in the database — so a later edit to
-- that function, or the next person copying the pattern for the next
-- merchant-facing step, turns a mistake into arbitrary write access instead of a
-- 403. Everywhere else in this schema the database is what enforces isolation.
--
-- So: a policy narrow enough to permit exactly one transition, and a trigger that
-- stops a merchant smuggling other columns along with it. Two pieces, because
-- neither is sufficient alone:
--
--   the policy   decides WHICH rows a merchant may update, and what state they
--                may leave them in — their own, only while 'Accepted', and only
--                ending at 'Picked up'.
--   the trigger  decides WHICH COLUMNS may differ. A policy cannot do this:
--                WITH CHECK validates the resulting row, so "status = 'Picked
--                up'" is satisfied just as happily by an UPDATE that also
--                rewrites `agreed` to 1.

-- ---------------------------------------------------------------------------
-- The policy
-- ---------------------------------------------------------------------------
-- USING sees the row as it stands, WITH CHECK sees the row as it would be, which
-- is what makes a one-way transition expressible at all.
create policy deliveries_update_merchant_pickup
  on public.deliveries
  for update
  to authenticated
  using (
    (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Accepted'
  )
  with check (
    (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Picked up'
  );

comment on policy deliveries_update_merchant_pickup on public.deliveries is
  'A merchant may move their own accepted delivery to Picked up, and nothing else.';

-- ---------------------------------------------------------------------------
-- The column guard
-- ---------------------------------------------------------------------------
-- Ops and admin are waved through: their policy already lets them edit status and
-- rider assignment, which is the job.
--
-- For a merchant, everything except the two pickup columns must be byte-identical
-- to the row that was there before. Comparing whole jsonb documents rather than
-- listing columns is deliberate: a column added by a future migration is
-- protected the day it is added, with nobody having to remember this trigger
-- exists.
create or replace function private.guard_merchant_delivery_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select private.portal_role()), '') <> 'merchant' then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'picked_up_at')
     <> (to_jsonb(old) - 'status' - 'picked_up_at') then
    raise exception 'A merchant may only confirm pickup, not edit a delivery.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function private.guard_merchant_delivery_update() is
  'Restricts a merchant UPDATE on deliveries to the status and picked_up_at columns.';

create trigger deliveries_guard_merchant_update
  before update on public.deliveries
  for each row execute function private.guard_merchant_delivery_update();

-- Same reasoning as private.touch_updated_at(): Postgres grants EXECUTE to
-- PUBLIC on every new function, and a trigger function needs no runtime EXECUTE
-- privilege from the invoking role, so closing it costs nothing.
revoke execute on function private.guard_merchant_delivery_update()
  from public, anon, authenticated;
