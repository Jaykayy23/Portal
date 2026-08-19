-- Admin-configurable surge charges.
--
-- The surge charge list (same-day rush, fragile handling, after-hours) used to be
-- a hard-coded array in lib/pricing.ts, which meant changing an amount needed a
-- code deploy and nobody but a developer could do it. It now lives beside the
-- rest of the pricing configuration, so admin edits it from the Settings tab.
--
-- pricing_params is the right home rather than app_settings: every signed-in role
-- already reads this table (the quote preview needs it) and only admin can write
-- it under RLS, which is exactly the access shape a surge charge list needs —
-- merchants must see the options to tick them, admin alone sets the amounts.
alter table public.pricing_params
  add column surcharges jsonb not null default
    '[{"id": "rush", "label": "Same-day rush", "amount": 15},
      {"id": "fragile", "label": "Fragile handling", "amount": 10},
      {"id": "afterhours", "label": "After-hours (past 8pm)", "amount": 12}]'::jsonb;

comment on column public.pricing_params.surcharges is
  'Ordered list of selectable surge charges: [{id, label, amount}]. Admin-editable, read by every signed-in role.';

-- The column has to be an array, never an object or a bare string, because both
-- the quote preview and the stored price iterate over it. Per-element shape (id,
-- label, non-negative amount) is enforced in the Route Handler instead of here:
-- a richer CHECK would need a subquery over jsonb_array_elements, which Postgres
-- does not allow in a constraint.
alter table public.pricing_params
  add constraint pricing_params_surcharges_is_array
  check (jsonb_typeof(surcharges) = 'array');
