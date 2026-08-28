'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiDownload, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, orderNo, statusBadgeClass } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import {
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type DeliveryWithMerchant,
  type Rider,
} from '@/lib/types';
import { FLOAT_DEADLINE_HOURS, type RiderFloat } from '@/lib/ledger';
import { fmtMoney as money } from '@/lib/format';
import { amountsDue, cashToCollect } from '@/lib/amounts';
import { ScrollableTable } from '@/components/ScrollableTable';
import { ProgressiveRows } from '@/components/ProgressiveRows';
import { Bell, BellRing, Download, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useAlerts } from '@/components/AlertBell';
import { useRefreshHold } from '@/components/PortalRefresh';

/**
 * Below this the table stops being a table.
 *
 * Fifteen columns cannot be made to work on a phone by shrinking them, and this
 * screen is one a merchant opens on one — so each row becomes a card of
 * label/value pairs instead. Matched to the 640px breakpoint the rest of the
 * stylesheet already uses for the same decision.
 */
const STACK_QUERY = '(max-width: 640px)';

/**
 * Remembers the compact choice across visits.
 *
 * Worth persisting rather than defaulting: whether the detail columns are in the
 * way depends on the screen someone works on, and that does not change from one
 * day to the next.
 */
const COMPACT_KEY = 'somo.log.compact';

/**
 * Does this row match what someone typed?
 *
 * The order number is the reason this exists — it is what people read to each
 * other on the phone — so "SME4f2a1", the bare "4f2a1" someone remembers off an
 * older waybill, and a leading '#' from the same habit all find the same row.
 * The full uuid is matched too, for anyone pasting one out of a URL or a log
 * line.
 * Everything else people might reach for is included because it costs nothing:
 * a customer, an address, a rider, the person receiving it, a phone number.
 */
