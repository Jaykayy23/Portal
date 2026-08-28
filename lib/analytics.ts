// Delivery analytics for the CRM dashboard.
//
// Pure functions over the rows the caller already has. Nothing here queries: the
// ledger and the dashboard both read the same `listDeliveriesFor` result, so RLS
// has already decided what is in the array and a merchant's dashboard can only
// ever describe their own traffic.
//
// Counting is done here rather than in SQL for the same reason the log filters in
// the browser: the rows are in memory, a range switch should not cost a round
// trip, and an install big enough for this to feel slow is the install that wants
// paged queries and materialised rollups — a different piece of work, not a
// bigger version of this one.

import { handedOver } from './ledger';
import { normalizePhone } from './phone';
import type { DeliveryStatus, DeliveryWithMerchant } from './types';

// ---------------------------------------------------------------------------
// Time range
// ---------------------------------------------------------------------------

export type RangeKey = '7d' | '30d' | '90d' | 'all';

export const RANGES: { value: RangeKey; label: string; days: number }[] = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  // The server has already bounded the loaded history to 365 days. Zero here
  // means "no additional client-side cutoff", and the chart still falls back to
  // a month so the full window does not render 365 bars.
  { value: 'all', label: 'Past 365 days', days: 0 },
];

export function rangeDays(range: RangeKey): number {
  return RANGES.find((r) => r.value === range)?.days ?? 0;
}

/**
 * Days in the day-by-day breakdown when the period is the full loaded year.
 *
 * 365 bars have no useful width on screen, so the chart borrows a month. Every
 * other figure on the dashboard still covers the whole reporting period — this
 * cap belongs to the daily breakdown alone, and both the chart heading and the
 * exported sheet say so.
 *
 * It lives here rather than in the dashboard component because the export builds
 * the same buckets: two copies of the number would eventually disagree, and the
 * file would then quietly describe a different window from the screen it came
 * from.
 */
export const ALL_TIME_CHART_DAYS = 30;

/** Days of daily buckets to build for a period — the chart's window, not the period's. */
export function chartDays(range: RangeKey): number {
  return rangeDays(range) || ALL_TIME_CHART_DAYS;
}

/** Local midnight, `daysBack` days ago. Whole days, so "7 days" means 7 dates. */
function startOfDayBack(now: Date, daysBack: number): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d;
}

export function inRange(iso: string, range: RangeKey, now: Date = new Date()): boolean {
  const days = rangeDays(range);
  if (days === 0) return true;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return true;
  return at >= startOfDayBack(now, days - 1);
}

