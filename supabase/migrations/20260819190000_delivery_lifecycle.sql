-- The full delivery lifecycle: rider accepts or declines, merchant confirms
-- pickup, recipient confirms receipt, rider confirms completion.
--
-- Until now the middle of a delivery was invisible. A row went from Assigned to
-- Delivered and everything between — did the rider even take the job, was the
-- parcel collected, did anyone at the drop-off actually get it — lived in phone
-- calls. This migration gives each of those moments a status, a timestamp, and
-- the link that produced it.
--
-- The shape of the flow, and who moves it:
--
--   Requested ─ops assigns──> Assigned ─rider taps decline─> Declined
--                                │                              │
--                                │                        ops reassigns
--                                │                              ↓
--                                └─rider taps accept──> Accepted ─┘
--                                                          │
--                                       merchant confirms  │
--                                                          ↓
--                                                     Picked up
--                                                          │
--                                    recipient taps confirm│
--                                                          ↓
--                                                Recipient confirmed
--                                                          │
--                                        rider taps confirm│
--                                                          ↓
--                                                      Delivered
--
-- Every one of the rider/recipient steps happens on a phone with no portal
-- account, so each is a capability link — same design as the completion link
-- this migration generalises.

-- ---------------------------------------------------------------------------
-- deliveries.status — five values become nine
-- ---------------------------------------------------------------------------
-- The old five are all kept: rows already in the table have them, and ops still
-- sets Approved by hand for a request that came in under the minimum.
alter table public.deliveries
  drop constraint deliveries_status_check;

alter table public.deliveries
  add constraint deliveries_status_check check (
    status in (
      'Requested',
      'Requires approval',
      'Approved',
      'Assigned',
      'Declined',
      'Accepted',
      'Picked up',
      'Recipient confirmed',
      'Delivered'
    )
  );

-- ---------------------------------------------------------------------------
-- deliveries — one timestamp per milestone
-- ---------------------------------------------------------------------------
-- Denormalised out of delivery_links for the same reason delivered_at was: the
-- log, the action queue and the export all want the timeline on the row without
-- a join, and a status ops set by hand legitimately has no link behind it.
-- Null therefore means "this step never happened here", not "not yet".
alter table public.deliveries
  add column accepted_at timestamptz,
  add column declined_at timestamptz,
  add column picked_up_at timestamptz,
  add column recipient_confirmed_at timestamptz;

comment on column public.deliveries.accepted_at is
  'When the assigned rider accepted the job via their link.';
comment on column public.deliveries.declined_at is
  'When the assigned rider declined. Cleared when ops assigns someone else.';
comment on column public.deliveries.picked_up_at is
  'When the merchant confirmed the rider had collected the item.';
comment on column public.deliveries.recipient_confirmed_at is
  'When the person at the drop-off confirmed receipt via their link.';

-- ---------------------------------------------------------------------------
-- delivery_confirmations becomes delivery_links
-- ---------------------------------------------------------------------------
-- The table now issues three different kinds of link, and one of them records a
-- refusal, so "confirmations" had stopped describing it. Renaming rather than
-- adding a second table: the lifecycle — hash, expiry, one delivery, one use —
-- is identical for all three, and only the question being asked differs.
--
-- Grants and RLS follow the object through a rename, so the "enabled, no
-- policies, service_role only" arrangement from the previous migration still
-- stands and is not restated here.
alter table public.delivery_confirmations rename to delivery_links;
alter index delivery_confirmations_token_hash_key rename to delivery_links_token_hash_key;
alter index delivery_confirmations_delivery_idx rename to delivery_links_delivery_idx;

alter table public.delivery_links
  -- What this link asks. Checked against the delivery's status both when the
  -- link is minted and when it is redeemed, so a link cannot answer a question
  -- the delivery has already moved past.
  add column purpose text not null default 'rider-complete',
  -- What the holder chose. Null until they act; 'declined' is the one outcome
  -- that does not advance the delivery.
  add column outcome text;

-- Backfill before the constraint below can be trusted: every row that predates
-- this migration is a completion link, and a used one recorded its time but had
-- no column to record the outcome in.
update public.delivery_links
  set outcome = 'confirmed'
  where confirmed_at is not null;

alter table public.delivery_links
  add constraint delivery_links_purpose_check check (
    purpose in ('rider-response', 'recipient-confirm', 'rider-complete')
  ),
  add constraint delivery_links_outcome_check check (
    outcome is null or outcome in ('accepted', 'declined', 'confirmed')
  ),
  -- A used link has both, an unused link has neither. This is what stops a row
  -- claiming an outcome without a time or a time without an outcome.
  add constraint delivery_links_outcome_with_time check (
    (outcome is null) = (confirmed_at is null)
  );

-- The default exists only so the pre-existing rows — all of them completion
-- links — are correct. New rows always name their purpose explicitly.
alter table public.delivery_links alter column purpose drop default;

comment on table public.delivery_links is
  'One-delivery capability links: rider accept/decline, recipient receipt, rider completion. Issued and redeemed only by the server''s service-role client.';
comment on column public.delivery_links.confirmed_at is
  'When the link was used, whatever the outcome. Null while it is still live.';
