-- Booking fee and platform fee.
--
-- Two flat charges that ride on top of every quote:
--
--   price = max(min_fare, base + rate x km + per_min x minutes)
--           + surcharges + booking_fee + platform_fee
--
-- Flat rather than proportional, so a merchant can read the fee off the pricing
-- tab and know what it costs on any run. They sit outside the max() for the same
-- reason the surge charges do: the minimum fare is a floor under the *fare*, and
-- a fee that vanished into that floor on short runs would be charged on some
-- deliveries and not others without anything on screen saying so.
--
-- Both default to 0, which reproduces today's quote exactly. Nothing changes for
-- any existing merchant until an admin sets an amount on the Pricing tab.
alter table public.pricing_params
  add column booking_fee numeric(12, 2) not null default 0,
  add column platform_fee numeric(12, 2) not null default 0;

comment on column public.pricing_params.booking_fee is
  'Flat GHS charged once per delivery for filing the booking. 0 means no booking fee.';
comment on column public.pricing_params.platform_fee is
  'Flat GHS charged once per delivery for running the platform. 0 means no platform fee.';

-- The constraint predates both columns, so it is replaced rather than added to —
-- same treatment per_min needed.
alter table public.pricing_params
  drop constraint pricing_params_non_negative;
alter table public.pricing_params
  add constraint pricing_params_non_negative
  check (
    base >= 0 and rate >= 0 and min_fare >= 0 and per_min >= 0
    and booking_fee >= 0 and platform_fee >= 0
  );
