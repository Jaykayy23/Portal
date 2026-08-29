// "Has anything changed?" — the cheap question the portal poll asks first.
//
// Every open portal tab re-renders itself every twenty-five seconds, and that
// render reads a year of deliveries and adds them up in JavaScript. On a portal
// where deliveries are filed by hand, almost every one of those polls does all
// of that work to conclude the screen was already correct.
//
// So the poll reads this instead. One row, one integer, bumped by a trigger on
// every table the portal renders from — see the portal_pulse migration for how
// it is maintained and why it cannot be forged. The number means nothing on its
// own; the client only ever compares it against the revision its current page
// was rendered at.
//
// Server-only: it reaches the admin client. The table is granted to no public
// role, which is deliberate — the counter is global, so a merchant able to read
// it would learn that *something* changed somewhere in the portal.
import 'server-only';

import { createAdminClient } from './supabase/admin';
import { logFailure } from './errors';

/**
 * PostgREST's "no such table", which is what an app deployed ahead of its
 * migration gets back.
 *
 * Not Postgres' own 42P01: the request is refused against PostgREST's schema
 * cache and never reaches a planner that could raise it. Confirmed against the
 * live project rather than assumed — the two codes are easy to mix up, and this
 * one decides whether the log stays readable between deploy and migration.
 */
const MISSING_TABLE = 'PGRST205';

/**
 * The current revision, or null when it cannot be read.
 *
 * Null is the honest answer to "has anything changed?" when we do not know, and
 * every caller treats it as "assume yes". That is what makes this safe to deploy
 * ahead of its migration: an app whose database has no portal_pulse table asks
 * PostgREST for something that is not there, logs it, answers null, and the
 * portal refreshes on every tick exactly as it did before this existed. The same
 * goes for a database blip — the failure mode is the old behaviour, never a
 * portal that has silently stopped updating itself.
 *
 * A string rather than a number because it is only ever compared for equality,
 * and because it crosses to the browser as JSON, where a bigint would not
 * survive the trip intact forever.
 */
export async function readPortalPulse(): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from('portal_pulse')
      .select('revision')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      // Deployed ahead of the migration. Expected, self-healing the moment the
      // migration lands, and read by every portal render — so it is answered,
      // not reported. A line here would arrive several times a minute per open
      // tab and bury the failures that do mean something.
      if (error.code === MISSING_TABLE) return null;
      throw new Error(error.message);
    }

    // No row is not an error worth raising, but it is not a revision either.
    return data ? String(data.revision) : null;
  } catch (e) {
    logFailure('portalPulse.readPortalPulse', e);
    return null;
  }
}
