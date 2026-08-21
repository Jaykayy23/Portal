-- Partial remittances, write-offs to rider debt, and a 48-hour float deadline.
--
-- The settlements migration could record that an obligation was met, all of it,
-- in one go. Three things it could not do, all of which happen at the desk every
-- day:
--
--   1. A rider hands in GHS 1,000 of the GHS 1,240 they owe and cannot say which
--      order is short. There was no way to record that at all — unticking orders
--      at random would blame customers who did pay.
--   2. The GHS 240 turns out to be genuinely gone. It has to leave the float
--      without pretending a customer never paid, and it has to land somewhere:
--      here, on the rider, as a deduction from pay.
--   3. Nothing said how long a rider had been holding cash. A GHS 50 float from
--      this morning and a GHS 4,000 float from three weeks ago looked identical.
--
-- ---------------------------------------------------------------------------
-- What changes in the model
-- ---------------------------------------------------------------------------
-- A leg is no longer all-or-nothing. `settlement_lines.amount` may now be part of
-- the obligation, and an obligation is discharged when the non-void lines against
-- it sum to its full value. So the one-line-per-leg unique index has to go, and
-- the invariant it enforced becomes arithmetic:
--
--   leg 'in'    sum(lines) <= the delivery's own figure for that stream
--   leg 'out'   sum(lines) <= sum(lines on the 'in' leg)
--
-- The second is the ordering rule from before, generalised: you can only pay
-- onward what has reached you. It is enforced by a BEFORE INSERT trigger, not
-- only inside record_settlement, so it holds at the same level the unique index
-- did — a future write path cannot over-settle even by mistake.
--
-- A line also gains a `kind`:
--
--   payment    money changed hands
--   writeoff   it did not, and it is not going to. The obligation is closed and
--              charged to the rider instead.
--
-- A write-off counts toward the 'in' leg, which has one consequence worth saying
-- out loud: it makes the full amount payable onward to the merchant. That is
-- correct. If a rider loses GHS 240 of a merchant's cash-on-delivery money, the
-- merchant is still owed their GHS 500 — the GHS 240 is the rider's debt to us,
-- not the merchant's problem. That is the whole reason write-offs live on this
-- leg rather than being a separate table.
--
-- ---------------------------------------------------------------------------
-- On the amount now coming from the caller
-- ---------------------------------------------------------------------------
-- The settlements migration said the amount is read from the delivery and never
-- proposed by a caller. Partial remittance makes that impossible: only the person
-- counting the notes knows that GHS 300 of GHS 500 arrived. So the guarantee
-- weakens deliberately, from "the caller cannot choose the amount" to "the caller
-- cannot exceed what is owed":
--
--   0 < amount <= remaining, where remaining is computed here from the delivery
--   row and the lines already against it.
--
-- Value still cannot be invented, an obligation still cannot be over-settled, and
-- the bound is still the database's arithmetic rather than the app's word for it.
-- Omitting `amount` still means "all of it", so the simple case stays simple.

-- ---------------------------------------------------------------------------
-- How long a rider may hold cash
-- ---------------------------------------------------------------------------
-- One place, so the trigger and the message cannot disagree. FLOAT_DEADLINE_HOURS
-- in lib/ledger.ts is the twin that drives the display — change one, change the
-- other.
create or replace function private.float_deadline()
returns interval
language sql
immutable
security invoker
set search_path = ''
as $$
  select interval '48 hours'
$$;

revoke execute on function private.float_deadline() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- When the money reached the rider's hands
-- ---------------------------------------------------------------------------
-- The clock the deadline runs on. The first three are real records of a handover;
-- `created_at` is the fallback for a row ops marked delivered by hand with no
-- timestamp at all, and it can only ever overstate the age. That errs toward
-- chasing a rider sooner, which is the safe direction for a cash control.
create or replace function private.delivery_handover_at(
  p_recipient_confirmed_at timestamptz,
  p_delivered_at timestamptz,
  p_picked_up_at timestamptz,
  p_created_at timestamptz
)
returns timestamptz
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_recipient_confirmed_at, p_delivered_at, p_picked_up_at, p_created_at)
$$;

