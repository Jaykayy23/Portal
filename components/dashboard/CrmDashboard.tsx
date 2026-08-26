'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { StatTile } from '@/components/StatTile';
import { ScrollableTable } from '@/components/ScrollableTable';
import { InfoHint } from '@/components/InfoHint';
import {
  RANGES,
  categoryMix,
  deliveryKpis,
  feePayerMix,
  filterByRange,
  itemPaymentMix,
  merchantVolume,
  perDay,
  rangeDays,
  repeatCustomers,
  riderPerformance,
  statusMix,
  topDropoffs,
  type DayBucket,
  type RangeKey,
  type Tally,
} from '@/lib/analytics';
import { COMPANY, ledgerTotals, toLedger } from '@/lib/ledger';
import { DELIVERY_STATUSES, type DeliveryWithMerchant } from '@/lib/types';
import type { MerchantOption } from '@/lib/accounts';

/**
 * Days in the day-by-day chart.
 *
 * All time has no natural width and an install with two years of history would
 * render seven hundred bars, so it borrows a month. Every other figure on the
 * page still covers the whole period — this cap is the chart's alone, and the
 * heading says so.
 */
const ALL_TIME_CHART_DAYS = 30;

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

/**
 * A horizontal bar list.
 *
 * Widths are relative to the largest row rather than to the total: with eight
 * categories the biggest slice is often under 30%, and scaling to the total
 * leaves every bar a stub. The count is always printed, so the bar is a
 * comparison aid and never the only way to read the number.
 */
