'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiDownload, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, shortId } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import {
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type DeliveryWithMerchant,
  type Rider,
} from '@/lib/types';

/**
 * Most the queue will show at once.
 *
 * Every unassigned request is genuinely waiting on ops, and an install with a
 * long backlog would otherwise push the table off the screen. The panel says how
 * many it is not showing rather than pretending the rest are handled.
 */
const QUEUE_LIMIT = 6;

/**
 * How often the log re-reads itself.
 *
 * Riders and customers move deliveries along from their own phones, so the most
 * important changes on this screen originate somewhere else entirely — a decline,
 * a pickup, a recipient confirming receipt. Without this, ops and merchants sit
 * looking at whatever was true when the page loaded and only find out by
 * reloading, which nobody thinks to do.
 *
 * A soft refresh, so it re-renders from the server without losing scroll
 * position, open dropdowns or the modal. Twenty-five seconds is short enough that
 * "confirmed" appears while you are still looking at the screen, and long enough
 * that a room of open tabs is not hammering the database.
 */
const REFRESH_MS = 25_000;

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
 * other on the phone — so it is matched with or without the leading '#', and the
 * full uuid is matched too for anyone pasting one out of a URL or a log line.
 * Everything else people might reach for is included because it costs nothing:
 * a customer, an address, a rider, the person receiving it, a phone number.
 */
