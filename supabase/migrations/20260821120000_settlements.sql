-- Recording that the money actually moved.
--
-- The ledger could say what was owed and never that it had been paid, so every
-- figure on it grew forever: a rider who handed their float in on Monday still
-- showed as carrying it on Friday. This is the missing half.
--
-- ---------------------------------------------------------------------------
-- What an obligation is
-- ---------------------------------------------------------------------------
-- Each delivery carries two sums — the goods and the fee — and each sum has a
-- route it has to travel. Written out as legs, where "in" means money reaching
-- SomoExpress and "out" means money leaving it:
--
--   goods, cash on delivery   customer -> rider -[in]-> us -[out]-> merchant
--   goods, prepaid            customer -> merchant. Never ours; no legs at all.
--   fee, customer pays        customer -> rider -[in]-> us. Ours on arrival.
--   fee, merchant pays        merchant -[in]-> us. Ours on arrival.
--
-- So the goods stream has two legs and the fee stream has one, and there is no
-- such thing as a fee going out. That is the whole model: `settlement_lines` is
-- one row per leg travelled, and the partial unique index below is what makes a
-- leg travel exactly once.
--
-- ---------------------------------------------------------------------------
-- Why two tables
-- ---------------------------------------------------------------------------
-- A rider comes back at the end of a shift and hands over one bundle of cash
-- covering eight deliveries. `settlements` is that event — who, when, how,
-- receipt number — and `settlement_lines` is what it discharged. Per-line rows
-- are what keep the ledger exact; the parent is what makes recording it one
-- action rather than eight, and gives finance a list of remittances to read.
--
-- A settlement with a merchant may run in both directions at once, which is why
-- there is no "kind" column: a merchant who owes GHS 400 in fees while we hold
-- GHS 2,000 of their cash-on-delivery takings settles with one payment of GHS
-- 1,600, and that settlement has fee `in` lines and goods `out` lines together.
-- The lines say what moved; a kind column would only be a second opinion.
--
-- ---------------------------------------------------------------------------
-- Why the writes are functions and not policies
-- ---------------------------------------------------------------------------
-- Everywhere else in this schema, RLS decides who may write and the app just
-- asks. Here it cannot, for two reasons that both matter:
--
--   atomicity   a settlement is a parent row plus N line rows. supabase-js has
--               no transactions, so two round trips can leave a settlement
--               header with no lines — a receipt for nothing.
--   the amount   must be the delivery's own figure and never the caller's, and
--               whether a leg is even legal depends on the delivery's status and
--               on which legs it has already travelled. That is a read of
--               another table per line, which a WITH CHECK expression cannot do
--               and a trigger could only do awkwardly.
--
-- So `record_settlement` and `void_settlement` are SECURITY DEFINER functions
-- that check the caller's role themselves, and `authenticated` is granted no
-- INSERT, UPDATE or DELETE on either table at all. That is a stronger position
-- than an INSERT policy, not a weaker one: there is no shape of request that
-- writes a settlement row without going through these rules.
--
-- One consequence to know about, spelled out again at the RLS block below: these
-- are the only two tables here that enable RLS without FORCE. A definer function
-- runs as the table owner, and FORCE would subject the owner to policies that do
-- not exist for INSERT, refusing the function's own writes.
--
-- Who may write: finance, ops and admin. Finance because watching the money is
-- the job; ops because riders hand cash to whoever is at base, and a rule that
-- waits for finance to be present is a rule that ends with cash unrecorded.
-- Merchants never write, and read only what concerns them.

