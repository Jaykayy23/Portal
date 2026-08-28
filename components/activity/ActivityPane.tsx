import Link from 'next/link';
import { fmtDateTime } from '@/lib/format';
import { ScrollableTable } from '@/components/ScrollableTable';
import {
  ACTIVITY_GROUPS,
  actionLabel,
  actorName,
  describeActivity,
} from '@/lib/activityText';
import type { ActivityEntry, PublicAccount } from '@/lib/types';

export interface ActivityQuery {
  who: string;
  action: string;
  from: string;
  to: string;
}

interface Props {
  entries: ActivityEntry[];
  /** The dropdown's contents. Admin reads every account, so this is all of them. */
  accounts: PublicAccount[];
  query: ActivityQuery;
  /** Href for the next (older) page, or null at the end of the set. */
  olderHref: string | null;
  /** True when this is not the first page — the "newest" link goes back to it. */
  paged: boolean;
}

/**
 * The admin's activity log.
 *
 * A Server Component with no interactivity of its own, which is unusual for a
 * pane in this portal and is the right shape here. The filters are a plain GET
 * form and paging is two links, so the whole screen is bookmarkable, survives a
 * refresh, and works with the browser's back button — and the table itself never
 * has to hold a page of rows in React state on a table that only grows.
 *
 * Rows are not links. Every line names the thing it is about — an order number, a
 * username, a rider — and an audit log whose lines navigate away is one that
 * loses your place the moment you follow a hunch.
 */
export function ActivityPane({ entries, accounts, query, olderHref, paged }: Props) {
  const filtered = !!(query.who || query.action || query.from || query.to);

  return (
    <div className="somo-card" style={{ marginTop: 0 }}>
      <h3>
        Activity
        <span className="tag-note">admin view — every seat, newest first</span>
      </h3>

      {/* method="get" rather than a client component with state: the filters
          become the URL, which is what makes a filtered view something an admin
          can bookmark or paste to somebody else. `cursor` is deliberately not a
          field here, so changing any filter starts again at the newest row
          instead of resuming from a position in a different result set. */}
      <form className="somo-filters" method="get">
        <label className="somo-filter">
          <span>Who</span>
          <select className="somo-select" name="who" defaultValue={query.who}>
            <option value="">Everyone</option>
            {accounts.map((a) => (
              <option key={a.username} value={a.username}>
                {a.username} · {a.role}
                {a.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>

        <label className="somo-filter">
          <span>Activity</span>
          <select className="somo-select" name="action" defaultValue={query.action}>
            <option value="">Anything</option>
            {Object.entries(ACTIVITY_GROUPS).map(([group, actions]) => (
              <optgroup key={group} label={group}>
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="somo-filter">
          <span>From</span>
          <input className="somo-input" type="date" name="from" defaultValue={query.from} />
        </label>

        <label className="somo-filter">
          <span>To</span>
          <input className="somo-input" type="date" name="to" defaultValue={query.to} />
        </label>

        <div className="somo-filter">
          <span>&nbsp;</span>
          <div className="somo-btn-row">
            <button className="somo-btn small" type="submit">
              Apply
            </button>
            {filtered || paged ? (
              <Link className="somo-btn ghost small" href="/portal/activity">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {entries.length === 0 ? (
        <div className="somo-empty">
          <div className="big">{filtered ? 'Nothing matches those filters' : 'Nothing recorded yet'}</div>
          {filtered
            ? 'Widen the date range, or clear the filters to see everything.'
            : 'Actions are recorded from the moment this page went live — anything done before that is not here.'}
        </div>
      ) : (
        <>
          <ScrollableTable label="Activity log" stacks>
            <table className="somo-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What they did</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="When" className="somo-activity-when">
                      {/* The full timestamp in the tooltip: fmtDateTime drops the
                          year and the seconds, and "which of these two happened
                          first" is a question this table gets asked.

                          Formatted on the server, unlike the delivery log, which
                          does it in the browser — so these times are the server's
                          timezone rather than the reader's. Identical in practice:
                          this portal is Ghana-facing (GHS, Ghanaian numbers, a
                          Ghanaian SMS provider) and Ghana is UTC. Worth knowing if
                          that ever stops being true. */}
                      <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                        {fmtDateTime(entry.at)}
                      </time>
                    </td>
                    <td data-label="Who">
                      <span className="somo-activity-who">{actorName(entry)}</span>
                      {entry.actorRole ? (
                        <span className={`somo-role-tag ${entry.actorRole}`}>{entry.actorRole}</span>
                      ) : null}
                    </td>
                    <td data-label="What they did">{describeActivity(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>

          {/* Keyset paging, so this is one-way: "older" carries the position of
              the last row on screen. There is no page number to jump to, and on
              a table written to this often there could not honestly be one. */}
          <div className="somo-table-actions somo-activity-pager">
            {paged ? (
              <Link
                className="somo-btn ghost small somo-newest"
                href={hrefWith(query, null)}
              >
                ← Back to newest
              </Link>
            ) : null}
            {olderHref ? (
              <Link className="somo-btn ghost small" href={olderHref}>
                Older →
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The page's own URL with these filters and this cursor.
 *
 * Exported because the page builds the "older" href from the last row it read,
 * and the pane builds the "back to newest" one from the same filters — two
 * callers, one place that knows the parameter names.
 */
export function hrefWith(query: ActivityQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  if (query.who) params.set('who', query.who);
  if (query.action) params.set('action', query.action);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/portal/activity?${qs}` : '/portal/activity';
}
