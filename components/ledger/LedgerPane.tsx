'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiDownload, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, shortId, statusBadgeClass } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { StatTile } from '@/components/StatTile';
import { RANGES, filterByRange, type RangeKey } from '@/lib/analytics';
import {
  COMPANY,
  LEDGER_FOCUSES,
  ledgerTotals,
  matchesFocus,
  merchantBalances,
  riderFloat,
  toLedger,
  type LedgerEntry,
  type LedgerFocus,
  type LedgerPosition,
} from '@/lib/ledger';
import type { MerchantOption } from '@/lib/accounts';
import type { DeliveryWithMerchant } from '@/lib/types';

/**
 * Same cadence as the delivery log, and for the same reason: the figures on this
 * screen move when a rider taps a link on the other side of town. A finance
 * person watching a float should not have to reload to see it change.
 */
const REFRESH_MS = 25_000;

const COMPACT_KEY = 'somo.ledger.compact';

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

/**
 * Which way the money is pointing, as a class name.
 *
 * Four states worth telling apart at a glance: money owed to us, money we owe a
 * merchant, money that has not moved yet, and money already where it belongs.
 * Colour is not the only cue — every cell also says it in words — but on a table
 * of forty rows it is what lets someone find the amber ones.
 */
function tone(p: LedgerPosition | null): string {
  if (!p) return '';
  if (p.settled) return 'settled';
  if (p.inFlight) return 'flight';
  return p.owedTo === 'Merchant' ? 'owed' : 'due';
}

function HolderCell({ position }: { position: LedgerPosition | null }) {
  if (!position) {
    return <span className="somo-unassigned">—</span>;
  }
  return (
    <div className={`somo-holder-cell ${tone(position)}`} title={position.detail}>
      <span className="h">{position.holderLabel}</span>
      {position.owedLabel ? <span className="o">{position.owedLabel}</span> : null}
    </div>
  );
}

