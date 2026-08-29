-- A change detector for the portal's poll.
--
-- Every open portal tab re-renders itself on a timer (components/PortalRefresh.tsx)
-- because riders and customers move deliveries along from their own phones. That
-- re-render is not cheap: the layout reads the session, the branding, the alert
-- deliveries and the pricing row, and the page under it pages up to twenty
-- thousand deliveries out of the Data API and adds them up in JavaScript. The
-- cost is proportional to the whole history, and it is paid whether or not
-- anything happened in the last twenty-five seconds.
--
-- On a delivery portal, almost nothing happened. Deliveries are filed by hand, a
-- few an hour on a busy day, so the overwhelming majority of those polls re-read
-- a year of rows to conclude that the screen was already right.
--
-- This table is the cheap question to ask first. One row, one integer, bumped by
-- a statement trigger on every table the portal renders from. The poll reads it,
-- compares it against the revision the current page was rendered at, and only
-- calls router.refresh() when the two differ.
--
-- --- properties this has to have --------------------------------------------
--
--   false positives are free      An unnecessary bump costs one refresh, which
--                                 is what used to happen every time anyway.
--   false negatives are silent    A missed bump is a portal that stops updating
--                                 and gives no sign of it. So the trigger goes
--                                 on everything the portal reads, including
--                                 tables whose changes are usually accompanied
--                                 by a bump from somewhere else.
--   it cannot be forged           A merchant who could freeze this could freeze
--                                 everyone else's screen. Hence no grants to
--                                 authenticated, and a SECURITY DEFINER trigger.

-- ---------------------------------------------------------------------------
-- portal_pulse — one row, one counter
-- ---------------------------------------------------------------------------
create table public.portal_pulse (
  -- Singleton, the same idiom as pricing_params and branding.
  id smallint primary key default 1,
  -- Monotonic. The value means nothing on its own; only "same as last time" or
  -- "not the same as last time" is ever asked of it.
  revision bigint not null default 0,
  -- Not read by the app. It is here because the first question anyone debugging
  -- a portal that has stopped refreshing will ask is "is this thing moving at
  -- all", and a bare counter cannot answer it.
  changed_at timestamptz not null default now(),

  constraint portal_pulse_singleton check (id = 1)
);

insert into public.portal_pulse (id) values (1);

comment on table public.portal_pulse is
  'One counter, bumped by a statement trigger on every table the portal renders from. Read by the poll to decide whether a refresh would find anything.';

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, unlike every other trigger helper here, and for a reason
-- worth stating: `authenticated` is granted nothing at all on portal_pulse, so
-- an invoker-rights trigger would fail on the merchant's own INSERT. Granting
-- the write instead would let any signed-in browser update the row through the
-- Data API — pinning it, so every other portal in the building stops noticing
-- that anything changed. The definer is the way to write the row without
-- handing out the ability to write the row.
--
-- search_path is empty and both names below are fully qualified, which is what
-- makes SECURITY DEFINER safe to use here.
create or replace function private.bump_portal_pulse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.portal_pulse
     set revision = revision + 1,
         changed_at = now()
   where id = 1;
  -- AFTER STATEMENT: the return value is discarded.
  return null;
end;
$$;

comment on function private.bump_portal_pulse() is
  'Marks the portal as changed. Attached AFTER STATEMENT to every table the portal renders from.';

-- Same reasoning as private.touch_updated_at(): Postgres grants EXECUTE to
-- PUBLIC on every new function, and this one writes a row its callers are
-- deliberately not allowed to write.
revoke execute on function private.bump_portal_pulse() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attaching it
-- ---------------------------------------------------------------------------
-- FOR EACH STATEMENT, not FOR EACH ROW. A settlement that writes forty
-- settlement_lines should bump this once; the counter is a detector, not a
-- tally, and the row lock below is not worth taking forty times.
--
-- The list is the part that has to be right, so it is written as a list rather
-- than as a dozen near-identical CREATE TRIGGER blocks. A table added later
-- that the portal renders from needs a line here, or that screen quietly stops
-- refreshing itself.
--
-- Deliberately absent: rate_limits and idempotency_keys, which no screen
-- renders and which are written on a large fraction of requests — including,
-- once this is live, requests that are only asking whether anything changed.
-- And portal_pulse itself, which would recurse.
do $$
declare
  t text;
begin
  foreach t in array array[
    'deliveries',
    -- Link state is not on any screen today, and a link is almost always minted
    -- or redeemed in the same breath as a delivery transition that bumps this
    -- anyway. It is here because "almost always" is the wrong confidence level
    -- for the failure that goes unnoticed.
    'delivery_links',
    'delivery_notifications',
    'riders',
    'profiles',
    'settlements',
    'settlement_lines',
    'pricing_params',
    'delivery_options',
    'branding',
    'app_settings',
    'user_activity'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each statement execute function private.bump_portal_pulse()',
      t || '_bump_portal_pulse',
      t
    );
  end loop;
end;
$$;

-- --- on the single hot row --------------------------------------------------
--
-- Every write in the portal now ends by updating the same row, so concurrent
-- writers serialise on it until they commit. That is a real cost and it is the
-- right trade here: this portal's writes are people filing deliveries and riders
-- tapping accept, measured in a handful a minute, against a read path that was
-- re-reading a year of history every twenty-five seconds per open tab.
--
-- It cannot deadlock. The trigger fires AFTER the statement's own row locks are
-- taken, so this row is always acquired last and always alone — there is no
-- second lock for a waiter to be holding.
--
-- If the write rate ever makes this contended, the fix is to split the counter
-- by stream (deliveries / money / settings) so unrelated writes stop queueing
-- behind each other, and have the poll send the streams its screen actually
-- reads. That was not worth doing first: the alert bell reads deliveries and
-- sits on every screen, so nearly every tab would watch the busiest stream
-- regardless.

-- ---------------------------------------------------------------------------
-- Access — the rate_limits shape: RLS on, no policies, no public grants
-- ---------------------------------------------------------------------------
-- The server reads this with its service-role client, which has BYPASSRLS, and
-- nothing else may touch it. Not granting it to `authenticated` also settles a
-- question it would otherwise raise: the counter is global, so a merchant able
-- to read it would learn that *something* changed somewhere in the portal, which
-- is a weak signal but not one they need.
alter table public.portal_pulse enable row level security;

-- No FORCE here, unlike its neighbours, and not by oversight: FORCE applies RLS
-- to the table owner, and the owner is exactly who bump_portal_pulse() runs as.
-- With no policies on the table that would turn every bump into a silent no-op
-- and the portal would stop refreshing. Grants are what actually keep callers
-- out, which makes the revoke below the load-bearing line here, not the RLS.
--
-- Not granting is not the same as it not being granted — see
-- 20260818144747_revoke_unintended_default_table_grants.sql, which exists
-- because of this exact trap. Supabase's ALTER DEFAULT PRIVILEGES on the public
-- schema hand anon and authenticated the full set on every newly created table,
-- and a freshly created portal_pulse came out with TRUNCATE and TRIGGER on it
-- for both roles. RLS would not have stopped either of those: TRUNCATE is not a
-- row operation, so any signed-in browser could have dropped the singleton row
-- and left the counter unreadable for everybody.
revoke all on public.portal_pulse from anon, authenticated;

grant select on public.portal_pulse to service_role;
