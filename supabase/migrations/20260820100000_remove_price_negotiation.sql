-- One price, no haggling.
--
-- The portal used to quote a recommended price, derive a floor from it (a
-- configurable percentage), let whoever filed the request type a different agreed
-- figure, and park anything under the floor on 'Requires approval' until ops
-- cleared it. That whole mechanism is gone: what the pricing rules compute is
-- what the delivery costs.
--
-- What is deliberately NOT dropped, and why:
--
--   deliveries.recommended  and deliveries.minimum keep every value they already
--   deliveries.minimum      hold. Two rows on file were genuinely negotiated —
--                           agreed 50 against a recommended 51.60, and 70 against
--                           81.10 — and those are records of money that changed
--                           hands, not settings. Deleting the columns would erase
--                           the only trace of what was quoted at the time.
--
-- Going forward `recommended` and `agreed` are written with the same figure, and
-- `minimum` is left to its new default of 0, meaning "no floor applied".

-- ---------------------------------------------------------------------------
-- pricing_params.min_pct — configuration for a feature that no longer exists
-- ---------------------------------------------------------------------------
-- Dropped rather than left dormant: this one is pure configuration, so there is
-- no history in it, and a column the UI stopped showing is exactly the sort of
-- thing that gets rediscovered years later and mistaken for something live.
-- Dropping the column takes its CHECK constraint with it: Postgres removes any
-- constraint that depends on a dropped column, so naming
-- pricing_params_min_pct_range separately would fail with "does not exist".
alter table public.pricing_params drop column if exists min_pct;

-- ---------------------------------------------------------------------------
-- deliveries.minimum — kept, but no longer supplied
-- ---------------------------------------------------------------------------
-- NOT NULL with no default meant every insert had to pass a floor. A default lets
-- the application stop mentioning it without loosening the column.
alter table public.deliveries alter column minimum set default 0;

comment on column public.deliveries.recommended is
  'The price the pricing rules computed. Since negotiation was removed this always equals agreed.';
comment on column public.deliveries.minimum is
  'Historical: the negotiable floor, when there was one. 0 on everything filed after negotiation was removed.';
comment on column public.deliveries.agreed is
  'What the delivery costs. The only price figure the app reads back.';

-- ---------------------------------------------------------------------------
-- deliveries.status — 'Requires approval' has no producer left
-- ---------------------------------------------------------------------------
-- Removed from the constraint because nothing can reach it any more: it was set
-- by exactly one rule, "agreed is under the floor", and there is no floor. No row
-- currently holds it, so nothing needs migrating first — and if that turns out to
-- be wrong on another environment this statement fails loudly rather than
-- silently orphaning rows.
--
-- 'Approved' stays. Two rows have it, and it never belonged to negotiation: it is
-- ops' own marker for a request they have looked at and cleared to go out.
alter table public.deliveries drop constraint if exists deliveries_status_check;

alter table public.deliveries
  add constraint deliveries_status_check check (
    status in (
      'Requested',
      'Approved',
      'Pending',
      'Assigned',
      'Declined',
      'Picked up',
      'Recipient confirmed',
      'Delivered'
    )
  );
