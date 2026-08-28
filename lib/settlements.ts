// Settlement queries.
//
// Reads go through the caller's own session, so the RLS policies decide what
// comes back: finance, ops and admin see the whole remittance book, a merchant
// sees the settlements they are party to and the lines on their own deliveries.
//
// Writes go through two database functions rather than inserts. That is not a
// shortcut around RLS — it is the opposite. `authenticated` holds no INSERT or
// UPDATE grant on either table, so there is no request shape that writes a
// settlement without passing the rules inside `record_settlement`: the amount is
// read from the delivery row, the leg is checked against the delivery's status
// and the legs it has already travelled, and the whole thing is one transaction
// so a header can never end up with no lines. See the settlements migration.

import { createSupabaseServerClient } from './supabase/server';
import { keysetBefore, readAllPages, READ_PAGE_SIZE } from './pagedRead';
import { userMessage } from './errors';
import { orderNo } from './format';
import type {
  SettlementKind,
  SettlementLeg,
  SettlementMark,
  SettlementMarks,
  SettlementStream,
} from './ledger';
import type { Database } from './database.types';

type SettlementRow = Database['public']['Tables']['settlements']['Row'];
type SettlementLineRow = Database['public']['Tables']['settlement_lines']['Row'];

export class SettlementError extends Error {}

/**
 * The ceiling on one settlement read, across all its pages.
 *
 * Higher than the delivery ceiling because a delivery can carry several lines —
 * goods in, goods out, fee — so the remittance book outgrows the log it settles.
 */
export const SETTLEMENT_MAX_ROWS = 50 * READ_PAGE_SIZE;

/** One line of a settlement, as a browser reads it. */
export interface SettlementLine {
  deliveryId: string;
  /** The short order number, so the list reads like the log. */
  orderNo: string;
  stream: SettlementStream;
  leg: SettlementLeg;
  kind: SettlementKind;
  amount: number;
}

/** One recorded money movement. */
export interface SettlementRecord {
  id: string;
  settledAt: string;
  recordedAt: string;
  riderId: string;
  riderName: string;
  merchantId: string;
  merchantName: string;
  method: string;
  reference: string;
  note: string;
  /** Snapshotted, so finance can read it without access to ops/admin profiles. */
  recordedByName: string;
  voidedAt: string;
  voidedByName: string;
  voidReason: string;
  lines: SettlementLine[];
  /** Money that actually came to us on this settlement. */
  totalIn: number;
  /** Money that left us on it. */
  totalOut: number;
  /** Closed without being paid, and charged to somebody. Not cash. */
  totalWrittenOff: number;
}

/** The delivery window these marks are being read for. */
export interface SettlementReadRange {
  /** The oldest delivery date on screen. Nothing settled before it can matter. */
  from: string;
}

export interface SettlementMarkSet {
  marks: SettlementMarks;
  /**
   * The ceiling was reached, so some marks are missing — and a missing mark does
   * not read as "unknown", it reads as "not settled". Anything computed from a
   * truncated set overstates what is owed.
   */
  truncated: boolean;
}

/**
 * Settled legs, keyed by delivery id, for the ledger to read positions with.
 *
 * Voided lines are excluded here rather than filtered later: a voided settlement
 * did not happen, so the obligation is open again and nothing downstream should
 * have to remember that.
 *
 * The header is fetched separately and merged rather than joined, because a
 * merchant can read a line without being able to read the settlement it belongs
 * to — a rider's remittance covers several merchants at once. An embedded join
 * would make that difference silent; two queries make it explicit, and the
 * paperwork fields simply stay blank on the rows they cannot see.
 *
 * `range` is the delivery window the caller loaded, and passing it is what keeps
 * this read proportionate: a settlement cannot predate the delivery it settles,
 * so every mark that could belong to a row on screen was settled at or after the
 * window's start. Without it, the oldest marks in the book are read first and
 * the newest — the ones belonging to the deliveries actually on screen — are the
 * ones a ceiling would drop. Getting that wrong flips settled money back to
 * unsettled and sends somebody to collect a debt that was already paid.
 */
