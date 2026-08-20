-- Who owes money, and to whom, on each delivery.
--
-- The portal knew what a delivery was worth and what it cost, but not who had
-- already paid for what. A rider arriving at a drop-off had no way to know from
-- the message whether to collect cash for the goods, collect the delivery fee,
-- both, or neither — which is the one thing you cannot improvise at someone's
-- gate.
--
-- Two independent questions, so two columns:
--
--   item_payment      has the customer already paid the merchant for the goods
--                     ('Prepaid'), or does the rider collect on handover
--                     ('Cash on delivery')?
--   delivery_paid_by  is the delivery fee on the merchant's account, or is the
--                     rider collecting it from the customer?
--
-- They genuinely do combine in all four ways: a prepaid order where the customer
-- still pays for delivery is ordinary, as is a COD order where the merchant has
-- absorbed the delivery cost.
alter table public.deliveries
  add column item_payment text not null default '',
  add column delivery_paid_by text not null default '';

-- '' is a legal value for the same reason item_category has no NOT NULL check:
-- every row filed before this migration genuinely has no answer, and a constraint
-- that cannot be satisfied retroactively would have to be added NOT VALID, which
-- enforces nothing. New requests are required to answer both — the Route Handler
-- rejects a blank — and the log shows a dash for the historical rows.
alter table public.deliveries
  add constraint deliveries_item_payment_check check (
    item_payment in ('', 'Prepaid', 'Cash on delivery')
  ),
  add constraint deliveries_delivery_paid_by_check check (
    delivery_paid_by in ('', 'Merchant', 'Customer')
  );

comment on column public.deliveries.item_payment is
  'Whether the goods are already paid for, or the rider collects cash on handover. '''' for rows filed before this was captured.';
comment on column public.deliveries.delivery_paid_by is
  'Who settles the delivery fee: the merchant''s account, or the customer paying the rider.';