export function LedgerPane({
  records,
  merchants,
  seesAll,
  viewerCompany,
}: {
  records: DeliveryWithMerchant[];
  /** Merchant accounts for the picker. Empty for a merchant viewing their own. */
  merchants: MerchantOption[];
  /** True for admin, ops and finance — the roles that see every merchant. */
  seesAll: boolean;
  viewerCompany: string;
}) {
  const router = useRouter();
  const toast = useToast();

  /**
   * All time, not a recent window.
   *
   * The dashboard defaults to a month because it is a trend view, but an unpaid
   * invoice does not stop existing after thirty days — and a ledger that opened
   * on "last 30 days" would quietly leave the oldest debt out of the headline
   * figures, which is the one number nobody should have to go looking for.
   */
  const [range, setRange] = useState<RangeKey>('all');
  const [merchantId, setMerchantId] = useState('');
  const [focus, setFocus] = useState<LedgerFocus>('all');
  const [query, setQuery] = useState('');
  const [compact, setCompact] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setCompact(window.localStorage.getItem(COMPACT_KEY) === '1');
  }, []);

  function toggleCompact() {
    setCompact((wasCompact) => {
      const next = !wasCompact;
      try {
        window.localStorage.setItem(COMPACT_KEY, next ? '1' : '0');
      } catch {
        // Private browsing, or storage full. The toggle still works this visit.
      }
      return next;
    });
  }

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router]);

  function refreshNow() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  }

  async function exportLedger() {
    setExporting(true);
    try {
      // The filters go with the request so the workbook matches the screen. The
      // server re-reads the rows through the caller's session, so this is a
      // filter, never a permission.
      const search = new URLSearchParams({ range, focus });
      if (merchantId) search.set('merchant', merchantId);
      await apiDownload(`/ledger/export?${search}`, 'somoexpress-ledger.xlsx');
    } catch (e) {
      toast(errMessage(e));
    }
    setExporting(false);
  }

  /**
   * The merchant picker's options.
   *
   * Built from the account list rather than from the deliveries, so a merchant
   * who has filed nothing yet is still selectable — "nothing outstanding" is a
   * real answer to check, and an absent name looks like a missing account.
   */
  const merchantOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of merchants) {
      byId.set(m.id, m.active ? m.name : `${m.name} (inactive)`);
    }
    // Anything on a delivery row but missing from the account list is added from
    // the row itself. That should not happen, and if it ever does — a profile
    // deleted out from under its history — a nameless id in the picker is worse
    // than the snapshotted company name.
    for (const r of records) {
      if (!byId.has(r.merchantId)) byId.set(r.merchantId, r.customer);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [merchants, records]);

  const entries = useMemo(() => {
    const inRange = filterByRange(records, range);
    const scoped = merchantId ? inRange.filter((r) => r.merchantId === merchantId) : inRange;
    return toLedger(scoped).filter((e) => matchesFocus(e, focus));
  }, [records, range, merchantId, focus]);

  const trimmed = query.trim().toLowerCase();
  const visible = useMemo(
    () => (trimmed ? entries.filter((e) => matchesQuery(e.delivery, trimmed)) : entries),
    [entries, trimmed]
  );

  const totals = useMemo(() => ledgerTotals(visible), [visible]);
  const floats = useMemo(() => riderFloat(visible), [visible]);
  const balances = useMemo(() => merchantBalances(visible), [visible]);

  const selectedName = merchantOptions.find((m) => m.id === merchantId)?.name ?? '';
  const scopeLabel = merchantId ? selectedName : seesAll ? 'All merchants' : viewerCompany;

  // Keep in step with the <th> list below — it only spans the "nothing matches"
  // row, so getting it wrong is cosmetic rather than broken.
  const columnCount = 10 + (seesAll ? 1 : 0) + (compact ? 0 : 4);

  return (
    <>
      <div className="somo-card" style={{ marginTop: 0 }}>
        <h3>
          <span className="n">—</span> Where the money is
          <span className="tag-note">{scopeLabel}</span>
        </h3>
        <p className="somo-card-intro">
          Every delivery carries two sums, and each of them is in somebody&rsquo;s hands right now.
          Goods paid for up front sit with the merchant and never reach us; cash on delivery is
          collected at the door, so once a parcel is handed over that money is with the rider and
          belongs to the merchant. A delivery fee billed to a merchant account is owed to{' '}
          {COMPANY}; a fee the customer pays at the door is with the rider, and owed to {COMPANY}
          too.
        </p>

        <div className="somo-filters">
          <label className="somo-filter">
            <span>Period</span>
            <select
              className="somo-select"
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
            >
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {seesAll && (
            <label className="somo-filter">
              <span>Merchant</span>
              <select
                className="somo-select"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
              >
                <option value="">All merchants</option>
                {merchantOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="somo-filter">
            <span>Show</span>
            <select
              className="somo-select"
              value={focus}
              onChange={(e) => setFocus(e.target.value as LedgerFocus)}
              title={LEDGER_FOCUSES.find((f) => f.value === focus)?.hint}
            >
              {LEDGER_FOCUSES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="somo-kpis">
          <StatTile
            label={`Merchants owe ${COMPANY}`}
            value={fmtMoney(totals.merchantInvoicesDue)}
            sub="fees on account, delivery completed — invoice these"
            tone="due"
          />
          <StatTile
            label={`Riders holding ${COMPANY} money`}
            value={fmtMoney(totals.cashWithRidersForUs)}
            sub="fees collected at the door, not yet remitted"
            tone="due"
          />
          <StatTile
            label="Riders holding merchant money"
            value={fmtMoney(totals.cashWithRidersForMerchants)}
            sub="cash on delivery collected, owed back to merchants"
            tone="owed"
          />
          <StatTile
            label="Not collected yet"
            value={fmtMoney(totals.codAwaitingCollection + totals.feesAwaitingCollection)}
            sub="moves only when the parcel is handed over"
            tone="flight"
          />
          <StatTile
            label="Prepaid, with merchants"
            value={fmtMoney(totals.prepaidWithMerchants)}
            sub="customers already paid the merchant — never ours"
            tone="info"
          />
          <StatTile
            label="Delivery fees in period"
            value={fmtMoney(totals.feeTotal)}
            sub={`${totals.deliveries} ${totals.deliveries === 1 ? 'delivery' : 'deliveries'}${
              totals.untracked > 0 ? ` · ${totals.untracked} with no terms recorded` : ''
            }`}
            tone="info"
          />
        </div>
      </div>

      {(floats.length > 0 || (seesAll && !merchantId && balances.length > 0)) && (
        <div className="somo-split">
          {floats.length > 0 && (
            <div className="somo-card">
              <h3>
                <span className="n">—</span> Rider float
                <span className="tag-note">cash in hand</span>
              </h3>
              <table className="somo-table somo-mini-table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Jobs</th>
                    <th>For merchants</th>
                    <th>For {COMPANY}</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {floats.map((f) => (
                    <tr key={f.riderId || f.riderName}>
                      <td>{f.riderName}</td>
                      <td className="somo-price-cell">{f.deliveries}</td>
                      <td className="somo-price-cell">{fmtMoney(f.forMerchants)}</td>
                      <td className="somo-price-cell">{fmtMoney(f.forUs)}</td>
                      <td className="somo-agreed-cell">{fmtMoney(f.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="somo-note">
                What each rider is carrying, worked out from the deliveries they have handed over.
                The portal has no record of a rider handing their float in, so these figures are
                what is owed, not what is unpaid — clearing them happens off the system.
              </div>
            </div>
          )}

          {seesAll && !merchantId && balances.length > 0 && (
            <div className="somo-card">
              <h3>
                <span className="n">—</span> Merchant positions
                <span className="tag-note">both directions</span>
              </h3>
              <table className="somo-table somo-mini-table">
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Jobs</th>
                    <th>Owes us</th>
                    <th>We owe</th>
                    <th>Net</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.merchantId}>
                      <td>{b.name}</td>
                      <td className="somo-price-cell">{b.deliveries}</td>
                      <td className="somo-price-cell">{fmtMoney(b.owesUs)}</td>
                      <td className="somo-price-cell">{fmtMoney(b.weOweThem)}</td>
                      <td className={`somo-price-cell ${b.net >= 0 ? 'net-in' : 'net-out'}`}>
                        {fmtMoney(Math.abs(b.net))}
                        <span className="somo-rider-sub">
                          {b.net >= 0 ? 'to us' : 'to them'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="somo-mini-btn"
                          onClick={() => setMerchantId(b.merchantId)}
                        >
                          Open ledger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="somo-note">
                Net is what would change hands if everything settled today: fees the merchant owes
                us, less the cash on delivery our riders are holding for them.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="somo-card">
        <h3>
          <span className="n">—</span> Ledger
          <span className="tag-note">
            {visible.length} {visible.length === 1 ? 'row' : 'rows'}
          </span>
        </h3>

        <div className="somo-table-actions">
          <div className="somo-table-search">
            <input
              className="somo-input"
              type="search"
              placeholder="Search order #, merchant, address, rider…"
              aria-label="Search the ledger"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {trimmed ? (
              <span className="count">
                {visible.length} of {entries.length}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="somo-btn ghost small"
            onClick={toggleCompact}
            title={
              compact
                ? 'Show distance, time, type and item'
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
            title="Riders and customers move these along from their phones — this checks now"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            type="button"
            className="somo-btn ghost small"
            onClick={exportLedger}
            disabled={exporting || visible.length === 0}
            title="Download these rows, plus a totals sheet, as an Excel file"
          >
            {exporting ? 'Preparing…' : 'Export to Excel'}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="somo-empty">
            <div className="big">Nothing in this view</div>
            {records.length === 0
              ? seesAll
                ? 'No merchant has filed a delivery yet.'
                : 'Deliveries you file will show up here with their payment position.'
              : 'No delivery matches this period, merchant and filter. Widen the period or choose Everything.'}
          </div>
        ) : (
          <div className="somo-table-wrap">
            <table className="somo-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Order</th>
                  {seesAll && <th>Merchant</th>}
                  <th>Route</th>
                  {!compact && (
                    <>
                      <th>Distance</th>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Item</th>
                    </>
                  )}
                  <th>Goods value</th>
                  <th>Delivery fee</th>
                  <th>Terms</th>
                  <th>Status</th>
                  <th>Rider</th>
                  {/* The two columns this page exists for. */}
                  <th>Goods money</th>
                  <th>Fee money</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e: LedgerEntry) => {
                  const r = e.delivery;
                  return (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--somo-muted)', whiteSpace: 'nowrap' }}>
                        {fmtDateTime(r.date)}
                      </td>
                      <td className="somo-order-cell" title={r.id}>
                        #{shortId(r.id)}
                      </td>
                      {seesAll && (
                        <td>
                          {r.customer}
                          {r.merchantPhone ? (
                            <>
                              <br />
                              <span className="somo-rider-sub">{r.merchantPhone}</span>
                            </>
                          ) : null}
                        </td>
                      )}
                      <td>
                        {r.pickup} → {r.dropoff}
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
                          <td>{r.itemCategory || '—'}</td>
                        </>
                      )}
                      <td className="somo-price-cell">{fmtMoney(r.declaredValue || 0)}</td>
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
                        <span className={`somo-badge ${statusBadgeClass(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td>
                        {r.riderName ? (
                          <>
                            {r.riderName}
                            <br />
                            <span className="somo-rider-sub">{r.riderPhone}</span>
                          </>
                        ) : (
                          <span className="somo-unassigned">Not yet assigned</span>
                        )}
                      </td>
                      <td>
                        <HolderCell position={e.item} />
                      </td>
                      <td>
                        <HolderCell position={e.fee} />
                      </td>
                    </tr>
                  );
                })}

                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} className="somo-nomatch">
                      Nothing matches <strong>{query.trim()}</strong>.{' '}
                      <button
                        type="button"
                        className="somo-inline-link"
                        onClick={() => setQuery('')}
                      >
                        clear the search
                      </button>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        <div className="somo-note">
          This page is read-only for every role, including admin — statuses and rider assignments
          are changed in the delivery log, and the money position follows from them. Rows filed
          before payment terms were captured show a dash rather than a guess.
        </div>
      </div>
    </>
  );
}