-- ---------------------------------------------------------------------------
-- Handover, in one place
-- ---------------------------------------------------------------------------
-- The moment cash changes hands at the door, and so the moment any leg becomes
-- legal. This is the SQL twin of `handedOver` in lib/ledger.ts and the two have
-- to agree — if you change one, change the other.
--
-- Both the timestamps and the statuses are checked: a timestamp is the honest
-- record (a recipient or a rider tapped their link) and the status covers a row
-- ops moved along by hand in the log, which is still ops saying it arrived.
create or replace function private.delivery_handed_over(
  p_status text,
  p_recipient_confirmed_at timestamptz,
  p_delivered_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_recipient_confirmed_at is not null
      or p_delivered_at is not null
      or p_status in ('Recipient confirmed', 'Delivered')
$$;

comment on function private.delivery_handed_over(text, timestamptz, timestamptz) is
  'Has the parcel reached the recipient? The SQL twin of handedOver() in lib/ledger.ts.';

revoke execute on function private.delivery_handed_over(text, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- settlements — one money movement
-- ---------------------------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- When the cash actually changed hands, which is not always when somebody got
  -- round to typing it in. Defaults to now; the recorder may back-date.
  settled_at timestamptz not null default now(),

  -- The counterparty. Exactly one of a rider or a merchant — see the XOR check.
  rider_id uuid references public.riders (id) on delete set null,
  -- Snapshotted the same way deliveries snapshot rider details, so the record
  -- still says who handed the money over after a roster edit.
  rider_name text not null default '',
  merchant_id uuid references public.profiles (id) on delete restrict,

  method text not null default '',
  -- Receipt number, mobile-money transaction id, cheque number. Free text
  -- because it is somebody else's reference, not ours.
  reference text not null default '',
  note text not null default '',

  recorded_by uuid not null references public.profiles (id) on delete restrict,
  -- Snapshotted for the same reason rider_name is, and for one more: finance can
  -- read merchant profiles and its own row, not ops or admin ones. Without the
  -- snapshot, the remittance book would show "recorded by <uuid>" to the very
  -- role whose job is reading it.
  recorded_by_name text not null default '',

  -- Voided, never deleted. A mistake that vanishes is a mistake nobody can
  -- account for, and the ledger reopens the obligation either way.
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  voided_by_name text not null default '',
  void_reason text not null default '',

  constraint settlements_method_check check (
    method in ('', 'Cash', 'Mobile money', 'Bank transfer', 'Cheque', 'Offset')
  ),
  -- A settlement is with a rider or with a merchant. Keyed on rider_name rather
  -- than rider_id because the id is nullable by design (a rider removed from the
  -- roster must not erase who handed money in) while the name is not.
  constraint settlements_one_counterparty check (
    (merchant_id is not null) <> (length(btrim(rider_name)) > 0)
  ),
  constraint settlements_rider_named check (
    rider_id is null or length(btrim(rider_name)) > 0
  ),
  -- A void has a time, an author and a reason, or it is not a void.
  constraint settlements_void_complete check (
    (voided_at is null) = (voided_by is null)
  ),
  constraint settlements_void_reason check (
    (voided_at is null) = (length(btrim(void_reason)) = 0)
  )
);

create index settlements_rider_idx on public.settlements (rider_id);
create index settlements_merchant_idx on public.settlements (merchant_id);
create index settlements_settled_idx on public.settlements (settled_at desc);

comment on table public.settlements is
  'One money movement: a rider remitting a float, a merchant paying fees, or us paying a merchant their cash-on-delivery takings. Written only by public.record_settlement().';

-- ---------------------------------------------------------------------------
-- settlement_lines — which obligations it discharged
-- ---------------------------------------------------------------------------
create table public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements (id) on delete cascade,
  delivery_id uuid not null references public.deliveries (id) on delete restrict,

  stream text not null,
  leg text not null,
  -- Copied from the delivery by record_settlement(), never sent by a caller.
  amount numeric(12, 2) not null,

  -- Snapshotted from the parent so a merchant reading their own ledger can see
  -- when a position cleared without needing to read the settlement that cleared
  -- it — which, for a rider's remittance, covers other merchants' orders too.
  settled_at timestamptz not null,

  -- Kept in step with settlements.voided_at by void_settlement(). It lives here
  -- as well as on the parent because the partial unique index below is the real
  -- guarantee that an obligation is settled once, and a partial index cannot
  -- reach into another table.
  voided boolean not null default false,

  constraint settlement_lines_stream_check check (stream in ('goods', 'fee')),
  constraint settlement_lines_leg_check check (leg in ('in', 'out')),
  -- The fee is ours the moment it arrives. There is no leg that pays it onward,
  -- so this is not an omission to be filled in later.
  constraint settlement_lines_fee_inbound_only check (
    not (stream = 'fee' and leg = 'out')
  ),
  constraint settlement_lines_amount_positive check (amount > 0)
);

