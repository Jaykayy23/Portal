// Writing and reading the activity log.
//
// Two halves with opposite rules:
//
//   logActivity   never throws, never blocks, never fails the thing it is
//                 describing. It returns void rather than a promise so a
//                 forgotten `await` cannot be a bug, and the insert runs in
//                 after(), past the response — the same shape as the automatic
//                 alerts in lib/autoNotify.ts, and for the same reason: nobody
//                 is waiting on it and there is nothing they could do with the
//                 result.
//
//   listActivity  a normal read through the caller's own session, so the
//                 admin-only SELECT policy in the migration is what enforces
//                 who sees this and not the redirect on the page.
//
// What may go into `details`, and what may not
// --------------------------------------------
// In: the shape of the change — old and new status, a rider's name, how many
// rows an export carried, which settings fields were touched. All of it is
// already visible to the admin reading the page.
//
// Out: passwords (including the generated ones from a reset), API keys, link
// tokens, session tokens, and whole request bodies. A request body is the
// dangerous one because it is the convenient one: `details: body` looks like
// thoroughness and is how the day's provider key ends up in a table with a
// twelve-month retention.

import { after } from 'next/server';
import { createAdminClient } from './supabase/admin';
import { createSupabaseServerClient } from './supabase/server';
import { keysetBefore, type ReadCursor } from './pagedRead';
import { logFailure, userMessage } from './errors';
import type { ActivityAction } from './activityText';
import type { ActivityEntry, SessionUser } from './types';
import type { Database } from './database.types';

type ActivityRow = Database['public']['Tables']['user_activity']['Row'];

export class ActivityError extends Error {}

/**
 * How long a line is kept.
 *
 * Twelve months because that is the window the rest of the portal already works
 * in (DELIVERY_HISTORY_DAYS), so "who touched this delivery" has an answer for
 * exactly as long as the delivery itself is on screen. Nothing here is a legal
 * record, and an audit table with no ceiling is a table that eventually costs
 * more to keep than the questions it answers are worth.
 */
export const ACTIVITY_RETENTION_DAYS = 365;

/** One screenful. Also the page size of the keyset read behind "Older". */
export const ACTIVITY_PAGE_SIZE = 100;

export interface ActivityInput {
  /** Whoever the server resolved from the session cookie — never client input. */
  actor: SessionUser;
  action: ActivityAction;
  /** 'delivery' | 'account' | 'rider' | 'settlement' | 'settings' | ''. */
  entityType?: string;
  entityId?: string;
  /** What to call it on screen — an order number, a username, a rider's name. */
  entityLabel?: string;
  details?: Record<string, unknown>;
}

/**
 * Records that somebody did something. Returns immediately; nothing to await.
 *
 * Deliberately not async. An activity write that a caller could await is an
 * activity write that will one day be inside a try/catch that turns a full
 * audit-log disk into a failed delivery.
 */
export function logActivity(input: ActivityInput): void {
  try {
    after(() => writeEntry(input));
  } catch (e) {
    // after() throws outside a request scope — a script, a test importing the
    // module. There is nothing to defer to and nothing to tell anyone, so the
    // log is the whole of the handling.
    logFailure('activity.logActivity (schedule)', e);
  }
}

async function writeEntry(input: ActivityInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('user_activity').insert({
      actor_id: input.actor.id,
      // Snapshotted, not joined. See the column comments in the migration.
      actor_username: input.actor.username,
      actor_role: input.actor.role,
      action: input.action,
      entity_type: input.entityType ?? '',
      entity_id: input.entityId ?? '',
      entity_label: input.entityLabel ?? '',
      details: (input.details ?? {}) as Database['public']['Tables']['user_activity']['Insert']['details'],
    });

    if (error) {
      // The request this describes finished successfully some time ago. All that
      // is lost is the line about it, and the server log is where that is said.
      logFailure(`activity.writeEntry (${input.action})`, error);
      return;
    }

    await sweepExpired(admin);
  } catch (e) {
    logFailure(`activity.writeEntry (${input.action})`, e);
  }
}

/**
 * Drops entries past the retention window.
 *
 * On a fraction of writes rather than on a schedule, which is what the rate-limit
 * and idempotency tables already do here for the same reason: there is no
 * pg_cron in this project. One in two hundred is enough — the table gains rows
 * at roughly the rate people click things, so the sweep runs many times a day on
 * any install busy enough to need it, and never on one that is not.
 *
 * Best-effort like everything else on this path: a failed sweep is a table that
 * is briefly larger than intended, which is not worth a line in anyone's day.
 */
async function sweepExpired(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  if (Math.random() >= 0.005) return;

  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await admin.from('user_activity').delete().lt('created_at', cutoff);
  if (error) logFailure('activity.sweepExpired', error);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ActivityFilter {
  /** Snapshotted username, which is what the dropdown offers. '' means anyone. */
  actorUsername?: string;
  action?: string;
  /** Inclusive ISO start of the range. */
  from?: string;
  /** Exclusive ISO end of the range. */
  before?: string;
  /** Where the previous page stopped. Null for the first page. */
  cursor?: ReadCursor | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /**
   * Where to resume, or null at the end of the set.
   *
   * Keyset rather than offset for the reason set out in lib/pagedRead.ts, which
   * bites hardest here: this table is written to constantly, so between one page
   * and the next an offset would have shifted under the reader and skipped a row.
   */
  next: ReadCursor | null;
}

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    // A bigint is safe as a JS number well past any volume this portal will
    // reach, but the cursor treats every id as a string, so it becomes one here
    // rather than at three call sites.
    id: String(row.id),
    at: row.created_at,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    details:
      row.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? (row.details as Record<string, unknown>)
        : {},
  };
}

/**
 * One page of the log, newest first.
 *
 * Read through the signed-in user's own client on purpose. The page redirects a
 * non-admin and the tab is hidden from them, but neither of those is what keeps
 * ops out of this table — `user_activity_select_admin` is, and routing the read
 * through the session is what puts that policy in the path.
 */
export async function listActivity(filter: ActivityFilter = {}): Promise<ActivityPage> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('user_activity')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // One more than a page: the extra row is how the caller knows there is
    // another page without a second count query over a table this size.
    .limit(ACTIVITY_PAGE_SIZE + 1);

  if (filter.actorUsername) query = query.eq('actor_username', filter.actorUsername);
  if (filter.action) query = query.eq('action', filter.action);
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.before) query = query.lt('created_at', filter.before);
  if (filter.cursor) query = query.or(keysetBefore('created_at', filter.cursor));

  const { data, error } = await query;
  if (error) {
    throw new ActivityError(
      userMessage('activity.listActivity', error, 'Could not load the activity log just now.')
    );
  }

  const rows = data ?? [];
  const hasMore = rows.length > ACTIVITY_PAGE_SIZE;
  const entries = rows.slice(0, ACTIVITY_PAGE_SIZE).map(toEntry);
  const last = entries[entries.length - 1];

  return {
    entries,
    next: hasMore && last ? { sort: last.at, id: last.id } : null,
  };
}
