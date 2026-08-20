-- "Assigned" should mean a rider is on the job, not that we asked someone.
--
-- The lifecycle migration used 'Assigned' for the moment ops picks a rider and
-- 'Accepted' for the rider agreeing. Read on a delivery row that is backwards:
-- ops choosing a name off a dropdown does not assign anybody anything, and a
-- merchant seeing "Assigned" reasonably concludes a rider is on the way when in
-- fact nobody has answered yet.
--
-- So the two shift down by one:
--
--   'Assigned'  ->  'Pending'     rider has been offered the job, no answer yet
--   'Accepted'  ->  'Assigned'    rider said yes, they are on it
--
-- Renaming the stored values rather than displaying different labels over the old
-- ones: a status that means one thing in the database and another on the screen is
-- how the next person introduces a bug.

-- ---------------------------------------------------------------------------
-- The values
-- ---------------------------------------------------------------------------
-- The constraint comes off first because the two updates below pass through a
-- state it would reject.
alter table public.deliveries
  drop constraint deliveries_status_check;

-- Order matters: 'Assigned' has to vacate the name before 'Accepted' takes it,
-- or every accepted delivery would be swept into 'Pending' by the first update.
--
-- Rows that predate the lifecycle flow are carried into 'Pending' by this, which
-- is the honest reading — ops named a rider on them and no rider ever accepted,
-- because there was nothing to accept with.
update public.deliveries set status = 'Pending' where status = 'Assigned';
update public.deliveries set status = 'Assigned' where status = 'Accepted';

alter table public.deliveries
  add constraint deliveries_status_check check (
    status in (
      'Requested',
      'Requires approval',
      'Approved',
      'Pending',
      'Declined',
      'Assigned',
      'Picked up',
      'Recipient confirmed',
      'Delivered'
    )
  );

-- ---------------------------------------------------------------------------
-- The merchant pickup policy moves with it
-- ---------------------------------------------------------------------------
-- It named 'Accepted' as the only status a merchant may confirm pickup from, and
-- that status is now called 'Assigned'. Left alone the policy would silently stop
-- matching anything, which is the worst kind of broken: no error, merchants just
-- cannot confirm pickup any more.
drop policy deliveries_update_merchant_pickup on public.deliveries;

create policy deliveries_update_merchant_pickup
  on public.deliveries
  for update
  to authenticated
  using (
    (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Assigned'
  )
  with check (
    (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
    and status = 'Picked up'
  );

comment on policy deliveries_update_merchant_pickup on public.deliveries is
  'A merchant may move their own assigned delivery to Picked up, and nothing else.';