function matchesQuery(r: DeliveryWithMerchant, query: string): boolean {
  const needle = query.replace(/^#/, '');
  if (!needle) return true;

  return [
    shortId(r.id),
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

const STATUS_CLASS: Record<DeliveryStatus, string> = {
  Requested: 'b-requested',
  Approved: 'b-assigned',
  Pending: 'b-requested',
  Declined: 'b-approval',
  Assigned: 'b-assigned',
  'Picked up': 'b-assigned',
  'Recipient confirmed': 'b-delivered',
  Delivered: 'b-delivered',
};

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

/**
 * What the person looking at this screen has to do next about a delivery.
 *
 * Derived from status rather than stored, so an item cannot go stale: it is
 * present exactly while the delivery is waiting on this reader, and disappears
 * the moment whoever it was waiting on acts. That is also why there is no
 * "mark as read" — the state is the alert.
 */
function actionNeeded(r: DeliveryWithMerchant, canManage: boolean): string | null {
  if (canManage) {
    switch (r.status) {
      case 'Requested':
      case 'Approved':
        return 'Assign a rider';
      case 'Pending':
        return `Waiting on ${r.riderName || 'the rider'} to accept or decline`;
      case 'Declined':
        return `${r.riderName || 'The rider'} declined — offer it to someone else`;
      case 'Assigned':
        return 'Send the merchant the rider’s details';
      case 'Recipient confirmed':
        return 'Send the rider their completion link';
      default:
        return null;
    }
  }
  // Merchants have exactly one step of their own: confirming the handover.
  return r.status === 'Assigned' ? 'Confirm the rider has collected the item' : null;
}

export function DeliveryLog({
  records,
  riders,
  opsPhone,
  canManage,
}: {
  records: DeliveryWithMerchant[];
  riders: Rider[];
  opsPhone: string;
  /** Ops/admin get inline status + rider controls; merchants get read-only rows. */
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Compact drops the six detail columns — distance, time, type, item, declared
   * value, recommended price — leaving what ops actually works from: who, where,
   * what was agreed, where it has got to, and who is carrying it. On a laptop that
   * is the difference between a table that fits and one you drag sideways.
   *
   * Starts full, because a first visit that silently hides columns looks like
   * missing data rather than a setting.
   */
  const [compact, setCompact] = useState(false);

  // Read after mount, never during render: the server has no localStorage, and
  // reading it in useState would make the first client render disagree with the
  // server's and throw a hydration error.
  useEffect(() => {
    setCompact(window.localStorage.getItem(COMPACT_KEY) === '1');
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

  useEffect(() => {
    // Held while the alerts modal is open: re-rendering underneath someone who is
    // mid-way through copying a link is worse than being 25 seconds stale.
    if (notify) return;

    const refreshIfVisible = () => {
      // A background tab does not need to be current, and a laptop full of them
      // should not be polling on the user's behalf.
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    // Coming back to the tab is the moment someone most wants it up to date.
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router, notify]);

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
      toast(errMessage(e));
    }
    setExporting(false);
  }

  async function changeStatus(id: string, status: DeliveryStatus) {
    try {
      await api('/deliveries/' + id, { method: 'PATCH', body: { status } });
      toast('Status updated');
      router.refresh();
    } catch (e) {
      toast(errMessage(e));
      // Re-sync the select with whatever the server actually has.
      router.refresh();
    }
  }

  async function assignRider(id: string, riderId: string) {
    try {
      const data = await api<{ delivery: DeliveryWithMerchant }>('/deliveries/' + id, {
        method: 'PATCH',
        body: { riderId },
      });
      toast(riderId ? `Offered to ${data.delivery.riderName}` : 'Rider unassigned');
      router.refresh();
      // Straight into the job offer, which is the only reason to assign someone.
      if (riderId) setNotify(data.delivery);
    } catch (e) {
      toast(errMessage(e));
      router.refresh();
    }
  }

  /** The merchant's one transition, and the customer message that follows it. */
  async function confirmPickup(id: string) {
    setConfirming(id);
    try {
      const data = await api<{ delivery: DeliveryWithMerchant }>(`/deliveries/${id}/pickup`, {
        method: 'POST',
      });
      toast('Pickup confirmed');
      router.refresh();
      setNotify(data.delivery);
    } catch (e) {
      toast(errMessage(e));
      router.refresh();
    }
    setConfirming('');
  }

  // Filtered in the browser, not the database: the rows are already here, RLS has
  // already decided which ones, and a keystroke should not cost a round trip. If a
  // portal ever holds enough history that this feels slow, that is the point to
  // move the filter server-side with a paged query.
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

  const queue = records
    .map((r) => ({ record: r, action: actionNeeded(r, canManage) }))
    .filter((item): item is { record: DeliveryWithMerchant; action: string } => !!item.action);
  const shown = queue.slice(0, QUEUE_LIMIT);
  const hidden = queue.length - shown.length;

  return (
    <>
      {queue.length > 0 && (
        <div className="somo-queue">
          <div className="somo-queue-head">
            Needs attention <span className="count">{queue.length}</span>
          </div>
          {shown.map(({ record, action }) => (
            <div className="somo-queue-row" key={record.id}>
              <div className="what">
                <span className="act">{action}</span>
                <span className="sub">
                  {record.customer} · {record.pickup} → {record.dropoff}
                </span>
              </div>
              {!canManage && record.status === 'Assigned' ? (
                <button
                  type="button"
                  className="somo-notify-btn"
                  disabled={confirming === record.id}
                  onClick={() => confirmPickup(record.id)}
                >
                  {confirming === record.id ? 'Confirming…' : 'Confirm pickup'}
                </button>
              ) : (
                <button
                  type="button"
                  className="somo-notify-btn"
                  onClick={() => setNotify(record)}
                >
                  Open alerts
                </button>
              )}
            </div>
          ))}
          {hidden > 0 ? (
            <div className="somo-queue-more">
              and {hidden} more waiting — they are in the table below.
            </div>
          ) : null}
        </div>
      )}

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
              : 'Hide the detail columns so the table fits without scrolling sideways'
          }
        >
          {compact ? '⤢ All columns' : '⤡ Compact'}
        </button>
        <button
          type="button"
          className="somo-btn ghost small"
          onClick={refreshNow}
          disabled={refreshing}
          title="Riders and customers update these from their phones — this checks for changes now"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
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
          {exporting ? 'Preparing…' : 'Export to Excel'}
        </button>
      </div>

      <div className="somo-table-wrap">
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
                  <th>Value</th>
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
            {visible.map((r) => {
              const step = milestone(r);
              return (
                <tr key={r.id}>
                  {/* --somo-muted, not --muted: the latter is shadcn's muted
                      *background*, which rendered this date as pale grey on white
                      and all but invisible. */}
                  <td style={{ color: 'var(--somo-muted)', whiteSpace: 'nowrap' }}>
                    {fmtDateTime(r.date)}
                  </td>
                  {/* The full uuid on hover, for anyone who needs to paste one. */}
                  <td className="somo-order-cell" title={r.id}>
                    #{shortId(r.id)}
                  </td>
                  {canManage && <td>{r.customer}</td>}
                  <td>
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
                      <td className="somo-price-cell">{r.distance.toFixed(1)} km</td>
                      <td className="somo-price-cell">
                        {r.durationMin > 0 ? `${r.durationMin.toFixed(0)} min` : '—'}
                      </td>
                      <td>{r.type}</td>
                      {/* Blank for rows filed before item categories existed. */}
                      <td>{r.itemCategory || '—'}</td>
                      <td className="somo-price-cell">GHS {(r.declaredValue || 0).toFixed(0)}</td>
                    </>
                  )}
                  <td className="somo-agreed-cell">{fmtMoney(r.price)}</td>

                  <td style={{ whiteSpace: 'nowrap' }}>
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
                      </>
                    ) : (
                      <span className="somo-unassigned">—</span>
                    )}
                  </td>

                  <td>
                    {canManage ? (
                      <select
                        className="somo-status-select"
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value as DeliveryStatus)}
                      >
                        {DELIVERY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`somo-badge ${STATUS_CLASS[r.status] || 'b-requested'}`}>
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

                  <td>
                    {canManage ? (
                      <select
                        className="somo-status-select"
                        value={r.riderId}
                        onChange={(e) => assignRider(r.id, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {riders.map((rider) => (
                          <option key={rider.id} value={rider.id}>
                            {rider.name} — {rider.regNumber || 'no reg'} ({rider.status})
                          </option>
                        ))}
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

                  <td>
                    {canManage ? (
                      <button className="somo-notify-btn" onClick={() => setNotify(r)}>
                        🔔 Notify
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
                        Resend to customer
                      </button>
                    ) : (
                      <span className="somo-unassigned">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

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
      </div>

      <NotifyModal record={notify} opsPhone={opsPhone} onClose={() => setNotify(null)} />
    </>
  );
}
