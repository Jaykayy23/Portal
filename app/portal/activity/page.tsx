import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { listActivity } from '@/lib/activity';
import { listAccounts } from '@/lib/accounts';
import { isActivityAction } from '@/lib/activityText';
import { LANDING_PATH } from '@/lib/types';
import { ActivityPane, hrefWith, type ActivityQuery } from '@/components/activity/ActivityPane';

/** A yyyy-mm-dd from the date inputs, or '' for anything else. */
function dateParam(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * "sort~id", which is the whole position of the last row on the previous page.
 *
 * Split on the last tilde rather than the first: the sort half is a timestamp
 * and the id half is digits, so neither can contain one — but the parse should
 * not depend on that being true forever.
 */
function parseCursor(raw: string): { sort: string; id: string } | null {
  const at = raw.lastIndexOf('~');
  if (at <= 0) return null;
  const sort = raw.slice(0, at);
  const id = raw.slice(at + 1);
  // Anything that is not a real position is dropped rather than passed on. A
  // malformed cursor from a mangled URL should show the newest page, not an
  // error about a filter nobody typed.
  if (!/^\d+$/.test(id) || Number.isNaN(Date.parse(sort))) return null;
  return { sort, id };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Who has been doing what in this portal.
 *
 * Admin only, three times over: the tab is not rendered for anyone else, this
 * redirects them, and `user_activity_select_admin` returns them no rows even if
 * they reach the Data API directly. The redirect is the courtesy; the policy is
 * the guarantee.
 */
export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roleAllows(user, 'admin')) redirect(LANDING_PATH);

  const sp = await searchParams;
  const action = one(sp.action);
  const query: ActivityQuery = {
    who: one(sp.who),
    // Silently dropped if it is not an action this build knows about, so a stale
    // bookmark shows everything rather than an empty table with no explanation.
    action: isActivityAction(action) ? action : '',
    from: dateParam(one(sp.from)),
    to: dateParam(one(sp.to)),
  };
  const cursor = parseCursor(one(sp.cursor));

  const [page, accounts] = await Promise.all([
    listActivity({
      actorUsername: query.who,
      action: query.action,
      from: query.from ? `${query.from}T00:00:00.000Z` : undefined,
      // The 'to' field names a day the admin wants included, so the exclusive
      // bound is the start of the day after it. Passing the date itself would
      // silently drop everything that happened on it.
      before: query.to ? `${nextDay(query.to)}T00:00:00.000Z` : undefined,
      cursor,
    }),
    listAccounts(),
  ]);

  return (
    <ActivityPane
      entries={page.entries}
      accounts={accounts}
      query={query}
      olderHref={page.next ? hrefWith(query, `${page.next.sort}~${page.next.id}`) : null}
      paged={cursor !== null}
    />
  );
}

/** yyyy-mm-dd, one day on. UTC throughout, like deliveryHistoryRange. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
