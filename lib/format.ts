import type { DeliveryStatus } from './types';

/** GHS money formatting, matching the original portal's display. */
export function fmtMoney(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return (
    'GHS ' +
    v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** "Mar 4 14:32" — short, locale-aware. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Human-facing order number: "SME" and the last 5 chars of the uuid part of
 * "d_<uuid>" — "SME4f2a1".
 *
 * The prefix is part of the number, not decoration around it, so it belongs
 * here rather than at each of the dozen places that print one. Nothing parses
 * an order number back into an id, so this is free to be read aloud, written on
 * a waybill and typed into the search box.
 */
export function orderNo(id: string): string {
  const parts = (id || '').split('_');
  return 'SME' + (parts[1] || id || '').slice(-5);
}

/**
 * The badge class for a delivery status.
 *
 * Here rather than beside one table because the log and the ledger both render
 * the status, and two copies of this map is how they end up disagreeing about
 * what colour 'Declined' is.
 */
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

export function statusBadgeClass(status: DeliveryStatus): string {
  return STATUS_CLASS[status] || 'b-requested';
}