-- The integrity guarantee this whole migration turns on: one obligation, settled
-- once. Partial on `not voided`, which is what lets a voided settlement hand the
-- obligation back rather than blocking it forever.
create unique index settlement_lines_obligation_key
  on public.settlement_lines (delivery_id, stream, leg)
  where not voided;

create index settlement_lines_settlement_idx on public.settlement_lines (settlement_id);
create index settlement_lines_delivery_idx on public.settlement_lines (delivery_id);

comment on table public.settlement_lines is
  'One leg of one delivery''s money, discharged. See the migration header for the legs.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Enabled but deliberately NOT forced, which is the one place these two tables
-- differ from every other table in this schema.
--
-- FORCE subjects the table owner to the policies as well. The functions below are
-- SECURITY DEFINER and therefore run as the owner, so under FORCE their own
-- INSERTs would be evaluated against the policies on this table — of which there
-- are none for INSERT — and refused. The write path would be dead on arrival.
--
-- Adding INSERT policies to let them through would be the wrong fix: a policy
-- exists to be matched, and the day somebody adds `grant insert ... to
-- authenticated` beside it, direct inserts would start succeeding and skip every
-- amount and leg check in record_settlement. Leaving RLS on with zero write
-- policies and zero write grants means there is no combination of the two that
-- opens a second door. It is the same posture app_settings takes.
alter table public.settlements       enable row level security;
alter table public.settlement_lines  enable row level security;

-- SELECT only, for the same reason. Writes go through the two functions below,
-- which check the caller's role themselves.
grant select on public.settlements to authenticated;
grant select on public.settlement_lines to authenticated;

grant select, insert, update, delete on
  public.settlements, public.settlement_lines
  to service_role;

-- Finance, ops and admin read every settlement — it is the remittance book.
create policy settlements_select_money_roles
  on public.settlements
  for select
  to authenticated
  using ((select private.portal_role()) in ('admin', 'ops', 'finance'));

-- A merchant reads the settlements they are party to, and only those: the
-- payments they made to us and the payouts we made to them. Deliberately not
-- "any settlement touching one of my deliveries" — a rider's remittance covers
-- several merchants at once, and its note and reference are internal.
create policy settlements_select_own_merchant
  on public.settlements
  for select
  to authenticated
  using (
    (select private.portal_role()) = 'merchant'
    and merchant_id = (select auth.uid())
  );

create policy settlement_lines_select_money_roles
  on public.settlement_lines
  for select
  to authenticated
  using ((select private.portal_role()) in ('admin', 'ops', 'finance'));

