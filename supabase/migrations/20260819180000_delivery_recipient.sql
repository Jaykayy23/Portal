-- Who is receiving the parcel.
--
-- A delivery recorded where it was going but never who was waiting there. A
-- rider arriving at a drop-off had no name to ask for and no number to call when
-- the address turned out to be a gate with no bell, and ops had nobody to phone
-- when a delivery stalled.
--
-- Note the naming, because "customer" is already taken and means something else:
--
--   deliveries.customer   the corporate merchant who filed the request — Jumia,
--                         Mr Wu. Snapshotted company name, one per account.
--   deliveries.recipient_*  the individual at the drop-off, different on every
--                         single delivery. That is what this migration adds.
--
-- Reusing `customer` for both would have made the log ambiguous and the Excel
-- export actively misleading, so the new columns get their own name.
alter table public.deliveries
  add column recipient_name text not null default '',
  add column recipient_phone text not null default '';

comment on column public.deliveries.recipient_name is
  'The person receiving the parcel at the drop-off. Not the merchant — see deliveries.customer.';
comment on column public.deliveries.recipient_phone is
  'Contact number for the recipient, as typed. Normalised to +233 only when a link is built from it.';

-- Required from the New delivery form onwards, but not NOT NULL here: every row
-- filed before this migration genuinely has no recipient on record, and a
-- constraint that cannot be satisfied retroactively would have to be added as
-- NOT VALID, which enforces nothing anyway. The Route Handler rejects a blank
-- name or phone on new requests — the same arrangement item_category uses — and
-- the log shows a dash for the historical rows.
