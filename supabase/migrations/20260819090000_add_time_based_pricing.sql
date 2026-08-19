-- Time-based pricing.
--
-- Until now a quote was purely distance-based: max(min_fare, base + rate x km).
-- A 4km run through Accra traffic costs the rider far more of their day than a
-- 4km run on open road, so the estimated trip time now carries its own rate.
--
--   recommended = max(min_fare, base + rate x km + per_min x minutes) + surcharges
--
-- per_min defaults to 0, which reproduces the old distance-only quote exactly.
-- Pricing stays unchanged for every existing merchant until an admin sets a
-- per-minute rate on the Pricing tab.
alter table public.pricing_params
  add column per_min numeric(12, 2) not null default 0;

comment on column public.pricing_params.per_min is
  'GHS charged per minute of estimated driving time. 0 disables time-based pricing.';

-- The old constraint predates this column, so it has to be replaced rather than
-- added to.
alter table public.pricing_params
  drop constraint pricing_params_non_negative;
alter table public.pricing_params
  add constraint pricing_params_non_negative
  check (base >= 0 and rate >= 0 and min_fare >= 0 and per_min >= 0);

-- The estimated driving time for this route, captured from Google Maps at the
-- same moment as the distance and frozen onto the record — the same treatment
-- distance already gets, so re-reading an old delivery shows what was actually
-- quoted rather than what today's traffic would say.
--
-- Nullable-free with a 0 default: rows written before this migration genuinely
-- had no time component, and 0 is the honest value for them.
alter table public.deliveries
  add column duration_min numeric(6, 2) not null default 0;

comment on column public.deliveries.duration_min is
  'Estimated driving time in minutes at the moment of quoting. 0 for pre-time-pricing rows.';

alter table public.deliveries
  add constraint deliveries_duration_non_negative check (duration_min >= 0);
