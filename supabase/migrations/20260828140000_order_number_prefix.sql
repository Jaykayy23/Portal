-- Order numbers now carry the SomoExpress prefix: "SME4f2a1", not "#4f2a1".
--
-- The portal formats that number in one place (orderNo in lib/format.ts) and it
-- reaches every screen, export and SMS from there. Postgres is the exception:
-- record_settlement writes whole sentences for the person on the screen, and
-- those sentences quote the order number themselves. lib/errors.ts passes them
-- through verbatim by design, so a prefix added only in TypeScript would leave
-- finance reading "Order #4f2a1" in a refusal about the row their screen calls
-- SME4f2a1.
--
-- So this migration exists to change one assignment and eleven message strings.
-- The rest of the function is a verbatim copy of the definition in
-- 20260825110000_settlement_active_actor_and_row_lock.sql — `create or replace`
-- has no way to patch a body, so the whole thing has to be restated. Read the
-- diff against that file rather than this one in full: nothing about the
-- locking, the privilege checks or the arithmetic has moved.
--
-- Nothing stored changes. The number has always been derived from the delivery
-- uuid at display time, never written to a column, so old rows read the same way
-- new ones do and there is no backfill.

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
  -- The authoritative profile row, not the token's word for it.
  if not (select private.is_active_profile()) then
    raise exception 'That account is no longer active.'
      using errcode = 'insufficient_privilege';
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

  -- Ordered by delivery_id so concurrent callers take the same locks in the same
  -- sequence, then by the caller's own ordinality so a payment still precedes the
  -- write-off that covers its shortfall.
  for v_line in
    select t.value
      from jsonb_array_elements(p_lines) with ordinality as t(value, ord)
     order by (t.value ->> 'delivery_id'), t.ord
  loop
    v_stream := v_line ->> 'stream';
    v_leg := v_line ->> 'leg';
    v_kind := coalesce(nullif(v_line ->> 'kind', ''), 'payment');

    -- FOR UPDATE, and before anything is computed from the row. This is the
    -- statement that makes the room arithmetic below safe: a second settlement
    -- against this delivery waits here until this transaction commits, and then
    -- reads the totals including this one's lines.
    select d.* into v_delivery
      from public.deliveries d
     where d.id = (v_line ->> 'delivery_id')::uuid
       for update;
    if not found then
      raise exception 'Delivery not found.' using errcode = 'foreign_key_violation';
    end if;

    -- The human-facing order number, matching shortId() in lib/format.ts.
    v_order := 'SME' || right(v_delivery.id::text, 5);

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
      raise exception 'Order % has not been handed over yet, so nothing on it can be settled.', v_order
        using errcode = 'check_violation';
    end if;

    if v_stream = 'goods' then
      v_obligation := v_delivery.declared_value;

      -- '' and 'Prepaid' both mean there is nothing to settle, but for different
      -- reasons, and a message that says "prepaid" about a row filed before terms
      -- were captured would send somebody looking for a payment that never
      -- existed.
      if v_delivery.item_payment = '' then
        raise exception 'Order % has no payment terms recorded, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;
      if v_delivery.item_payment <> 'Cash on delivery' then
        raise exception 'Order % is prepaid — the merchant was paid for the goods directly, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;

      if v_leg = 'in' then
        -- Money coming in from the rider who carried it. Nobody else can remit it.
        if p_rider_id is null or v_delivery.rider_id is distinct from p_rider_id then
          raise exception 'Order % was not carried by that rider.', v_order
            using errcode = 'check_violation';
        end if;
      elsif v_leg = 'out' then
        if p_merchant_id is null or v_delivery.merchant_id <> p_merchant_id then
          raise exception 'Order % does not belong to that merchant.', v_order
            using errcode = 'check_violation';
        end if;
        -- You cannot pay out money you have not received. This is the ordering
        -- rule the two-leg model exists to express, and it was dropped when
        -- 20260821140000 rewrote this function for partial settlement.
        --
        -- The invariant itself never broke: for an outbound leg the room is
        -- settled_in minus settled_out, so with nothing remitted the room is zero
        -- and the insert is refused regardless. What broke was the explanation —
        -- the refusal that fires without this check is "already settled in full,
        -- void the earlier settlement first", which sends finance looking for a
        -- settlement that does not exist, about money nobody has paid.
        --
        -- Positioned before the room is computed, so it is the refusal that wins.
        -- A partly-remitted obligation does not reach it: some inbound line
        -- exists, so the room is positive and an over-payout is caught further
        -- down by the "only GHS X is still owed" message, which is the right one
        -- for that case.
        if not exists (
          select 1
            from public.settlement_lines l
           where l.delivery_id = v_delivery.id
             and l.stream = 'goods'
             and l.leg = 'in'
             and not l.voided
        ) then
          raise exception 'The rider has not remitted the cash on order % yet, so it cannot be paid out.', v_order
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
          raise exception 'Order %: the customer paid the fee at the door, so it is that rider who remits it.', v_order
            using errcode = 'check_violation';
        end if;
      elsif v_delivery.delivery_paid_by = 'Merchant' then
        if p_merchant_id is null or v_delivery.merchant_id <> p_merchant_id then
          raise exception 'Order %: that fee is on a different merchant''s account.', v_order
            using errcode = 'check_violation';
        end if;
      else
        raise exception 'Order % has no payment terms recorded, so there is nothing to settle.', v_order
          using errcode = 'check_violation';
      end if;

    else
      raise exception 'Unknown settlement stream "%".', coalesce(v_stream, 'null')
        using errcode = 'check_violation';
    end if;

    -- What is still owed on this leg. Read under the row lock taken above, so it
    -- cannot be stale by the time the insert lands. The trigger on
    -- settlement_lines enforces the same bound whatever route the insert arrives
    -- by.
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

    -- Room before amount, and the order is load-bearing. Because an omitted
    -- amount resolves to the room, a fully settled obligation produces an amount
    -- of zero — so checking the amount first reported "a settlement amount has to
    -- be more than zero" about a figure the caller never sent, which is what a
    -- double-tap on the settle screen used to say. See the header.
    if v_room <= 0 then
      raise exception 'Order % is already settled in full for that part. Void the earlier settlement first if it was wrong.', v_order
        using errcode = 'check_violation';
    end if;
    if v_amount <= 0 then
      raise exception 'Order %: a settlement amount has to be more than zero.', v_order
        using errcode = 'check_violation';
    end if;
    if v_amount > v_room then
      raise exception 'Order %: only GHS % is still owed on that part, so GHS % cannot be settled against it.',
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
  'Records one money movement and the obligations it discharges, in whole or in part. Active finance, ops and admin accounts only; locks each delivery row so concurrent settlements cannot over-settle it.';

-- create or replace keeps the existing grants, but state them again so this file
-- reads correctly on its own.
revoke execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  from public, anon;
grant execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  to authenticated;
