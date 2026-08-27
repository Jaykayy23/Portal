-- Every delivery is on demand.
--
-- The type column started life as a choice the merchant made on the new-delivery
-- form — Standard, Express (same-day), or Fragile. In practice SomoExpress runs
-- one service: the rider goes when the request comes in. So the choice is gone
-- from the form and 'On demand' is the only type a new delivery can be filed as.
--
-- The three old values stay in the constraint because rows already carry them.
-- Dropping them would make this migration fail on its own data, and rewriting
-- history to say a Fragile run was on demand would be a lie about what was
-- agreed at the time. They are legacy values: readable, never written again.
alter table public.deliveries
  drop constraint if exists deliveries_type_check;
alter table public.deliveries
  add constraint deliveries_type_check
  check (type in ('On demand', 'Standard', 'Express', 'Fragile'));

-- The app always sends a type, so this default is only the backstop for a row
-- inserted without one — it should land on the service that actually exists.
alter table public.deliveries
  alter column type set default 'On demand';

comment on column public.deliveries.type is
  'Service type. Always ''On demand'' on new rows; Standard, Express and Fragile are legacy values from when the form offered a choice.';