function matchesQuery(r: DeliveryWithMerchant, query: string): boolean {
  const needle = query.replace(/^#/, '');
  if (!needle) return true;

  return [
    orderNo(r.id),
    r.id,
    r.customer,
    r.pickup,
    r.dropoff,
    r.riderName,
    r.riderPhone,
    r.recipientName,
    r.recipientPhone,
    r.status,
  ].some((field) => (field ?? '').toLowerCase().includes(needle));
}

/**
 * Declared item value + delivery fee, from the delivery's payment terms.
 *
 * Ops need it in the log for the same reason the rider needs it in their
 * message: it is what somebody is expected to hand over at the door, and the sum
 * is the system's job rather than a thing to be done in your head over the phone.
 * lib/amounts.ts is the one calculation behind all three surfaces.
 */
function cashDue(r: DeliveryWithMerchant): number {
  return cashToCollect(amountsDue(r));
}

/**
 * The furthest-along milestone on a row, for the small line under the status.
 *
 * Only one is shown: the newest. Ops wants "where is this now", and a column
 * carrying five timestamps would be unreadable — the full trail is in the export.
 */
function milestone(r: DeliveryWithMerchant): { label: string; at: string } | null {
  if (r.deliveredAt) return { label: '✓ delivered — rider signed off', at: r.deliveredAt };
  // Said plainly rather than as "recipient confirmed": from a merchant's side this
  // is the moment the parcel arrived, and that is what they are looking for.
  if (r.recipientConfirmedAt) {
    return { label: '✓ delivered — customer confirmed', at: r.recipientConfirmedAt };
  }
  if (r.pickedUpAt) return { label: 'picked up — on the way', at: r.pickedUpAt };
  if (r.acceptedAt) return { label: '✓ rider accepted', at: r.acceptedAt };
  if (r.declinedAt) return { label: '× rider declined', at: r.declinedAt };
  return null;
}

export function DeliveryLog({
  records,
  riders,
  floats,
  opsPhone,
  canManage,
}: {
  records: DeliveryWithMerchant[];
  riders: Rider[];
  /**
   * What each rider is still holding, and for how long.
   *
   * Only used to grey out a rider the database will refuse anyway — see
   * `private.block_overdue_rider_assignment`. Offering an option that can only
   * fail is worse than not offering it, but the refusal is the database's.
   */
  floats: RiderFloat[];
  opsPhone: string;
  /** Ops/admin get inline status + rider controls; merchants get read-only rows. */
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  // The one number, from the one place that derives it. Null outside the portal
  // layout, which is only ever the case in a test that renders this on its own.
  const alerts = useAlerts();
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Compact drops the six detail columns — distance, time, type, item, cost,
   * recommended price — leaving what ops actually works from: who, where,
   * what was agreed, where it has got to, and who is carrying it. On a laptop that
   * is the difference between a table that fits and one you drag sideways.
   *
   * Starts full, because a first visit that silently hides columns looks like
   * missing data rather than a setting.
   */
  const [compact, setCompact] = useState(false);

  /**
   * Is the table currently stacked into cards?
   *
   * The stacking itself is the stylesheet's job. This exists only for the one
   * thing CSS cannot reach: the word "columns", which describes nothing once
   * each row is a card.
   */
  const [narrow, setNarrow] = useState(false);

  // Read after mount, never during render: the server has no localStorage, and
  // reading it in useState would make the first client render disagree with the
  // server's and throw a hydration error.
  useEffect(() => {
    setCompact(window.localStorage.getItem(COMPACT_KEY) === '1');
  }, []);

  // Same reason, plus one more: the server has no viewport either. Both start
  // false so the first client render matches the server's, then correct
  // themselves after mount.
  useEffect(() => {
    const mq = window.matchMedia(STACK_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    // A phone rotating into landscape crosses this boundary, and so does anyone
    // dragging a desktop window narrow.
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  function toggleCompact() {
    setCompact((wasCompact) => {
      const next = !wasCompact;
      try {
        window.localStorage.setItem(COMPACT_KEY, next ? '1' : '0');
      } catch {
        // Private browsing, or storage full. The toggle still works for this visit.
      }
      return next;
    });
  }

  // The poll that keeps this screen current lives in the portal layout now — one
  // timer for the whole portal rather than one per screen that happens to care,
  // because the topbar bell has to be up to date on every tab. This screen's only
  // remaining interest in it is asking it to hold still while the alerts modal is
  // open: re-rendering underneath someone who is mid-way through copying a link is
  // worse than being 25 seconds stale.
  useRefreshHold(!!notify);

  /** The impatient path — same soft refresh, on demand. */
  function refreshNow() {
    setRefreshing(true);
    router.refresh();
    // Nothing resolves here to wait on, so this is a deliberate flicker: long
    // enough to read as "it did something", short enough not to block anything.
    setTimeout(() => setRefreshing(false), 600);
  }

  async function exportToExcel() {
    setExporting(true);
    try {
      // The server decides the columns and the filename — a merchant's file has
      // no merchant column, and only ever their own rows.
      await apiDownload('/deliveries/export', 'somoexpress-deliveries.xlsx');
    } catch (e) {
      toast(errMessage(e), 'danger');
    }
    setExporting(false);
  }

  // Both writes carry what this screen showed alongside what it wants. The list
  // can be a poll interval stale, and with two people working the same queue the
  // server refuses (409) a write against a row that has since changed — the
  // refresh in the catch then shows them what it changed to.
  async function changeStatus(id: string, status: DeliveryStatus, expectedStatus: DeliveryStatus) {
    try {
      const data = await api<{ alertsSent: boolean }>('/deliveries/' + id, {
        method: 'PATCH',
        body: { status, expectedStatus },
      });
      // Moving a row by hand announces itself exactly as the rider's own tap
      // would have. Worth saying so: ops setting a delivery to 'Picked up'
      // themselves has just texted the customer, and should know that.
      toast(data.alertsSent ? 'Status updated — alerts sent' : 'Status updated');
      router.refresh();
    } catch (e) {
      toast(errMessage(e), 'danger');
      // Re-sync the select with whatever the server actually has.
      router.refresh();
    }
  }

  async function assignRider(id: string, riderId: string, expectedRiderId: string) {
    try {
      const data = await api<{ delivery: DeliveryWithMerchant; alertsSent: boolean }>(
        '/deliveries/' + id,
        { method: 'PATCH', body: { riderId, expectedRiderId: expectedRiderId || null } }
      );
      toast(
        riderId
          ? data.alertsSent
            ? `Offered to ${data.delivery.riderName} — job offer sent`
            : `Offered to ${data.delivery.riderName}`
          : 'Rider unassigned'
      );
      router.refresh();
      // The job offer, with its accept/decline link, has already reached the
      // rider. The modal opens only when the portal cannot send it — there it is
      // still the one thing standing between an assignment and a rider who knows
      // about it.
      if (riderId && !data.alertsSent) setNotify(data.delivery);
    } catch (e) {
      toast(errMessage(e), 'danger');
      router.refresh();
    }
  }

  /** The merchant's one transition, and the customer message that follows it. */
  async function confirmPickup(id: string) {
    setConfirming(id);
    try {
      const data = await api<{ delivery: DeliveryWithMerchant; alertsSent: boolean }>(
        `/deliveries/${id}/pickup`,
        { method: 'POST' }
      );
      toast(
        data.alertsSent ? 'Pickup confirmed — the customer has been texted' : 'Pickup confirmed'
      );
      router.refresh();
      if (!data.alertsSent) setNotify(data.delivery);
    } catch (e) {
      toast(errMessage(e), 'danger');
      router.refresh();
    }
    setConfirming('');
  }

  // Filtered in the browser, not the database: the rows are already here, RLS has
  // already decided which ones, and a keystroke should not cost a round trip. If a
  // portal ever holds enough history that this feels slow, that is the point to
  // move the filter server-side with a paged query.
  /** Riders past the float deadline, by id, with what is holding them up. */
  const blocked = new Map(
    floats.filter((f) => f.overdue && f.riderId).map((f) => [f.riderId, f])
  );

  const trimmedQuery = query.trim().toLowerCase();
  const visible = trimmedQuery ? records.filter((r) => matchesQuery(r, trimmedQuery)) : records;

  // Only used to span the "nothing matches" row across the table. Keep in step
  // with the <th> list below if a column is ever added or removed — getting it
  // wrong is cosmetic, not broken.
  const columnCount = 8 + (canManage ? 1 : 0) + (compact ? 0 : 6);

  if (records.length === 0) {
    return (
      <div className="somo-empty">
        <div className="big">No deliveries logged yet</div>
        {canManage
          ? 'Nothing has been requested by any merchant yet.'
          : 'Requests you submit will show up here — visible only to you.'}
      </div>
    );
  }

  return (
    <>
      {/* The attention queue itself lives in the topbar bell now: as a band here it
          was six rows of the same information the table already carries, on the one
          screen with the least room to spare, and invisible from every other tab.
          What stays is the cue — one line saying how much is waiting, opening the
          panel that holds it. */}
      {alerts && alerts.feed.total > 0 ? (
        <button
          type="button"
          className="somo-attention-strip"
          // The second control for the topbar's one disclosure, so it reports the
          // same state. Opening from here moves focus into the panel, the same as
          // opening from the bell.
          aria-expanded={alerts.panelOpen}
          aria-controls="somo-alerts-panel"
          onClick={alerts.open}
        >
          <BellRing aria-hidden="true" size={14} />
          <span className="what">
            <strong>{alerts.feed.total}</strong>{' '}
            {alerts.feed.total === 1 ? 'delivery needs' : 'deliveries need'} attention
          </span>
          <span className="cta">Open alerts</span>
        </button>
      ) : null}

      <div className="somo-table-actions">
        <div className="somo-table-search">
          <input
            className="somo-input"
            type="search"
            placeholder="Search order #, customer, address, rider…"
            aria-label="Search deliveries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {trimmedQuery ? (
            <span className="count">
              {visible.length} of {records.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="somo-btn ghost small"
          onClick={toggleCompact}
          title={
            compact
              ? 'Show distance, time, type, item, value and recommended price'
              : narrow
                ? 'Hide the detail fields so each card is a few lines instead of a screenful'
                : 'Hide the detail columns so the table fits without scrolling sideways'
          }
        >
          {compact ? (
            <Maximize2 aria-hidden="true" size={13} />
          ) : (
            <Minimize2 aria-hidden="true" size={13} />
          )}
          {/* "Columns" describes nothing once each row is a card. */}
          <span>{compact ? (narrow ? 'All fields' : 'All columns') : 'Compact'}</span>
        </button>
        <button
          type="button"
          className="somo-btn ghost small"
          onClick={refreshNow}
          disabled={refreshing}
          title="Riders and customers update these from their phones — this checks for changes now"
        >
          <RefreshCw aria-hidden="true" size={13} className={refreshing ? 'somo-spin' : undefined} />
          <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
        <button
          type="button"
          className="somo-btn ghost small"
          onClick={exportToExcel}
          disabled={exporting}
          title={
            canManage
              ? 'Download every delivery as an Excel file'
              : 'Download your delivery history as an Excel file'
          }
        >
          <Download aria-hidden="true" size={13} />
          <span>{exporting ? 'Preparing…' : 'Export to Excel'}</span>
        </button>
      </div>

      <ScrollableTable label="Delivery log" stacks>
        <table className="somo-table">
          <thead>
            <tr>
              <th>Date</th>
              {/* Never hidden by Compact: it is how people refer to a delivery
                  out loud, so it has to be on every row. */}
              <th>Order</th>
              {canManage && <th>Customer</th>}
              <th>Route</th>
              {!compact && (
                <>
                  <th>Distance</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Item</th>
                  <th>Cost</th>
                </>
              )}
              <th>Price</th>
              {/* Never hidden by Compact: whether a rider is carrying cash home is
                  not a detail. */}
              <th>Payment</th>
              <th>Status</th>
              <th>Rider</th>
              <th>{canManage ? 'Alerts' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            <ProgressiveRows colSpan={columnCount} initial={100} step={100}>
              {visible.map((r) => {
              const step = milestone(r);
              const collect = cashDue(r);
              // Every cell carries a data-label so the stylesheet can label it
              // once the table stacks into cards under 640px — the thead that
              // normally names the column is not rendered there. Keep these in
              // step with the th text above.
              return (
                <tr key={r.id}>
                  {/* --somo-muted, not --muted: the latter is shadcn's muted
                      *background*, which rendered this date as pale grey on white
                      and all but invisible. */}
                  <td className="somo-date-cell" data-label="Date">
                    {fmtDateTime(r.date)}
                  </td>
                  {/* The full uuid on hover, for anyone who needs to paste one. */}
                  <td className="somo-order-cell" data-label="Order" title={r.id}>
                    {orderNo(r.id)}
                  </td>
                  {canManage && <td data-label="Customer">{r.customer}</td>}
                  <td data-label="Route">
                    {r.pickup} → {r.dropoff}
                    {/* Sits under the route rather than in its own column: it is
                        who is waiting at that drop-off, and the table is wide
                        enough already. Blank on pre-recipient rows. */}
                    {r.recipientName ? (
                      <>
                        <br />
                        <span className="somo-rider-sub">
                          {r.recipientName} · {r.recipientPhone}
                        </span>
                      </>
                    ) : null}
                  </td>
                  {!compact && (
                    <>
                      <td className="somo-price-cell" data-label="Distance">
                        {r.distance.toFixed(1)} km
                      </td>
                      <td className="somo-price-cell" data-label="Time">
                        {r.durationMin > 0 ? `${r.durationMin.toFixed(0)} min` : '—'}
                      </td>
                      <td data-label="Type">{r.type}</td>
                      {/* Blank for rows filed before item categories existed. */}
                      <td data-label="Item">{r.itemCategory || '—'}</td>
                      <td className="somo-price-cell" data-label="Cost">
                        GHS {(r.declaredValue || 0).toFixed(0)}
                      </td>
                    </>
                  )}
                  <td className="somo-agreed-cell" data-label="Price">
                    {fmtMoney(r.price)}
                  </td>

                  <td className="somo-payment-cell" data-label="Payment">
                    {r.itemPayment ? (
                      <>
                        {r.itemPayment === 'Cash on delivery' ? (
                          <span className="somo-badge b-approval">COD</span>
                        ) : (
                          <span className="somo-badge b-delivered">Prepaid</span>
                        )}
                        <br />
                        <span className="somo-rider-sub">
                          {r.deliveryPaidBy ? `${r.deliveryPaidBy.toLowerCase()} pays fee` : '—'}
                        </span>
                        {/* The figure the rider was sent, not a second sum of the
                            two columns to its left: ops answering "how much am I
                            collecting?" on the phone must read the same number
                            out that the message and the rider's page show. */}
                        {collect > 0 ? (
                          <>
                            <br />
                            <span className="somo-collect-note">collect {money(collect)}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="somo-unassigned">—</span>
                    )}
                  </td>

                  <td data-label="Status">
                    {canManage ? (
                      <select
                        className="somo-status-select"
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value as DeliveryStatus, r.status)}
                      >
                        {DELIVERY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`somo-badge ${statusBadgeClass(r.status)}`}>
                        {r.status}
                      </span>
                    )}
                    {/* The newest milestone that was recorded by a rider, a
                        recipient or the merchant — never by ops editing the
                        dropdown, which is what makes it worth showing. */}
                    {step ? (
                      <div className="somo-confirmed-note">
                        {step.label} {fmtDateTime(step.at)}
                      </div>
                    ) : null}
                  </td>

                  <td data-label="Rider">
                    {canManage ? (
                      <select
                        className="somo-status-select"
                        value={r.riderId}
                        onChange={(e) => assignRider(r.id, e.target.value, r.riderId)}
                      >
                        <option value="">Unassigned</option>
                        {riders.map((rider) => {
                          const held = blocked.get(rider.id);
                          return (
                            <option
                              key={rider.id}
                              value={rider.id}
                              // Left in the list rather than filtered out, so it is
                              // clear *why* a rider is unavailable instead of them
                              // silently vanishing from the roster.
                              disabled={!!held && rider.id !== r.riderId}
                            >
                              {rider.name} — {rider.regNumber || 'no reg'} (
                              {held
                                ? `owes ${money(held.total)} — ${FLOAT_DEADLINE_HOURS}h overdue`
                                : rider.status}
                              )
                            </option>
                          );
                        })}
                      </select>
                    ) : r.riderName ? (
                      <>
                        {r.riderName}
                        <br />
                        <span className="somo-rider-sub">
                          {r.riderPhone} · {r.riderModel} {r.riderReg}
                        </span>
                      </>
                    ) : (
                      <span className="somo-unassigned">Not yet assigned</span>
                    )}
                  </td>

                  <td className="somo-action-cell" data-label={canManage ? 'Alerts' : 'Action'}>
                    {canManage ? (
                      <button className="somo-notify-btn" onClick={() => setNotify(r)}>
                        <Bell aria-hidden="true" size={14} />
                        <span>Notify</span>
                      </button>
                    ) : r.status === 'Assigned' ? (
                      <button
                        className="somo-notify-btn"
                        disabled={confirming === r.id}
                        onClick={() => confirmPickup(r.id)}
                      >
                        {confirming === r.id ? 'Confirming…' : 'Confirm pickup'}
                      </button>
                    ) : r.status === 'Picked up' ? (
                      <button className="somo-notify-btn" onClick={() => setNotify(r)}>
                        <Bell aria-hidden="true" size={14} />
                        <span>Resend to customer</span>
                      </button>
                    ) : (
                      <span className="somo-unassigned">—</span>
                    )}
                  </td>
                </tr>
              );
              })}
            </ProgressiveRows>

            {visible.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="somo-nomatch">
                  Nothing matches <strong>{query.trim()}</strong>.{' '}
                  <button type="button" className="somo-inline-link" onClick={() => setQuery('')}>
                    clear the search
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </ScrollableTable>

      <NotifyModal record={notify} opsPhone={opsPhone} onClose={() => setNotify(null)} />
    </>
  );
}