export async function listSettlementMarks(
  range?: SettlementReadRange
): Promise<SettlementMarkSet> {
  const supabase = await createSupabaseServerClient();

  const [lines, headers] = await Promise.all([
    readAllPages({
      page: (cursor, size) => {
        let query = supabase.from('settlement_lines').select('*').eq('voided', false);
        if (range) query = query.gte('settled_at', range.from);
        if (cursor) query = query.or(keysetBefore('settled_at', cursor));
        return query
          .order('settled_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(size);
      },
      cursorOf: (row) => ({ sort: row.settled_at, id: row.id }),
      maxRows: SETTLEMENT_MAX_ROWS,
      context: 'settlements.settlementMarks (lines)',
      fail: (message) => new SettlementError(message),
      unavailable: 'Could not load the settlement records.',
    }),
    readAllPages({
      page: (cursor, size) => {
        let query = supabase.from('settlements').select('*').is('voided_at', null);
        if (range) query = query.gte('settled_at', range.from);
        if (cursor) query = query.or(keysetBefore('settled_at', cursor));
        return query
          .order('settled_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(size);
      },
      cursorOf: (row) => ({ sort: row.settled_at, id: row.id }),
      maxRows: SETTLEMENT_MAX_ROWS,
      context: 'settlements.settlementMarks (headers)',
      fail: (message) => new SettlementError(message),
      unavailable: 'Could not load the settlement records.',
    }),
  ]);

  const headerById = new Map(headers.rows.map((h) => [h.id, h]));
  const marks: SettlementMarks = new Map();

  for (const line of lines.rows) {
    const header = headerById.get(line.settlement_id);
    const mark: SettlementMark = {
      stream: line.stream,
      leg: line.leg,
      kind: line.kind,
      amount: Number(line.amount),
      settledAt: line.settled_at,
      reference: header?.reference ?? '',
      method: header?.method ?? '',
      counterparty: header ? header.rider_name || '' : '',
    };
    const existing = marks.get(line.delivery_id);
    if (existing) existing.push(mark);
    else marks.set(line.delivery_id, [mark]);
  }

  // Oldest first, so 'in' reads before 'out' on a two-leg position.
  for (const list of marks.values()) {
    list.sort((a, b) => a.settledAt.localeCompare(b.settledAt));
  }

  return { marks, truncated: lines.truncated || headers.truncated };
}

function toRecord(
  row: SettlementRow,
  lines: SettlementLineRow[],
  merchantNames: Map<string, string>
): SettlementRecord {
  const mapped = lines.map((l) => ({
    deliveryId: l.delivery_id,
    orderNo: orderNo(l.delivery_id),
    stream: l.stream,
    leg: l.leg,
    kind: l.kind,
    amount: Number(l.amount),
  }));

  return {
    id: row.id,
    settledAt: row.settled_at,
    recordedAt: row.created_at,
    riderId: row.rider_id ?? '',
    riderName: row.rider_name,
    merchantId: row.merchant_id ?? '',
    merchantName: row.merchant_id ? merchantNames.get(row.merchant_id) ?? '' : '',
    method: row.method,
    reference: row.reference,
    note: row.note,
    recordedByName: row.recorded_by_name,
    voidedAt: row.voided_at ?? '',
    voidedByName: row.voided_by_name,
    voidReason: row.void_reason,
    lines: mapped,
    // A write-off sits on the inbound leg but is not money received, so it is
    // counted apart or the remittance book would read as cash that arrived.
    totalIn: mapped
      .filter((l) => l.leg === 'in' && l.kind === 'payment')
      .reduce((sum, l) => sum + l.amount, 0),
    totalOut: mapped.filter((l) => l.leg === 'out').reduce((sum, l) => sum + l.amount, 0),
    totalWrittenOff: mapped
      .filter((l) => l.kind === 'writeoff')
      .reduce((sum, l) => sum + l.amount, 0),
  };
}

/**
 * The remittance book, newest first, voided ones included and marked.
 *
 * A voided settlement stays in the list on purpose: "we recorded this and then
 * unwound it, here is who and why" is the thing a deleted row cannot tell you.
 */
export async function listSettlements(
  limit = 100,
  range?: { from: string; before: string }
): Promise<SettlementRecord[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase.from('settlements').select('*');
  if (range) {
    query = query.gte('settled_at', range.from).lt('settled_at', range.before);
  }

  const { data: rows, error } = await query
    .order('settled_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (error)
    throw new SettlementError(
      userMessage('settlements.listSettlements', error, 'Could not load the settlement history.')
    );
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  // Paged and ordered like every other read here. One settlement carries a line
  // per leg per delivery, so a hundred bulk remittances can run past a single
  // response — and a dropped line is money missing from a total that the sheet
  // still presents as the settlement's full value.
  const [lines, { data: merchants }] = await Promise.all([
    readAllPages({
      page: (cursor, size) => {
        let query = supabase.from('settlement_lines').select('*').in('settlement_id', ids);
        if (cursor) query = query.or(keysetBefore('settled_at', cursor));
        return query
          .order('settled_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(size);
      },
      cursorOf: (row) => ({ sort: row.settled_at, id: row.id }),
      maxRows: SETTLEMENT_MAX_ROWS,
      context: 'settlements.listSettlements (lines)',
      fail: (message) => new SettlementError(message),
      unavailable: 'Could not load the settlement history.',
    }),
    supabase.from('profiles').select('id, company_name').eq('role', 'merchant'),
  ]);

  const merchantNames = new Map((merchants ?? []).map((m) => [m.id, m.company_name]));
  const linesBySettlement = new Map<string, SettlementLineRow[]>();
  for (const line of lines.rows) {
    const existing = linesBySettlement.get(line.settlement_id);
    if (existing) existing.push(line);
    else linesBySettlement.set(line.settlement_id, [line]);
  }

  return rows.map((r) => toRecord(r, linesBySettlement.get(r.id) ?? [], merchantNames));
}

export interface RecordSettlementInput {
  /** Exactly one of these. The database rejects both or neither. */
  riderId?: string;
  merchantId?: string;
  method: string;
  reference: string;
  note: string;
  /** ISO. Omit for now. Back-dating is allowed, the future is not. */
  settledAt?: string;
  /**
   * Amounts are optional: omitting one means all of what is still owed, and
   * whatever is sent is bounded server-side by the obligation's remaining room.
   */
  lines: {
    deliveryId: string;
    stream: SettlementStream;
    leg: SettlementLeg;
    kind?: SettlementKind;
    amount?: number;
  }[];
}

/**
 * Records a settlement. Returns the new id.
 *
 * Every rule that matters lives in the function this calls, so the errors it
 * raises are the useful ones ("Order #4f2a1 has already been settled for that
 * part") and they are surfaced to the caller as-is.
 */
export async function recordSettlement(input: RecordSettlementInput): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('record_settlement', {
    p_rider_id: input.riderId || null,
    p_merchant_id: input.merchantId || null,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
    p_settled_at: input.settledAt || null,
    p_lines: input.lines.map((l) => ({
      delivery_id: l.deliveryId,
      stream: l.stream,
      leg: l.leg,
      kind: l.kind ?? 'payment',
      amount: l.amount,
    })),
  });

  if (error)
    throw new SettlementError(userMessage('settlements.recordSettlement', error, 'Could not record that settlement.'));
  return data as string;
}

export async function voidSettlement(id: string, reason: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('void_settlement', { p_id: id, p_reason: reason });
  if (error)
    throw new SettlementError(userMessage('settlements.voidSettlement', error, 'Could not void that settlement.'));
}
