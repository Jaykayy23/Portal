'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiDownload, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, shortId, statusBadgeClass } from '@/lib/format';
import { Download, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { StatTile } from '@/components/StatTile';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { ScrollableTable } from '@/components/ScrollableTable';
import { ProgressiveRows } from '@/components/ProgressiveRows';
import { SettleModal, type SettleParty } from '@/components/ledger/SettleModal';
import { useRefreshHold } from '@/components/PortalRefresh';
import { RANGES, filterByRange, type RangeKey } from '@/lib/analytics';
import {
  COMPANY,
  FLOAT_DEADLINE_HOURS,
  LEDGER_FOCUSES,
  ledgerTotals,
  matchesFocus,
  merchantBalances,
  riderFloat,
  toLedger,
  type LedgerEntry,
  type LedgerFocus,
  type LedgerPosition,
  type MoneyPart,
  type SettlementMark,
} from '@/lib/ledger';
import type { SettlementRecord } from '@/lib/settlements';
import type { MerchantOption } from '@/lib/accounts';
import type { DeliveryWithMerchant } from '@/lib/types';

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
 * Which way one slice of money is pointing, as a class name.
 *
 * Four states worth telling apart at a glance: owed to us, owed out to a
 * merchant, not moved yet, and finished travelling. Colour is not the only cue —
 * every slice also says it in words — but on a table of forty rows it is what
 * lets someone find the amber ones.
 */
function tone(part: MoneyPart, inFlight: boolean): string {
  if (!part.owedTo) return 'settled';
  if (inFlight) return 'flight';
  return part.owedTo === 'Merchant' ? 'owed' : 'due';
}

/** 'Mar 4' — a settlement's date is a day, not a minute. */
function fmtDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * One money column: every place this obligation currently sits.
 *
 * Usually one slice. Two once a remittance is partial — GHS 200 still with the
 * rider, GHS 300 with us and owed onward — and the whole reason this renders a
 * list rather than a single holder is that those two lines are two different
 * people's jobs.
 */
function HolderCell({ position }: { position: LedgerPosition | null }) {
  if (!position || position.parts.length === 0) {
    return <span className="somo-unassigned">—</span>;
  }
  // The most recent leg, which for a settled position is the one that cleared it.
  const latest = position.marks[position.marks.length - 1];
  const split = position.parts.length > 1;

  return (
    <div className="somo-holder-stack" title={position.detail}>
      {position.parts.map((part, i) => (
        <div
          className={`somo-holder-cell ${tone(part, position.inFlight)}`}
          key={`${part.holder}-${i}`}
        >
          <span className="h">
            {/* The amount only when it is a slice: repeating the full figure on a
                single-part cell would just duplicate the value column. */}
            {split ? `${fmtMoney(part.amount)} — ` : ''}
            {part.label}
          </span>
          {part.owedLabel ? <span className="o">{part.owedLabel}</span> : null}
        </div>
      ))}
      {position.writtenOff > 0 ? (
        <span className="somo-writeoff-note">
          {fmtMoney(position.writtenOff)} written off
        </span>
      ) : null}
      {latest ? (
        <span className="somo-holder-when">
          {fmtDay(latest.settledAt)}
          {latest.reference ? ` · ${latest.reference}` : ''}
        </span>
      ) : null}
    </div>
  );
}

/** '3d 4h' — a float's age, in the units somebody chasing it thinks in. */
function fmtHeld(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function LedgerPane({
  records,
  marks: markInput,
  settlements,
  merchants,
  seesAll,
  canRecord,
  viewerCompany,
}: {
  records: DeliveryWithMerchant[];
  /**
   * Settled legs by delivery id. A plain object rather than a Map because this
   * crosses the server/client boundary, and an object is unambiguously
   * serialisable where a Map leans on the framework's serialiser.
   */
  marks: Record<string, SettlementMark[]>;
  settlements: SettlementRecord[];
  /** Merchant accounts for the picker. Empty for a merchant viewing their own. */
  merchants: MerchantOption[];
  /** True for admin, ops and finance — the roles that see every merchant. */
  seesAll: boolean;
  /** True for admin, ops and finance — the roles that may record money moving. */
  canRecord: boolean;
  viewerCompany: string;
}) {
  const router = useRouter();
  const toast = useToast();

  /**
   * The full server-loaded year, not a short recent window.
   *
   * The dashboard defaults to a month because it is a trend view, but an unpaid
   * invoice does not stop existing after thirty days — and a ledger that opened
   * on "last 30 days" would quietly leave the oldest debt out of the headline
   * figures inside that explicit reporting horizon, which is the one number
   * nobody should have to go looking for.
   */
  const [range, setRange] = useState<RangeKey>('all');
  const [merchantId, setMerchantId] = useState('');
  const [focus, setFocus] = useState<LedgerFocus>('all');
  const [query, setQuery] = useState('');
  const [compact, setCompact] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState<SettleParty | null>(null);
  const [voiding, setVoiding] = useState<SettlementRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);

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

  // The poll that keeps this screen current lives in the portal layout — one
  // timer for the whole portal, not a second one here running alongside it. This
  // screen's only remaining interest is asking it to hold still while either
  // dialog is open: re-rendering under someone half-way through ticking off a
  // rider's float is worse than being 25 seconds stale.
  useRefreshHold(!!(settling || voiding));

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
      toast(errMessage(e), 'danger');
    }
    setExporting(false);
  }

  async function voidNow() {
    if (!voiding) return;
    setVoidBusy(true);
    try {
      await api(`/settlements/${voiding.id}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim() },
      });
      toast('Settlement voided — the obligations are open again');
      setVoiding(null);
      setVoidReason('');
      router.refresh();
    } catch (e) {
      toast(errMessage(e), 'danger');
    }
    setVoidBusy(false);
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

  const markMap = useMemo(() => new Map(Object.entries(markInput)), [markInput]);

  const entries = useMemo(() => {
    const inRange = filterByRange(records, range);
    const scoped = merchantId ? inRange.filter((r) => r.merchantId === merchantId) : inRange;
    return toLedger(scoped, markMap).filter((e) => matchesFocus(e, focus));
  }, [records, markMap, range, merchantId, focus]);

  /**
   * Everything in range for the selected merchant, before the focus filter.
   *
   * The settle dialog reads this rather than the visible rows: narrowing the
   * table to "Cash with riders" should not quietly shrink what a settlement is
   * allowed to cover.
   */
  const settleableEntries = useMemo(() => {
    const inRange = filterByRange(records, range);
    const scoped = merchantId ? inRange.filter((r) => r.merchantId === merchantId) : inRange;
    return toLedger(scoped, markMap);
  }, [records, markMap, range, merchantId]);

  const trimmed = query.trim().toLowerCase();
  const visible = useMemo(
    () => (trimmed ? entries.filter((e) => matchesQuery(e.delivery, trimmed)) : entries),
    [entries, trimmed]
  );

  const totals = useMemo(() => ledgerTotals(visible), [visible]);
  const floats = useMemo(() => riderFloat(visible), [visible]);
  const balances = useMemo(() => merchantBalances(visible), [visible]);

  /** Which merchant each delivery belongs to, for scoping the settlement list. */
  const merchantByDelivery = useMemo(
    () => new Map(records.map((r) => [r.id, r.merchantId])),
    [records]
  );

  const visibleSettlements = useMemo(() => {
    if (!merchantId) return settlements;
    return settlements.filter(
      (s) =>
        s.merchantId === merchantId ||
        s.lines.some((l) => merchantByDelivery.get(l.deliveryId) === merchantId)
    );
  }, [settlements, merchantId, merchantByDelivery]);

  const selectedName = merchantOptions.find((m) => m.id === merchantId)?.name ?? '';
  const scopeLabel = merchantId ? selectedName : seesAll ? 'All merchants' : viewerCompany;

  // Keep in step with the <th> list below — it only spans the "nothing matches"
  // row, so getting it wrong is cosmetic rather than broken.
  const columnCount = 10 + (seesAll ? 1 : 0) + (compact ? 0 : 4);

  return (
    <>
      <div className="somo-card" style={{ marginTop: 0 }}>
        <h3>
          Where the money is
          <InfoHint label="how the positions are derived">
            <p>Every delivery carries two sums, and each one is somewhere right now.</p>
            <p>
              <strong>Goods.</strong> Prepaid sits with the merchant and never reaches us. Cash on
              delivery is collected at the door — with the rider, then with {COMPANY} once they
              remit, and gone once the merchant has been paid.
            </p>
            <p>
              <strong>Fee.</strong> Billed to a merchant account, it is owed to {COMPANY}. Paid by
              the customer at the door, it is with the rider until they hand it in.
            </p>
            {canRecord ? (
              <p>Recording a remittance or a payment is what clears these figures.</p>
            ) : null}
          </InfoHint>
          <span className="tag-note">{scopeLabel}</span>
        </h3>

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

          {canRecord && merchantId ? (
            <div className="somo-filter">
              <span>&nbsp;</span>
              <button
                type="button"
                className="somo-btn small"
                onClick={() =>
                  setSettling({ kind: 'merchant', id: merchantId, name: selectedName })
                }
              >
                Settle with {selectedName}
              </button>
            </div>
          ) : null}
        </div>

        <div className="somo-kpis">
          <StatTile
            label={`Merchants owe ${COMPANY}`}
            value={fmtMoney(totals.merchantInvoicesDue)}
            sub="fees on account, delivery complete, unpaid"
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
            sub="cash on delivery collected, not yet remitted"
            tone="owed"
          />
          <StatTile
            label="Ready to pay merchants"
            value={fmtMoney(totals.heldForMerchants)}
            sub={`remitted to ${COMPANY}, owed onward`}
            tone="owed"
          />
          <StatTile
            label="Not collected yet"
            value={fmtMoney(totals.codAwaitingCollection + totals.feesAwaitingCollection)}
            sub="moves only when the parcel is handed over"
            tone="flight"
          />
          <StatTile
            label="Settled in this view"
            value={fmtMoney(totals.feesCollected + totals.goodsPaidToMerchants)}
            sub={`${totals.clearedRows} of ${totals.deliveries} rows fully cleared`}
            tone="good"
          />
          <StatTile
            label="Written off to rider debt"
            value={fmtMoney(totals.riderDebt)}
            sub="shortfalls to deduct from pay"
            tone={totals.riderDebt > 0 ? 'bad' : 'info'}
          />
          <StatTile
            label="Prepaid, with merchants"
            value={fmtMoney(totals.prepaidWithMerchants)}
            sub="customers already paid the merchant — never ours"
          />
          <StatTile
            label="Delivery fees in period"
            value={fmtMoney(totals.feeTotal)}
            sub={`${totals.deliveries} ${totals.deliveries === 1 ? 'delivery' : 'deliveries'}${
              totals.untracked > 0 ? ` · ${totals.untracked} with no terms recorded` : ''
            }`}
          />
        </div>
      </div>

      {(floats.length > 0 || (seesAll && !merchantId && balances.length > 0)) && (
        <div className="somo-split">
          {floats.length > 0 && (
            <div className="somo-card">
              <h3>
                Rider float
                <InfoHint label="rider float">
                  <p>
                    What each rider is carrying: the deliveries they have handed over, less what
                    they have remitted. <strong>Held for</strong> runs from the handover of the
                    oldest amount still in their hands.
                  </p>
                  <p>
                    Past {FLOAT_DEADLINE_HOURS} hours the database refuses to assign them anything
                    new. Recording a remittance — or writing off what they cannot produce — is
                    what releases them.
                  </p>
                </InfoHint>
                <span className="tag-note">cash in hand, not yet remitted</span>
              </h3>
              <ScrollableTable label="Rider float" short>
                <table className="somo-table somo-mini-table">
                  <thead>
                    <tr>
                      <th>Rider</th>
                      <th>Jobs</th>
                      <th>For merchants</th>
                      <th>For {COMPANY}</th>
                      <th>Total</th>
                      <th>Held for</th>
                      {canRecord && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {floats.map((f) => (
                      <tr
                        key={f.riderId || f.riderName}
                        className={f.overdue ? 'somo-overdue-row' : undefined}
                      >
                        <td>
                          {f.riderName}
                          {f.overdue ? (
                            <span className="somo-badge b-approval">blocked</span>
                          ) : null}
                          {f.writtenOff > 0 ? (
                            <span className="somo-rider-sub">
                              {fmtMoney(f.writtenOff)} written off to their debt
                            </span>
                          ) : null}
                        </td>
                        <td className="somo-price-cell">{f.deliveries}</td>
                        <td className="somo-price-cell">{fmtMoney(f.forMerchants)}</td>
                        <td className="somo-price-cell">{fmtMoney(f.forUs)}</td>
                        <td className="somo-agreed-cell">{fmtMoney(f.total)}</td>
                        <td
                          className="somo-price-cell"
                          title={
                            f.oldestSince
                              ? `Oldest un-remitted cash reached them ${fmtDateTime(f.oldestSince)}`
                              : ''
                          }
                        >
                          {f.total > 0 ? fmtHeld(f.hoursHeld) : '—'}
                          {f.total > 0 ? (
                            <span className="somo-rider-sub">
                              {f.overdue
                                ? `${fmtHeld(-f.hoursLeft)} over`
                                : `${fmtHeld(f.hoursLeft)} left`}
                            </span>
                          ) : null}
                        </td>
                        {canRecord && (
                          <td>
                            <button
                              type="button"
                              className="somo-mini-btn"
                              // A rider removed from the roster leaves rider_id
                              // null on their old deliveries, and a remittance is
                              // keyed on that id. Nothing to record it against.
                              disabled={!f.riderId || f.total <= 0}
                              title={
                                f.riderId
                                  ? `Record what ${f.riderName} has handed in`
                                  : 'This rider is no longer on the roster, so a remittance cannot be recorded against them'
                              }
                              onClick={() =>
                                setSettling({ kind: 'rider', id: f.riderId, name: f.riderName })
                              }
                            >
                              Record remittance
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}

          {seesAll && !merchantId && balances.length > 0 && (
            <div className="somo-card">
              <h3>
                Merchant positions
                <InfoHint label="merchant positions">
                  <p>
                    <strong>Net</strong> is what would change hands if everything settled today:
                    fees the merchant owes us, less the cash-on-delivery takings owed to them.
                    <strong> Ready</strong> is the part of that we are already holding.
                  </p>
                  {canRecord ? <p>Open a merchant to settle with them.</p> : null}
                </InfoHint>
                <span className="tag-note">both directions</span>
              </h3>
              <ScrollableTable label="Merchant positions" short>
                <table className="somo-table somo-mini-table">
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th>Owes us</th>
                      <th>We owe</th>
                      <th>Ready</th>
                      <th>Net</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => (
                      <tr key={b.merchantId}>
                        <td>
                          {b.name}
                          <span className="somo-rider-sub">{b.deliveries} jobs</span>
                        </td>
                        <td className="somo-price-cell">{fmtMoney(b.owesUs)}</td>
                        <td className="somo-price-cell">{fmtMoney(b.weOweThem)}</td>
                        <td
                          className="somo-price-cell"
                          title={`Of what we owe them, this much has already been remitted to ${COMPANY} and could be paid out today`}
                        >
                          {fmtMoney(b.readyToPayOut)}
                        </td>
                        <td className={`somo-price-cell ${b.net >= 0 ? 'net-in' : 'net-out'}`}>
                          {fmtMoney(Math.abs(b.net))}
                          <span className="somo-rider-sub">{b.net >= 0 ? 'to us' : 'to them'}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="somo-mini-btn"
                            onClick={() => setMerchantId(b.merchantId)}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}
        </div>
      )}

      <div className="somo-card">
        <h3>
          Ledger
          <InfoHint label="the ledger table">
            <p>
              Statuses and rider assignments are changed in the delivery log, not here — the money
              position follows from them.
            </p>
            <p>
              What this page writes is settlements: the record that an obligation was met. Rows
              filed before payment terms were captured show a dash rather than a guess.
            </p>
          </InfoHint>
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
            {compact ? (
              <Maximize2 aria-hidden="true" size={13} />
            ) : (
              <Minimize2 aria-hidden="true" size={13} />
            )}
            <span>{compact ? 'All columns' : 'Compact'}</span>
          </button>
          <button
            type="button"
            className="somo-btn ghost small"
            onClick={refreshNow}
            disabled={refreshing}
            title="Riders and customers move these along from their phones — this checks now"
          >
            <RefreshCw aria-hidden="true" size={13} className={refreshing ? 'somo-spin' : undefined} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            className="somo-btn ghost small"
            onClick={exportLedger}
            disabled={exporting || visible.length === 0}
            title="Download these rows, plus a totals sheet and the settlements, as an Excel file"
          >
            <Download aria-hidden="true" size={13} />
            <span>{exporting ? 'Preparing…' : 'Export to Excel'}</span>
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
          <ScrollableTable label="Ledger obligations">
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
                <ProgressiveRows colSpan={columnCount} initial={100} step={100}>
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
                              {r.deliveryPaidBy
                                ? `${r.deliveryPaidBy.toLowerCase()} pays fee`
                                : '—'}
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
                </ProgressiveRows>

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
          </ScrollableTable>
        )}

      </div>

      <div className="somo-card">
        <h3>
          Settlements recorded
          <InfoHint label="voiding a settlement">
            <p>
              A settlement is never deleted. Voiding one stamps who did it and why, keeps it in this
              list, and hands the obligations back to the ledger as unsettled — so money can never
              look paid, or unpaid, with nothing to say how it got that way.
            </p>
          </InfoHint>
          <span className="tag-note">
            {visibleSettlements.length} {visibleSettlements.length === 1 ? 'entry' : 'entries'}
          </span>
        </h3>

        {visibleSettlements.length === 0 ? (
          <div className="somo-empty small">
            {canRecord
              ? 'Nothing recorded yet. Record a rider’s remittance from the float table above, or open a merchant to settle with them.'
              : 'No settlements recorded yet.'}
          </div>
        ) : (
          <ScrollableTable label="Settlement history" short>
            <table className="somo-table somo-mini-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>With</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Written off</th>
                  <th>How</th>
                  <th>Covers</th>
                  {canRecord && <th />}
                </tr>
              </thead>
              <tbody>
                <ProgressiveRows colSpan={canRecord ? 8 : 7} initial={100} step={100}>
                  {visibleSettlements.map((s) => (
                  <tr key={s.id} className={s.voidedAt ? 'somo-voided' : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(s.settledAt)}
                      {s.recordedByName ? (
                        <span className="somo-rider-sub">by {s.recordedByName}</span>
                      ) : null}
                    </td>
                    <td>
                      {s.riderName || s.merchantName || '—'}
                      <span className="somo-rider-sub">
                        {s.riderName ? 'rider remittance' : 'merchant settlement'}
                      </span>
                    </td>
                    <td className="somo-price-cell">
                      {s.totalIn > 0 ? fmtMoney(s.totalIn) : '—'}
                    </td>
                    <td className="somo-price-cell">
                      {s.totalOut > 0 ? fmtMoney(s.totalOut) : '—'}
                    </td>
                    <td className="somo-price-cell">
                      {s.totalWrittenOff > 0 ? (
                        <span className="somo-writeoff-note">
                          {fmtMoney(s.totalWrittenOff)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {s.method || '—'}
                      {s.reference ? <span className="somo-rider-sub">{s.reference}</span> : null}
                    </td>
                    <td>
                      {s.lines.length} {s.lines.length === 1 ? 'obligation' : 'obligations'}
                      <span
                        className="somo-rider-sub"
                        title={s.lines.map((l) => `#${l.orderNo} ${l.stream} ${l.leg}`).join(', ')}
                      >
                        {s.lines
                          .slice(0, 3)
                          .map((l) => `#${l.orderNo}`)
                          .join(' ')}
                        {s.lines.length > 3 ? ` +${s.lines.length - 3}` : ''}
                      </span>
                      {s.note ? <span className="somo-rider-sub">{s.note}</span> : null}
                      {s.voidedAt ? (
                        <span className="somo-void-note">
                          voided {fmtDay(s.voidedAt)}
                          {s.voidedByName ? ` by ${s.voidedByName}` : ''} — {s.voidReason}
                        </span>
                      ) : null}
                    </td>
                    {canRecord && (
                      <td>
                        {s.voidedAt ? (
                          <span className="somo-unassigned">voided</span>
                        ) : (
                          <button
                            type="button"
                            className="somo-mini-btn"
                            onClick={() => {
                              setVoiding(s);
                              setVoidReason('');
                            }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  ))}
                </ProgressiveRows>
              </tbody>
            </table>
          </ScrollableTable>
        )}

      </div>

      <SettleModal
        party={settling}
        entries={settleableEntries}
        onClose={() => setSettling(null)}
        onDone={() => {
          setSettling(null);
          router.refresh();
        }}
      />

      <Modal
        open={!!voiding}
        title="Void this settlement"
        description={
          voiding
            ? `Recorded ${fmtDateTime(voiding.settledAt)} with ${
                voiding.riderName || voiding.merchantName
              }. The ${voiding.lines.length} obligation${
                voiding.lines.length === 1 ? '' : 's'
              } it cleared will show as unsettled again.`
            : ''
        }
        closeLabel="Cancel"
        onClose={() => setVoiding(null)}
      >
        <label className="somo-field">
          <span>Why is it being voided? (required)</span>
          <input
            className="somo-input"
            placeholder="e.g. recorded against the wrong rider"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="somo-btn decline small"
          disabled={voidBusy || !voidReason.trim()}
          onClick={voidNow}
        >
          {voidBusy ? <Spinner /> : null}
          {voidBusy ? 'Voiding…' : 'Void settlement'}
        </button>
      </Modal>
    </>
  );
}
