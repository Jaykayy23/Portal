-- Rate limiting and idempotency.
--
-- Why in Postgres and not in the Node process: the app is stateless and runs on
-- Vercel, so "the server" is a pool of lambdas that come and go. A counter in a
-- module-level Map would reset on every cold start and count separately in every
-- concurrent instance — which is to say it would not be a rate limit at all. The
-- database is the only thing all instances share.
--
-- The cost is one round trip per limited request. That is acceptable because the
-- limits are applied to the handful of endpoints that are either unauthenticated
-- or expensive, not to every read.

-- ---------------------------------------------------------------------------
-- rate_limits — one row per bucket, fixed window
-- ---------------------------------------------------------------------------
-- Fixed window rather than a sliding log: it is one row and one statement per
-- request instead of a row per request, and the failure mode (up to 2x the limit
-- across a window boundary) is irrelevant for limits whose job is to stop
-- scripted abuse, not to meter billing.
create table public.rate_limits (
  -- Namespaced by the caller, e.g. 'confirm-ip:41.66.x.x' or 'export:<uuid>'.
  -- Built and hashed in lib/rateLimit.ts so a bucket can never carry a raw
  -- token or anything else worth reading back out of this table.
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

comment on table public.rate_limits is
  'Fixed-window request counters. Written only by public.rate_limit_hit().';

-- ---------------------------------------------------------------------------
-- rate_limit_hit — count one request and say whether it is allowed
-- ---------------------------------------------------------------------------
-- The whole check is a single upsert so that two concurrent requests for the
-- same bucket serialise on the row lock instead of racing a read-then-write in
-- the application and both seeing "1".
--
-- SECURITY INVOKER, like every other function here: the only role granted
-- EXECUTE is service_role, which has BYPASSRLS, so it needs no elevation.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => p_window_seconds);
  v_hits integer;
  v_start timestamptz;
begin
  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
    -- An expired window is reset rather than deleted and re-inserted, which
    -- keeps the whole operation to one statement holding one lock.
    set hits = case when rl.window_start + v_window <= v_now then 1 else rl.hits + 1 end,
        window_start = case when rl.window_start + v_window <= v_now then v_now else rl.window_start end
  returning rl.hits, rl.window_start into v_hits, v_start;

  -- Buckets are per-IP and per-user, so the table would otherwise grow forever
  -- with rows nobody will ever hit again. Sweeping on a small fraction of calls
  -- keeps it bounded without needing pg_cron.
  if random() < 0.005 then
    delete from public.rate_limits where window_start < v_now - interval '1 day';
  end if;

  allowed := v_hits <= p_limit;
  retry_after_seconds := greatest(1, ceil(extract(epoch from (v_start + v_window) - v_now))::integer);
  return next;
end;
$$;

comment on function public.rate_limit_hit(text, integer, integer) is
  'Counts one request against a fixed window and returns whether it is under the limit.';

-- ---------------------------------------------------------------------------
-- idempotency_keys — make a retried POST safe to replay
-- ---------------------------------------------------------------------------
-- The case this exists for: a merchant on a bad connection taps "Log request",
-- the row is created, the response never arrives, and they tap again. Without
-- this they have filed the same delivery twice and someone has to spot it.
create table public.idempotency_keys (
  -- sha256 of scope + actor + the client's key. Hashed because the client's key
  -- is opaque to us and there is no reason to keep the original around.
  id text primary key,
  -- The successful response body, replayed verbatim on a retry. Null means the
  -- first attempt is still in flight (or died); see lib/idempotency.ts.
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Serves the sweep of expired keys.
create index idempotency_keys_expires_idx on public.idempotency_keys (expires_at);

comment on table public.idempotency_keys is
  'Replay cache for retried POSTs. Written only by the server''s service-role client.';

-- ---------------------------------------------------------------------------
-- RLS — the app_settings shape: enabled, and deliberately no policies
-- ---------------------------------------------------------------------------
-- Neither table has anything a browser should read: one is a set of counters
-- that would tell an attacker how close they are to a limit, the other holds
-- response bodies belonging to whoever made the original request. Only the
-- server's service-role client touches them.
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;

grant select, insert, update, delete on
  public.rate_limits, public.idempotency_keys to service_role;

-- Postgres grants EXECUTE to PUBLIC on every new function, so closing this is
-- not decorative: without it any signed-in user could burn another user's
-- budget, or reset their own, straight through the Data API.
revoke execute on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