revoke execute on function
  private.delivery_handover_at(timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- settlement_lines: partial amounts and write-offs
-- ---------------------------------------------------------------------------
alter table public.settlement_lines
  add column kind text not null default 'payment';

alter table public.settlement_lines
  add constraint settlement_lines_kind_check check (kind in ('payment', 'writeoff')),
  -- A write-off closes something that was owed *to* us. Declaring money we owe a
  -- merchant to be "written off" by marking it paid out is not a thing.
  add constraint settlement_lines_writeoff_inbound_only check (
    not (kind = 'writeoff' and leg = 'out')
  );

comment on column public.settlement_lines.kind is
  'payment = money changed hands. writeoff = it did not and will not; the obligation is closed and charged to the rider.';
comment on column public.settlement_lines.amount is
  'Part or all of the obligation. Bounded by private.guard_settlement_line() to what is still owed.';

-- The unique index went with all-or-nothing settlement. What replaces it is the
-- arithmetic bound in the trigger below, which covers the same mistake (settling
-- something twice) and the one the index could not (settling more than is owed).
drop index public.settlement_lines_obligation_key;

-- Still worth an index for the sums the trigger and the ledger both run.
create index settlement_lines_obligation_idx
  on public.settlement_lines (delivery_id, stream, leg)
  where not voided;

-- ---------------------------------------------------------------------------
-- How much of an obligation has been settled
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the answer never depends on who is asking. An invoker
-- version would read 0 for a role that cannot see settlement_lines, which would
-- silently overstate what is still owed.
--
-- VOLATILE, not STABLE, and that is load-bearing. A STABLE function reads the
-- calling statement's snapshot, so inside a BEFORE INSERT trigger it would not
-- see rows added by the statement that fired it — and a multi-row INSERT of two
-- lines against one obligation would then have both guards read the same
-- pre-insert total and let the pair through. VOLATILE takes a fresh snapshot per
-- call. The planning cost is nil at this size; the alternative is a trap.
create or replace function private.settled_amount(
  p_delivery_id uuid,
  p_stream text,
  p_leg text
)
returns numeric
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(sum(l.amount), 0)
    from public.settlement_lines l
   where l.delivery_id = p_delivery_id
     and l.stream = p_stream
     and l.leg = p_leg
     and not l.voided
$$;

revoke execute on function private.settled_amount(uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The invariant, at table level
-- ---------------------------------------------------------------------------
-- Deliberately a trigger and not a check constraint: the bound depends on other
-- rows, which a CHECK cannot see. It is here rather than only inside
-- record_settlement so that the rule survives a future write path that forgets
-- to ask.
create or replace function private.guard_settlement_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_obligation numeric(12, 2);
  v_settled_in numeric(12, 2);
  v_settled_out numeric(12, 2);
  v_room numeric(12, 2);
begin
  select d.* into v_delivery
    from public.deliveries d
   where d.id = new.delivery_id;
  if not found then
    raise exception 'Settlement line points at no delivery.'
      using errcode = 'foreign_key_violation';
  end if;

  v_obligation := case
    when new.stream = 'goods' then v_delivery.declared_value
    else v_delivery.agreed
  end;

  v_settled_in := private.settled_amount(new.delivery_id, new.stream, 'in');
  v_settled_out := private.settled_amount(new.delivery_id, new.stream, 'out');

  -- Money in cannot exceed what the delivery is worth; money out cannot exceed
  -- what came in. A write-off counts as in, which is what makes the merchant's
  -- full amount payable even when the rider lost some of it.
  v_room := case
    when new.leg = 'in' then v_obligation - v_settled_in
    else v_settled_in - v_settled_out
  end;

  if new.amount > v_room then
    raise exception
      'Cannot settle % on order #% (% / %): only % is still owed on that leg.',
      new.amount, right(new.delivery_id::text, 5), new.stream, new.leg, v_room
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function private.guard_settlement_line() is
  'Bounds a settlement line to what is still owed on its leg. Replaces the one-line-per-leg unique index that all-or-nothing settlement allowed.';

create trigger settlement_lines_guard_amount
  before insert on public.settlement_lines
  for each row execute function private.guard_settlement_line();

revoke execute on function private.guard_settlement_line()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a rider is holding, and since when
-- ---------------------------------------------------------------------------
-- Rider-held money is the cash-on-delivery goods money and the fees customers
-- paid at the door, on deliveries they carried, less whatever has been settled on
-- the 'in' leg — payments and write-offs alike. A written-off amount has left the
-- float by design: the decision has been made and recorded, so it stops ageing
-- and stops blocking. That makes writing off the honest way to unblock a rider,
-- which is the point.
--
-- `oldest` is the handover time of the earliest thing still owing, which is what
-- the deadline runs on. riderFloat() in lib/ledger.ts computes the same figures
-- for display; this one is the enforcement.
create or replace function private.rider_float_state(p_rider_id uuid)
returns table (held numeric, oldest timestamptz)
language sql
-- Volatile because settled_amount is, and a stable wrapper around a volatile
-- read is a promise this cannot keep.
volatile
security definer
set search_path = ''
as $$
  with owing as (
    select
      private.delivery_handover_at(
        d.recipient_confirmed_at, d.delivered_at, d.picked_up_at, d.created_at
      ) as since,
      (case
         when d.item_payment = 'Cash on delivery'
         then d.declared_value - private.settled_amount(d.id, 'goods', 'in')
         else 0
       end)
      + (case
           when d.delivery_paid_by = 'Customer'
           then d.agreed - private.settled_amount(d.id, 'fee', 'in')
           else 0
         end) as amount
    from public.deliveries d
    where d.rider_id = p_rider_id
      and private.delivery_handed_over(
        d.status, d.recipient_confirmed_at, d.delivered_at
      )
  )
  select coalesce(sum(amount), 0)::numeric, min(since)
    from owing
   where amount > 0
$$;

revoke execute on function private.rider_float_state(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The 48-hour block
-- ---------------------------------------------------------------------------
-- A rider who has been sitting on cash for more than two days takes no new work
-- until they settle. Enforced here rather than in the Route Handler because it is
-- a rule about money, and application code is where rules about money go missing
-- — ops can assign from the log, and a future script or import would bypass a
-- TypeScript check entirely.
--
-- It fires only when the rider actually changes to somebody: unassigning is
-- always allowed, re-offering the same rider the same job is not a new
-- assignment, and none of the other columns on the row are this trigger's
-- business.
--
-- SECURITY DEFINER so the float is computed the same way whoever is assigning.
create or replace function private.block_overdue_rider_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held numeric;
  v_oldest timestamptz;
  v_hours numeric;
begin
  if new.rider_id is null or new.rider_id is not distinct from old.rider_id then
    return new;
  end if;

  select f.held, f.oldest into v_held, v_oldest
    from private.rider_float_state(new.rider_id) f;

  if v_oldest is null or v_oldest >= now() - private.float_deadline() then
    return new;
  end if;

  v_hours := round(extract(epoch from (now() - v_oldest)) / 3600);

  raise exception
    'That rider has been holding GHS % for % hours and has to settle before taking new deliveries. Record their remittance on the ledger, or write off what is missing.',
    to_char(v_held, 'FM999999990.00'), v_hours
    using errcode = 'check_violation';
end;
$$;

comment on function private.block_overdue_rider_assignment() is
  'Refuses to put a delivery on a rider whose oldest un-remitted cash is older than private.float_deadline().';

create trigger deliveries_block_overdue_rider
  before update on public.deliveries
  for each row execute function private.block_overdue_rider_assignment();

revoke execute on function private.block_overdue_rider_assignment()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_settlement, now with amounts and kinds
-- ---------------------------------------------------------------------------
-- p_lines is
--   [{"delivery_id": "...", "stream": "goods", "leg": "in",
--     "amount": 300, "kind": "payment"}, ...]
--
-- `amount` may be omitted to mean "all of what is still owed", and `kind`
-- defaults to 'payment'. A short remittance is two lines against the same
-- obligation: the payment, and — if the difference is being charged to the rider
-- rather than left on their float — a writeoff for the rest.
create or replace function public.record_settlement(
  p_rider_id uuid,
  p_merchant_id uuid,
  p_method text,
  p_reference text,
  p_note text,
  p_settled_at timestamptz,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select private.portal_role()), '');
  v_actor uuid := (select auth.uid());
  v_actor_name text := '';
  v_settlement uuid;
  v_settled_at timestamptz := coalesce(p_settled_at, now());
  v_rider_name text := '';
  v_line jsonb;
  v_delivery public.deliveries;
  v_stream text;
  v_leg text;
  v_kind text;
  v_obligation numeric(12, 2);
  v_room numeric(12, 2);
  v_amount numeric(12, 2);
  v_order text;
begin
  if v_role not in ('admin', 'ops', 'finance') then
    raise exception 'Only finance, ops and admin may record a settlement.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_actor is null then
    raise exception 'No signed-in user.' using errcode = 'insufficient_privilege';
  end if;

  -- A settlement has one counterparty. Both or neither is a bug in the caller.
  if (p_merchant_id is not null) = (p_rider_id is not null) then
    raise exception 'A settlement is with a rider or with a merchant, not both and not neither.'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A settlement has to cover at least one delivery.'
      using errcode = 'check_violation';
  end if;

  -- Back-dating is allowed, inventing the future is not.
  if v_settled_at > now() + interval '1 day' then
    raise exception 'A settlement cannot be dated in the future.'
      using errcode = 'check_violation';
  end if;

  if p_rider_id is not null then
    select r.name into v_rider_name from public.riders r where r.id = p_rider_id;
    if v_rider_name is null or length(btrim(v_rider_name)) = 0 then
      raise exception 'Unknown rider.' using errcode = 'foreign_key_violation';
    end if;
  end if;

  if p_merchant_id is not null then
    if not exists (
      select 1 from public.profiles p where p.id = p_merchant_id and p.role = 'merchant'
    ) then
      raise exception 'Unknown merchant.' using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Definer, so this reads the recorder's own profile whatever their role can
  -- see. The name is snapshotted rather than joined for exactly that reason.
  select coalesce(nullif(btrim(p.company_name), ''), p.username)
    into v_actor_name
    from public.profiles p
   where p.id = v_actor;

  insert into public.settlements (
    settled_at, rider_id, rider_name, merchant_id,
    method, reference, note, recorded_by, recorded_by_name
  )
  values (
    v_settled_at,
    p_rider_id,
    coalesce(v_rider_name, ''),
    p_merchant_id,
    coalesce(btrim(p_method), ''),
    coalesce(btrim(p_reference), ''),
    coalesce(btrim(p_note), ''),
    v_actor,
    coalesce(v_actor_name, '')
  )
  returning id into v_settlement;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_stream := v_line ->> 'stream';
    v_leg := v_line ->> 'leg';
    v_kind := coalesce(nullif(v_line ->> 'kind', ''), 'payment');

    select d.* into v_delivery
      from public.deliveries d
     where d.id = (v_line ->> 'delivery_id')::uuid;
    if not found then
      raise exception 'Delivery not found.' using errcode = 'foreign_key_violation';
    end if;

    -- The human-facing order number, matching shortId() in lib/format.ts.
    v_order := right(v_delivery.id::text, 5);

    if v_kind not in ('payment', 'writeoff') then
      raise exception 'Unknown settlement kind "%".', v_kind
        using errcode = 'check_violation';
    end if;
    if v_kind = 'writeoff' and v_leg <> 'in' then
      raise exception 'Only money owed to us can be written off, so a write-off is always inbound.'
        using errcode = 'check_violation';
    end if;

    -- Nothing settles before the parcel arrives. That holds even for a fee on a
    -- merchant's account: taking money for a delivery that has not happened is
    -- how you end up owing it back when the job is reassigned or dropped.
    if not private.delivery_handed_over(
      v_delivery.status, v_delivery.recipient_confirmed_at, v_delivery.delivered_at
    ) then
      raise exception 'Order #% has not been handed over yet, so nothing on it can be settled.', v_order
        using errcode = 'check_violation';
    end if;

    if v_stream = 'goods' then
      v_obligation := v_delivery.declared_value;

      -- '' and 'Prepaid' both mean there is nothing to settle, but for different
      -- reasons, and a message that says "prepaid" about a row filed before terms
      -- were captured would send somebody looking for a payment that never
      -- existed.
      if v_delivery.item_payment = '' then
        raise exception 'Order #% has no payment terms recorded, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;
      if v_delivery.item_payment <> 'Cash on delivery' then
        raise exception 'Order #% is prepaid — the merchant was paid for the goods directly, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;

      if v_leg = 'in' then
        -- Money coming in from the rider who carried it. Nobody else can remit it.
        if p_rider_id is null or v_delivery.rider_id is distinct from p_rider_id then
          raise exception 'Order #% was not carried by that rider.', v_order
            using errcode = 'check_violation';
        end if;
      elsif v_leg = 'out' then
        if p_merchant_id is null or v_delivery.merchant_id <> p_merchant_id then
          raise exception 'Order #% does not belong to that merchant.', v_order
            using errcode = 'check_violation';
        end if;
      else
        raise exception 'Unknown settlement leg "%".', coalesce(v_leg, 'null')
          using errcode = 'check_violation';
      end if;

    elsif v_stream = 'fee' then
      v_obligation := v_delivery.agreed;

      if v_leg <> 'in' then
        raise exception 'A delivery fee is only ever collected, never paid out.'
          using errcode = 'check_violation';
      end if;

      if v_delivery.delivery_paid_by = 'Customer' then
        if p_rider_id is null or v_delivery.rider_id is distinct from p_rider_id then
          raise exception 'Order #%: the customer paid the fee at the door, so it is that rider who remits it.', v_order
            using errcode = 'check_violation';
        end if;
      elsif v_delivery.delivery_paid_by = 'Merchant' then
        if p_merchant_id is null or v_delivery.merchant_id <> p_merchant_id then
          raise exception 'Order #%: that fee is on a different merchant''s account.', v_order
            using errcode = 'check_violation';
        end if;
      else
        raise exception 'Order #% has no payment terms recorded, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;

    else
      raise exception 'Unknown settlement stream "%".', coalesce(v_stream, 'null')
        using errcode = 'check_violation';
    end if;

    -- What is still owed on this leg. Read here so the message can name the order
    -- and the figure; the trigger on settlement_lines enforces the same bound
    -- whatever route the insert arrives by.
    v_room := case
      when v_leg = 'in'
        then v_obligation - private.settled_amount(v_delivery.id, v_stream, 'in')
      else
        private.settled_amount(v_delivery.id, v_stream, 'in')
          - private.settled_amount(v_delivery.id, v_stream, 'out')
    end;

    -- Omitted means all of it, which keeps the ordinary "they brought the lot"
    -- case a one-field request.
    v_amount := round(
      coalesce((v_line ->> 'amount')::numeric, v_room),
      2
    );

    if v_amount <= 0 then
      raise exception 'Order #%: a settlement amount has to be more than zero.', v_order
        using errcode = 'check_violation';
    end if;
    if v_room <= 0 then
      raise exception 'Order #% is already settled in full for that part. Void the earlier settlement first if it was wrong.', v_order
        using errcode = 'check_violation';
    end if;
    if v_amount > v_room then
      raise exception 'Order #%: only GHS % is still owed on that part, so GHS % cannot be settled against it.',
        v_order, to_char(v_room, 'FM999999990.00'), to_char(v_amount, 'FM999999990.00')
        using errcode = 'check_violation';
    end if;

    insert into public.settlement_lines (
      settlement_id, delivery_id, stream, leg, kind, amount, settled_at
    )
    values (
      v_settlement, v_delivery.id, v_stream, v_leg, v_kind, v_amount, v_settled_at
    );
  end loop;

  return v_settlement;
end;
$$;

comment on function public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb) is
  'Records one money movement and the obligations it discharges, in whole or in part. Finance, ops and admin only; amounts are bounded by what is still owed.';

-- create or replace keeps the existing grants, but state them again so this file
-- reads correctly on its own.
revoke execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  from public, anon;
grant execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  to authenticated;