function Bars({ rows, empty }: { rows: Tally[]; empty: string }) {
  const top = Math.max(...rows.map((r) => r.count), 1);
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  if (total === 0) return <div className="somo-empty small">{empty}</div>;

  return (
    <div className="somo-bars">
      {rows.map((r) => (
        <div className="somo-bar-row" key={r.key}>
          <span className="somo-bar-label" title={r.label}>
            {r.label}
          </span>
          <span className="somo-bar-track">
            <span className="somo-bar-fill" style={{ width: `${(r.count / top) * 100}%` }} />
          </span>
          <span className="somo-bar-num">
            {r.count}
            <span className="somo-bar-pct">{total > 0 ? pct((r.count / total) * 100) : ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Deliveries per day, completed portion shaded.
 *
 * Two stacked segments rather than two charts: the gap between the filed bar and
 * the completed one inside it is the thing worth seeing, and side by side it
 * takes arithmetic to notice.
 */
function DayChart({ buckets }: { buckets: DayBucket[] }) {
  const top = Math.max(...buckets.map((b) => b.deliveries), 1);
  const busiest = buckets.reduce((a, b) => (b.deliveries > a.deliveries ? b : a), buckets[0]);

  return (
    <div className="somo-chart">
      <div className="somo-chart-plot">
        {buckets.map((b) => (
          <div
            className="somo-chart-col"
            key={b.key}
            title={`${b.label} — ${b.deliveries} filed, ${b.completed} completed, ${fmtMoney(
              b.fees
            )} in fees`}
          >
            <span className="somo-chart-bar" style={{ height: `${(b.deliveries / top) * 100}%` }}>
              <span
                className="somo-chart-done"
                style={{
                  height: b.deliveries > 0 ? `${(b.completed / b.deliveries) * 100}%` : '0%',
                }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="somo-chart-axis">
        <span>{buckets[0]?.label}</span>
        <span className="somo-chart-peak">
          busiest: {busiest?.label} · {busiest?.deliveries}
        </span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
      <div className="somo-chart-key">
        <span className="swatch filed" /> filed
        <span className="swatch done" /> handed over
      </div>
    </div>
  );
}

export function CrmDashboard({
  records,
  merchants,
  seesAll,
  viewerCompany,
}: {
  records: DeliveryWithMerchant[];
  merchants: MerchantOption[];
  seesAll: boolean;
  viewerCompany: string;
}) {
  const [range, setRange] = useState<RangeKey>('30d');
  const [merchantId, setMerchantId] = useState('');

  // No refresh timer of its own: the portal layout's poll re-renders this page
  // along with everything else, and a second interval here just doubled the
  // database reads on the heaviest query in the app.

  const merchantOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of merchants) byId.set(m.id, m.active ? m.name : `${m.name} (inactive)`);
    for (const r of records) if (!byId.has(r.merchantId)) byId.set(r.merchantId, r.customer);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [merchants, records]);

  const scoped = useMemo(() => {
    const inRange = filterByRange(records, range);
    return merchantId ? inRange.filter((r) => r.merchantId === merchantId) : inRange;
  }, [records, range, merchantId]);

  const kpis = useMemo(() => deliveryKpis(scoped), [scoped]);
  const money = useMemo(() => ledgerTotals(toLedger(scoped)), [scoped]);
  const days = rangeDays(range) || ALL_TIME_CHART_DAYS;
  const buckets = useMemo(() => perDay(scoped, days), [scoped, days]);
  const statuses = useMemo(() => statusMix(scoped, DELIVERY_STATUSES), [scoped]);
  const items = useMemo(() => itemPaymentMix(scoped), [scoped]);
  const payers = useMemo(() => feePayerMix(scoped), [scoped]);
  const categories = useMemo(() => categoryMix(scoped), [scoped]);
  const dropoffs = useMemo(() => topDropoffs(scoped), [scoped]);
  const volume = useMemo(() => merchantVolume(scoped), [scoped]);
  const riders = useMemo(() => riderPerformance(scoped), [scoped]);
  const repeats = useMemo(() => repeatCustomers(scoped), [scoped]);

  const selectedName = merchantOptions.find((m) => m.id === merchantId)?.name ?? '';
  const scopeLabel = merchantId ? selectedName : seesAll ? 'All merchants' : viewerCompany;
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';

  return (
    <>
      <div className="somo-card" style={{ marginTop: 0 }}>
        <h3>
          Delivery dashboard
          <InfoHint label="the delivery dashboard">
            <p>
              Volume, completion and money over a period, counted from the same delivery rows the
              log and the ledger read — so a merchant sees their own traffic and nobody
              else&rsquo;s.
            </p>
            <p>
              For the detail behind any figure here, the{' '}
              <Link href="/portal/ledger">ledger</Link> has it row by row.
            </p>
          </InfoHint>
          <span className="tag-note">
            {scopeLabel} · {rangeLabel.toLowerCase()}
          </span>
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
        </div>

        {kpis.total === 0 ? (
          <div className="somo-empty">
            <div className="big">Nothing in this period</div>
            Widen the period, or pick a different merchant.
          </div>
        ) : (
          <div className="somo-kpis">
            <StatTile
              label="Deliveries filed"
              value={String(kpis.total)}
              sub={`${kpis.merchants} ${kpis.merchants === 1 ? 'merchant' : 'merchants'} · ${
                kpis.customers
              } ${kpis.customers === 1 ? 'recipient' : 'recipients'}`}
            />
            <StatTile
              label="Handed over"
              value={pct(kpis.completionRate)}
              sub={`${kpis.completed} of ${kpis.total} reached the recipient`}
              tone="good"
            />
            <StatTile
              label="Still open"
              value={String(kpis.open)}
              sub={`${kpis.awaitingRider} to assign · ${kpis.awaitingAnswer} awaiting an answer · ${kpis.onTheRoad} on the road`}
              tone="flight"
            />
            <StatTile
              label="Rider declines"
              value={pct(kpis.declineRate)}
              sub={`${kpis.declined} waiting to be offered to somebody else`}
              tone={kpis.declined > 0 ? 'bad' : 'info'}
            />
            <StatTile
              label="Delivery fees"
              value={fmtMoney(kpis.feeTotal)}
              sub={`${fmtMoney(kpis.avgFee)} average per delivery`}
              tone="due"
            />
            <StatTile
              label="Average trip"
              value={`${kpis.avgDistance.toFixed(1)} km`}
              sub={
                kpis.avgMinutes > 0
                  ? `${kpis.avgMinutes.toFixed(0)} min estimated, where a time was quoted`
                  : 'no estimated times on these rows'
              }
            />
            <StatTile
              label="Cash on delivery"
              value={pct(kpis.codShare)}
              sub="share of deliveries where the rider collects for the goods"
            />
            <StatTile
              label="Fees on merchant accounts"
              value={pct(kpis.merchantPaidShare)}
              sub="the rest are collected from the customer at the door"
            />
            <StatTile
              label="Goods carried"
              value={fmtMoney(kpis.goodsTotal)}
              sub="total declared value moved in this period"
            />
          </div>
        )}
      </div>

      {kpis.total > 0 && (
        <>
          <div className="somo-card">
            <h3>
              Day by day
              <span className="tag-note">
                {rangeDays(range) === 0 ? `last ${ALL_TIME_CHART_DAYS} days` : rangeLabel.toLowerCase()}
              </span>
            </h3>
            <DayChart buckets={buckets} />
          </div>

          <div className="somo-card">
            <h3>
              Money in this period
              <span className="tag-note">summary of the ledger</span>
            </h3>
            <div className="somo-kpis">
              <StatTile
                label={`Merchants owe ${COMPANY}`}
                value={fmtMoney(money.merchantInvoicesDue)}
                sub="fees on account, delivery completed"
                tone="due"
              />
              <StatTile
                label="Rider float"
                value={fmtMoney(money.cashWithRiders)}
                sub={`${fmtMoney(money.cashWithRidersForUs)} ours · ${fmtMoney(
                  money.cashWithRidersForMerchants
                )} merchants'`}
                tone="due"
              />
              <StatTile
                label="Owed back to merchants"
                value={fmtMoney(money.cashWithRidersForMerchants)}
                sub="cash on delivery our riders have collected"
                tone="owed"
              />
              <StatTile
                label="Not collected yet"
                value={fmtMoney(money.codAwaitingCollection + money.feesAwaitingCollection)}
                sub="moves when the parcel is handed over"
                tone="flight"
              />
            </div>
          </div>

          <div className="somo-split">
            <div className="somo-card">
              <h3>
                Where deliveries sit
                <span className="tag-note">lifecycle order</span>
              </h3>
              <Bars rows={statuses} empty="No deliveries in this period." />
            </div>

            <div className="somo-card">
              <h3>
                Payment mix
                <span className="tag-note">two independent questions</span>
              </h3>
              <div className="somo-subhead">The goods</div>
              <Bars rows={items} empty="No payment terms recorded." />
              <div className="somo-subhead">The delivery fee</div>
              <Bars rows={payers} empty="No payment terms recorded." />
            </div>
          </div>

          <div className="somo-split">
            <div className="somo-card">
              <h3>
                What is being sent
                <span className="tag-note">item categories</span>
              </h3>
              <Bars rows={categories} empty="No item categories recorded." />
            </div>

            <div className="somo-card">
              <h3>
                Busiest drop-offs
                <span className="tag-note">top 8</span>
              </h3>
              <Bars rows={dropoffs} empty="No drop-offs in this period." />
            </div>
          </div>

          {seesAll && !merchantId && volume.length > 0 && (
            <div className="somo-card">
              <h3>
                Merchants
                <span className="tag-note">by volume</span>
              </h3>
              <ScrollableTable label="Merchant delivery performance" short>
                <table className="somo-table somo-mini-table">
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th>Deliveries</th>
                      <th>Handed over</th>
                      <th>Fees</th>
                      <th>Average fee</th>
                      <th>Goods value</th>
                      <th>Last request</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {volume.map((m) => (
                      <tr key={m.merchantId}>
                        <td>{m.name}</td>
                        <td className="somo-price-cell">{m.deliveries}</td>
                        <td className="somo-price-cell">
                          {m.completed}
                          <span className="somo-rider-sub">
                            {pct((m.completed / m.deliveries) * 100)}
                          </span>
                        </td>
                        <td className="somo-agreed-cell">{fmtMoney(m.feeTotal)}</td>
                        <td className="somo-price-cell">{fmtMoney(m.avgFee)}</td>
                        <td className="somo-price-cell">{fmtMoney(m.goodsTotal)}</td>
                        <td style={{ color: 'var(--somo-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDateTime(m.lastAt)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="somo-mini-btn"
                            onClick={() => setMerchantId(m.merchantId)}
                          >
                            Focus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}

          <div className="somo-split">
            {riders.length > 0 && (
              <div className="somo-card">
                <h3>
                  Riders
                  <InfoHint label="the rider table">
                    <p>
                      Read from the rider details snapshotted onto each delivery, so somebody who
                      has since left the fleet still appears against the jobs they carried.
                    </p>
                  </InfoHint>
                  <span className="tag-note">on these deliveries</span>
                </h3>
                <ScrollableTable label="Rider performance" short>
                  <table className="somo-table somo-mini-table">
                  <thead>
                    <tr>
                      <th>Rider</th>
                      <th>Given</th>
                      <th>Handed over</th>
                      <th>Declined</th>
                      <th>Fee value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riders.map((r) => (
                      <tr key={r.riderId || r.riderName}>
                        <td>{r.riderName}</td>
                        <td className="somo-price-cell">{r.offered}</td>
                        <td className="somo-price-cell">
                          {r.completed}
                          <span className="somo-rider-sub">{pct(r.completionRate)}</span>
                        </td>
                        <td className="somo-price-cell">{r.declined || '—'}</td>
                        <td className="somo-agreed-cell">{fmtMoney(r.feeTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </ScrollableTable>
              </div>
            )}

            <div className="somo-card">
              <h3>
                Repeat recipients
                <InfoHint label="repeat recipients">
                  <p>
                    Matched on the phone number rather than the name: the name is typed fresh on
                    every request, and the same doorstep is often spelled two ways.
                  </p>
                </InfoHint>
                <span className="tag-note">more than one delivery</span>
              </h3>
              {repeats.length === 0 ? (
                <div className="somo-empty small">
                  Nobody in this period has received more than once.
                </div>
              ) : (
                <ScrollableTable label="Repeat recipients" short>
                  <table className="somo-table somo-mini-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Deliveries</th>
                      <th>Goods value</th>
                      <th>Most recent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repeats.map((c) => (
                      <tr key={c.phoneKey}>
                        <td>
                          {c.name}
                          <br />
                          <span className="somo-rider-sub">{c.phone}</span>
                        </td>
                        <td className="somo-price-cell">{c.deliveries}</td>
                        <td className="somo-price-cell">{fmtMoney(c.goodsTotal)}</td>
                        <td style={{ color: 'var(--somo-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDateTime(c.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </ScrollableTable>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
