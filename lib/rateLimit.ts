// Request rate limiting, counted in Postgres.
//
// Applied to two kinds of endpoint, and deliberately not to everything:
//
//   unauthenticated  — the rider confirmation link, the first-run setup route,
//                      the bootstrap probe. Anyone on the internet can call
//                      these, so they are the only real abuse surface.
//   expensive        — the Excel export (reads the whole history and zips it),
//                      account creation (writes to auth.users), delivery
//                      creation. A session is not a licence to run these in a
//                      loop.
//
// Ordinary authenticated reads are left alone: they are cheap, RLS already
// bounds what they return, and a limit on them would cost a round trip on every
// page load to prevent nothing.
//
// Login is not here because it never reaches this app — the browser talks to
// Supabase Auth directly, which applies its own per-IP limits on sign-in
// attempts. Moving login behind a Route Handler purely to count it would give up
// the SDK's cookie handling for a limit we already have.

import { createHash } from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { HttpError } from './http';

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Buckets are hashed before they reach the database.
 *
 * The identifier can be an IP address or a delivery id, and rate_limits is a
 * table nobody needs to read: hashing means it holds no list of who used the
 * portal from where.
 */
function bucketId(scope: string, identifier: string): string {
  return `${scope}:${createHash('sha256').update(identifier).digest('hex').slice(0, 32)}`;
}

/**
 * The caller's IP, or null when nothing trustworthy is available.
 *
 * On Vercel `x-forwarded-for` is set by the platform and cannot be spoofed by
 * the client. Behind your own reverse proxy it is only as good as that proxy's
 * configuration — if it does not set the header, this returns null and the
 * per-IP limits are skipped rather than lumping every visitor into one shared
 * bucket, which would let a single script lock out everyone else.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  // First entry is the original client; the rest are proxies it passed through.
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || null;
}

export function clientIp(req: Request): string | null {
  return clientIpFrom(req.headers);
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when not allowed. */
  retryAfterSeconds: number;
}

/**
 * Counts one request against its bucket.
 *
 * Fails open. If the database is unreachable this logs and allows the request:
 * a limiter that turns a slow database into a portal-wide outage is a worse
 * problem than the one it is preventing. The endpoints behind it all have their
 * own authorisation, so the limit is a shield, never the lock.
 */
export async function hitRateLimit(
  scope: string,
  identifier: string,
  { limit, windowSeconds }: RateLimit
): Promise<RateLimitResult> {
  const admin = createAdminClient();

  try {
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_bucket: bucketId(scope, identifier),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
  } catch (e) {
    console.error(`Rate limit check failed for ${scope} — allowing the request.`, e);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** As above, but the over-limit case ends the request with a 429. */
export async function enforceRateLimit(
  scope: string,
  identifier: string,
  limit: RateLimit
): Promise<void> {
  const { allowed, retryAfterSeconds } = await hitRateLimit(scope, identifier, limit);
  if (allowed) return;

  throw new HttpError(429, 'Too many requests — please wait a moment and try again.', {
    // Standard header: browsers and well-behaved clients wait rather than
    // hammering, and it tells an honest caller exactly how long.
    'Retry-After': String(retryAfterSeconds),
  });
}

/** Per-IP limit that no-ops when the deployment gives us no usable IP. */
export async function enforceIpRateLimit(
  scope: string,
  req: Request,
  limit: RateLimit
): Promise<void> {
  const ip = clientIp(req);
  if (!ip) return;
  await enforceRateLimit(scope, ip, limit);
}