-- Lines follow the delivery, which is what a merchant's own ledger needs: their
-- rows show "settled, 21 Aug" from the line's own snapshot, with no sight of the
-- settlement it belonged to. The subquery runs as the caller, so the deliveries
-- policy is doing the work and the merchant_id test beside it is belt and braces.
create policy settlement_lines_select_own_delivery
  on public.settlement_lines
  for select
  to authenticated
  using (
    (select private.portal_role()) = 'merchant'
    and exists (
      select 1
      from public.deliveries d
      where d.id = settlement_lines.delivery_id
        and d.merchant_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- record_settlement — the only way a settlement is written
-- ---------------------------------------------------------------------------
-- p_lines is [{"delivery_id": "...", "stream": "goods", "leg": "in"}, ...].
-- Note what it does not carry: an amount. Every figure is read from the delivery
-- row here, for the same reason the delivery price is computed server-side —
-- there is nothing for a caller to propose.
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

    select d.* into v_delivery
      from public.deliveries d
     where d.id = (v_line ->> 'delivery_id')::uuid;
    if not found then
      raise exception 'Delivery not found.' using errcode = 'foreign_key_violation';
    end if;

    -- The human-facing order number, matching shortId() in lib/format.ts.
    v_order := right(v_delivery.id::text, 5);

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
      v_amount := v_delivery.declared_value;

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
        -- You cannot pay out money you have not received. This is the ordering
        -- rule the two-leg model exists to express.
        if not exists (
          select 1 from public.settlement_lines l
           where l.delivery_id = v_delivery.id
             and l.stream = 'goods' and l.leg = 'in' and not l.voided
        ) then
          raise exception 'The rider has not remitted the cash on order #% yet, so it cannot be paid out.', v_order
            using errcode = 'check_violation';
        end if;
      else
        raise exception 'Unknown settlement leg "%".', coalesce(v_leg, 'null')
          using errcode = 'check_violation';
      end if;

    elsif v_stream = 'fee' then
      v_amount := v_delivery.agreed;

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

    -- The unique index is what actually stops a double settle. Caught here only
    -- so the message names the order rather than the index.
    begin
      insert into public.settlement_lines (
        settlement_id, delivery_id, stream, leg, amount, settled_at
      )
      values (v_settlement, v_delivery.id, v_stream, v_leg, v_amount, v_settled_at);
    exception
      when unique_violation then
        raise exception 'Order #% has already been settled for that part. Void the earlier settlement first if it was wrong.', v_order
          using errcode = 'unique_violation';
    end;
  end loop;

  return v_settlement;
end;
$$;

comment on function public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb) is
  'Records one money movement and the obligations it discharges. Finance, ops and admin only; amounts are read from the delivery rows, never from the caller.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so the revoke is not
-- decorative — without it, anon could call this and the role check inside would
-- be the only thing standing between the internet and the remittance book.
revoke execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  from public, anon;
grant execute on function
  public.record_settlement(uuid, uuid, text, text, text, timestamptz, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- void_settlement — unwinding one, without losing it
-- ---------------------------------------------------------------------------
create or replace function public.void_settlement(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select private.portal_role()), '');
  v_actor uuid := (select auth.uid());
  v_actor_name text := '';
begin
  if v_role not in ('admin', 'ops', 'finance') then
    raise exception 'Only finance, ops and admin may void a settlement.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_actor is null then
    raise exception 'No signed-in user.' using errcode = 'insufficient_privilege';
  end if;
  -- A void with no reason is an unexplained hole in the money. The constraint on
  -- the table says the same thing; this is the readable version of it.
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why this settlement is being voided.'
      using errcode = 'check_violation';
  end if;

  select coalesce(nullif(btrim(p.company_name), ''), p.username)
    into v_actor_name
    from public.profiles p
   where p.id = v_actor;

  update public.settlements
     set voided_at = now(),
         voided_by = v_actor,
         voided_by_name = coalesce(v_actor_name, ''),
         void_reason = btrim(p_reason)
   where id = p_id
     and voided_at is null;

  if not found then
    -- Already voided is almost always a double tap, and the end state is the one
    -- the caller wanted, so it is not an error. A missing row is.
    if exists (select 1 from public.settlements s where s.id = p_id) then
      return;
    end if;
    raise exception 'Settlement not found.' using errcode = 'no_data_found';
  end if;

  -- Hands the obligations back: the partial unique index ignores voided lines,
  -- and so does the ledger.
  update public.settlement_lines
     set voided = true
   where settlement_id = p_id;
end;
$$;

comment on function public.void_settlement(uuid, text) is
  'Marks a settlement void, stamping who and why, and reopens the obligations it had discharged. Finance, ops and admin only.';

revoke execute on function public.void_settlement(uuid, text) from public, anon;
grant execute on function public.void_settlement(uuid, text) to authenticated;
