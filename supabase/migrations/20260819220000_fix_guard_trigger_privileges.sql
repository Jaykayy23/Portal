-- Fix: the merchant column guard blocked every service-role write to deliveries.
--
-- The guard trigger added in 20260819200000 is SECURITY INVOKER and calls
-- private.portal_role() to find out whether the writer is a merchant. USAGE on
-- schema `private` was granted to `authenticated` and `anon` back in the RLS
-- migration — and to nobody else. So the moment the trigger existed, any UPDATE on
-- deliveries made by the service-role client raised
--
--   42501  permission denied for schema private
--
-- which is the path every rider and customer link takes: accepting a job,
-- declining it, confirming receipt, confirming delivery. The link row is claimed
-- before the delivery is updated, so the failure spent the token and left the
-- delivery on its old status. Ops saw nothing happen.
--
-- The fix is not another GRANT. The trigger is infrastructure: it has to run for
-- every writer, so making its ability to run depend on each writer's schema
-- privileges is the fragility itself — the next role added to this project would
-- hit the same wall, with the same silent-looking symptom. SECURITY DEFINER makes
-- it run as its owner, which has USAGE on `private` by construction.
--
-- Safe, because the thing being read is not a privilege. private.portal_role()
-- reads the request's JWT claims out of a session setting, and a session setting
-- does not change with the executing user — so the guard still sees the real
-- caller's role and still stops a merchant editing anything but the pickup
-- columns. `set search_path = ''` stays, which is what makes SECURITY DEFINER
-- safe to use at all here.
create or replace function private.guard_merchant_delivery_update()
returns trigger
language plpgsql
security definer
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
  'Restricts a merchant UPDATE on deliveries to the status and picked_up_at columns. SECURITY DEFINER so it runs for every writer, not only those granted the private schema.';

-- CREATE OR REPLACE keeps the existing trigger pointed at this function, so
-- nothing needs re-attaching. Re-assert the privilege close-down anyway: replacing
-- a function does not reset its ACL, but a future migration reading only this file
-- should not have to assume that.
revoke execute on function private.guard_merchant_delivery_update()
  from public, anon, authenticated;
