import { NextResponse } from 'next/server';
import { HttpError, handle } from '@/lib/http';
import { hasSessionToken } from '@/lib/session';
import { readPortalPulse } from '@/lib/portalPulse';

/**
 * What the portal poll asks before deciding to refresh.
 *
 * This is the cheapest endpoint in the app and has to stay that way — it is
 * called by every open tab every twenty-five seconds, which is the whole reason
 * it exists. One indexed single-row read, and an authorisation check that
 * verifies the JWT locally against the project's JWKS rather than reading the
 * profile row. See hasSessionToken() for why that is the right check here and
 * nowhere else.
 *
 * `revision` is null when the counter could not be read — an app deployed ahead
 * of its migration, or a database blip. The client reads that as "assume
 * something changed" and refreshes, which is what it did before any of this
 * existed.
 *
 * Not rate limited, consistent with lib/rateLimit.ts: ordinary authenticated
 * reads are left alone, and this is the cheapest of them. A limit here would
 * cost a round trip to the rate_limits table on every poll to protect a query
 * that costs less than the limit check.
 */
export async function GET() {
  return handle(async () => {
    if (!(await hasSessionToken())) {
      throw new HttpError(401, 'Session expired or invalid — please log in again.');
    }

    return NextResponse.json(
      { revision: await readPortalPulse() },
      // Nothing between here and the browser may hold on to this: a cached
      // pulse is a portal that never notices anything again.
      { headers: { 'Cache-Control': 'no-store' } }
    );
  });
}