export function filterByRange(
  records: DeliveryWithMerchant[],
  range: RangeKey,
  now: Date = new Date()
): DeliveryWithMerchant[] {
  if (rangeDays(range) === 0) return records;
  return records.filter((r) => inRange(r.date, range, now));
}

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export interface DeliveryKpis {
  total: number;
  /** Reached the recipient. The only definition of "done" this file uses. */
  completed: number;
  /** Filed and not yet handed over, whatever stage it is at. */
  open: number;
  /** Waiting on ops to offer it to somebody. */
  awaitingRider: number;
  /** Offered, no answer yet. */
  awaitingAnswer: number;
  /** A rider has it, or is on the way to collect it. */
  onTheRoad: number;
  /** Rows carrying a rider refusal that has not been reassigned away. */
  declined: number;
  completionRate: number;
  declineRate: number;
  feeTotal: number;
  avgFee: number;
  goodsTotal: number;
  avgDistance: number;
  avgMinutes: number;
  /** Share of deliveries where the rider collects cash for the goods. */
  codShare: number;
  /** Share of deliveries whose fee is billed to the merchant. */
  merchantPaidShare: number;
  /** Distinct merchants filing in this window. */
  merchants: number;
  /** Distinct recipient phone numbers — the customer base behind the traffic. */
  customers: number;
}

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function deliveryKpis(records: DeliveryWithMerchant[]): DeliveryKpis {
  const total = records.length;
  let completed = 0;
  let awaitingRider = 0;
  let awaitingAnswer = 0;
  let onTheRoad = 0;
  let declined = 0;
  let feeTotal = 0;
  let goodsTotal = 0;
  let distance = 0;
  let minutes = 0;
  let minutesCounted = 0;
  let cod = 0;
  let merchantPaid = 0;
  const merchants = new Set<string>();
  const customers = new Set<string>();

  for (const r of records) {
    feeTotal += r.price || 0;
    goodsTotal += r.declaredValue || 0;
    distance += r.distance || 0;
    // Rows quoted before time-based pricing have no minutes at all, and folding a
    // zero into the mean would drag the average down with data that isn't there.
    if (r.durationMin > 0) {
      minutes += r.durationMin;
      minutesCounted += 1;
    }
    if (r.itemPayment === 'Cash on delivery') cod += 1;
    if (r.deliveryPaidBy === 'Merchant') merchantPaid += 1;
    merchants.add(r.merchantId);
    // normalizePhone, not a bare digit strip: '024 000 0000' and '+233240000000'
    // are one person, and counting them as two overstates the customer base.
    if (r.recipientPhone) customers.add(normalizePhone(r.recipientPhone));

    if (handedOver(r)) {
      completed += 1;
      continue;
    }
    // `declinedAt` is cleared when a delivery is offered to somebody else, so
    // this counts refusals still sitting on the board — not every refusal ever
    // made. Reassignment is the fix for a decline, and a fixed one should not
    // keep showing up as a problem.
    if (r.declinedAt || r.status === 'Declined') declined += 1;

    if (r.status === 'Assigned' || r.status === 'Picked up') onTheRoad += 1;
    else if (r.status === 'Pending') awaitingAnswer += 1;
    else awaitingRider += 1;
  }

  return {
    total,
    completed,
    open: total - completed,
    awaitingRider,
    awaitingAnswer,
    onTheRoad,
    declined,
    completionRate: share(completed, total),
    declineRate: share(declined, total),
    feeTotal,
    avgFee: total > 0 ? feeTotal / total : 0,
    goodsTotal,
    avgDistance: total > 0 ? distance / total : 0,
    avgMinutes: minutesCounted > 0 ? minutes / minutesCounted : 0,
    codShare: share(cod, total),
    merchantPaidShare: share(merchantPaid, total),
    merchants: merchants.size,
    customers: customers.size,
  };
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

/** One bar on the dashboard: a label, a count, and money behind it. */
export interface Tally {
  key: string;
  label: string;
  count: number;
  value: number;
}

function tallyBy(
  records: DeliveryWithMerchant[],
  keyOf: (r: DeliveryWithMerchant) => string,
  labelOf: (key: string) => string = (k) => k
): Tally[] {
  const byKey = new Map<string, Tally>();
  for (const r of records) {
    const key = keyOf(r);
    const row = byKey.get(key) ?? { key, label: labelOf(key), count: 0, value: 0 };
    row.count += 1;
    row.value += r.price || 0;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/** Statuses in lifecycle order, not by size — this one is read as a funnel. */
export function statusMix(records: DeliveryWithMerchant[], order: DeliveryStatus[]): Tally[] {
  const counted = new Map(tallyBy(records, (r) => r.status).map((t) => [t.key, t]));
  return order.map(
    (status) => counted.get(status) ?? { key: status, label: status, count: 0, value: 0 }
  );
}

export function categoryMix(records: DeliveryWithMerchant[]): Tally[] {
  return tallyBy(
    records,
    (r) => r.itemCategory || '—',
    (k) => (k === '—' ? 'Not recorded' : k)
  );
}

export function typeMix(records: DeliveryWithMerchant[]): Tally[] {
  return tallyBy(records, (r) => r.type);
}

/** How the goods were paid for, and who settles the fee — two small bars each. */
export function itemPaymentMix(records: DeliveryWithMerchant[]): Tally[] {
  return tallyBy(
    records,
    (r) => r.itemPayment || '—',
    (k) => (k === '—' ? 'Not recorded' : k)
  );
}

export function feePayerMix(records: DeliveryWithMerchant[]): Tally[] {
  return tallyBy(
    records,
    (r) => r.deliveryPaidBy || '—',
    (k) =>
      k === '—' ? 'Not recorded' : k === 'Merchant' ? 'Merchant account' : 'Customer at the door'
  );
}

/** Where the parcels actually go. The nearest thing to a territory report. */
export function topDropoffs(records: DeliveryWithMerchant[], limit = 8): Tally[] {
  return tallyBy(records, (r) => r.dropoff.trim() || 'Unknown').slice(0, limit);
}

// ---------------------------------------------------------------------------
// Day by day
// ---------------------------------------------------------------------------

export interface DayBucket {
  /** Local YYYY-MM-DD. */
  key: string;
  /** Short axis label — 'Mon 18'. */
  label: string;
  deliveries: number;
  completed: number;
  fees: number;
}

function dayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * One bucket per date, oldest first, including the days nothing happened.
 *
 * The empty days are the point: a chart drawn only from the days with deliveries
 * makes a quiet week look identical to a busy one.
 */
export function perDay(
  records: DeliveryWithMerchant[],
  days: number,
  now: Date = new Date()
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const at = startOfDayBack(now, i);
    buckets.set(dayKey(at), {
      key: dayKey(at),
      label: at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
      deliveries: 0,
      completed: 0,
      fees: 0,
    });
  }

  for (const r of records) {
    const at = new Date(r.date);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = buckets.get(dayKey(at));
    // Older than the chart window, which is normal for the full loaded year.
    if (!bucket) continue;
    bucket.deliveries += 1;
    bucket.fees += r.price || 0;
    if (handedOver(r)) bucket.completed += 1;
  }

  return [...buckets.values()];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface MerchantVolume {
  merchantId: string;
  name: string;
  deliveries: number;
  completed: number;
  feeTotal: number;
  avgFee: number;
  goodsTotal: number;
  /** ISO of their most recent request — the "still active?" column. */
  lastAt: string;
}

export function merchantVolume(records: DeliveryWithMerchant[]): MerchantVolume[] {
  const byMerchant = new Map<string, MerchantVolume>();

  for (const r of records) {
    const row: MerchantVolume = byMerchant.get(r.merchantId) ?? {
      merchantId: r.merchantId,
      name: r.customer,
      deliveries: 0,
      completed: 0,
      feeTotal: 0,
      avgFee: 0,
      goodsTotal: 0,
      lastAt: '',
    };
    row.deliveries += 1;
    if (handedOver(r)) row.completed += 1;
    row.feeTotal += r.price || 0;
    row.goodsTotal += r.declaredValue || 0;
    row.avgFee = row.feeTotal / row.deliveries;
    if (!row.lastAt || r.date > row.lastAt) row.lastAt = r.date;
    byMerchant.set(r.merchantId, row);
  }

  return [...byMerchant.values()].sort((a, b) => b.deliveries - a.deliveries);
}

export interface RiderPerformance {
  riderId: string;
  riderName: string;
  /** Jobs that reached this rider at all. */
  offered: number;
  completed: number;
  /** Refusals still recorded against them. */
  declined: number;
  /** Fee value carried, whoever settled it. */
  feeTotal: number;
  completionRate: number;
}

/**
 * Riders as their own delivery rows describe them.
 *
 * Built from the snapshot columns rather than the roster, which is what lets the
 * dashboard work for a viewer with no access to `riders` at all — and keeps a
 * rider who has since left the fleet in the history where they belong.
 */
export function riderPerformance(records: DeliveryWithMerchant[]): RiderPerformance[] {
  const byRider = new Map<string, RiderPerformance>();

  for (const r of records) {
    if (!r.riderName && !r.riderId) continue;
    const key = r.riderId || `name:${r.riderName}`;
    const row: RiderPerformance = byRider.get(key) ?? {
      riderId: r.riderId,
      riderName: r.riderName || 'Unnamed rider',
      offered: 0,
      completed: 0,
      declined: 0,
      feeTotal: 0,
      completionRate: 0,
    };
    row.offered += 1;
    if (handedOver(r)) row.completed += 1;
    if (r.declinedAt || r.status === 'Declined') row.declined += 1;
    row.feeTotal += r.price || 0;
    row.completionRate = share(row.completed, row.offered);
    byRider.set(key, row);
  }

  return [...byRider.values()].sort((a, b) => b.completed - a.completed);
}

export interface RepeatCustomer {
  /** Normalised, so 024 000 0000 and +233240000000 are one person. */
  phoneKey: string;
  name: string;
  phone: string;
  deliveries: number;
  goodsTotal: number;
  lastAt: string;
}

/**
 * Recipients who have received more than once, most frequent first.
 *
 * Keyed on the phone number rather than the name because the name is typed fresh
 * every time and "Ama" and "Ama K." are the same doorstep. Single deliveries are
 * dropped: this table exists to show which customers come back.
 */
export function repeatCustomers(records: DeliveryWithMerchant[], limit = 8): RepeatCustomer[] {
  const byPhone = new Map<string, RepeatCustomer>();

  for (const r of records) {
    const phoneKey = normalizePhone(r.recipientPhone);
    if (!phoneKey) continue;
    const row: RepeatCustomer = byPhone.get(phoneKey) ?? {
      phoneKey,
      name: r.recipientName || 'Unnamed',
      phone: r.recipientPhone,
      deliveries: 0,
      goodsTotal: 0,
      lastAt: '',
    };
    row.deliveries += 1;
    row.goodsTotal += r.declaredValue || 0;
    if (!row.lastAt || r.date > row.lastAt) {
      row.lastAt = r.date;
      // The most recent spelling of the name wins — it is the freshest thing the
      // merchant typed about this person.
      row.name = r.recipientName || row.name;
    }
    byPhone.set(phoneKey, row);
  }

  return [...byPhone.values()]
    .filter((c) => c.deliveries > 1)
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, limit);
}
