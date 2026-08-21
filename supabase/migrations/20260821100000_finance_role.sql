-- A finance role, and the read access the ledger needs.
--
-- The portal knew where every parcel was and what every delivery cost, but
-- nobody could answer the question finance actually asks: *where is the money
-- right now*. Two sums travel with each delivery — the value of the goods and
-- the delivery fee — and each of them is, at any moment, in somebody's pocket:
-- the rider's, the merchant's, or still the customer's. Working that out meant
-- reading the log row by row and holding the payment terms in your head.
--
-- So a fourth role, whose whole job is watching that. What is deliberate about
-- it is how little it can do:
--
--   reads    every delivery, and merchant accounts (so a merchant can be picked
--            out of a list and their ledger read on its own)
--   writes   nothing at all, anywhere
--
-- The writes are not restricted by a policy that says "not finance" — they are
-- restricted because every INSERT and UPDATE policy in this schema names the
-- roles it permits, and none of them names this one. A role added to the check
-- constraint is inert until a policy mentions it, which is the property that
-- makes adding one safe.
--
-- Riders are the one table finance might be expected to need and does not: the
-- rider's name, phone and bike are snapshotted onto every delivery row, so a
-- ledger that says "GHS 400 is with Kwame Mensah" reads correctly without
-- finance ever holding access to the roster itself.

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------
-- Recreated rather than relaxed: a CHECK constraint cannot be extended in
-- place, and adding the new one NOT VALID would leave the old rows unverified
-- for a change that cannot invalidate any of them.
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'ops', 'merchant', 'finance'));

-- ---------------------------------------------------------------------------
-- deliveries — read everything
-- ---------------------------------------------------------------------------
-- Its own policy rather than another arm bolted onto deliveries_select_own_or_ops.
-- Permissive policies are OR'd, so the effect is identical, and keeping this
-- separate means the grant reads as one sentence and can be dropped in one
-- statement if the role is ever withdrawn.
create policy deliveries_select_finance
  on public.deliveries
  for select
  to authenticated
  using ((select private.portal_role()) = 'finance');

comment on policy deliveries_select_finance on public.deliveries is
  'Finance reads every delivery. Read-only: no INSERT or UPDATE policy names this role.';

-- ---------------------------------------------------------------------------
-- profiles — read merchant accounts
-- ---------------------------------------------------------------------------
-- Narrow in the same way the ops policy is: merchant rows only, never another
-- ops, admin or finance account. It exists so the ledger's merchant picker can
-- list every merchant — including one with no deliveries yet, which is a real
-- answer ("nothing outstanding") and not the same as an absent row.
create policy profiles_select_merchants_finance
  on public.profiles
  for select
  to authenticated
  using (
    (select private.portal_role()) = 'finance'
    and role = 'merchant'
  );

comment on policy profiles_select_merchants_finance on public.profiles is
  'Finance reads merchant accounts only — the merchant picker on the ledger.';
