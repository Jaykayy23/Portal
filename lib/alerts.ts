// What is waiting on the person looking at the portal.
//
// This used to live inside components/delivery/DeliveryLog.tsx, because the
// attention queue was a band above the delivery table and nothing else needed
// it. The queue is a topbar bell now — present on every portal tab — so the
// derivation moved here and the log reads the same numbers the bell does. One
// number, one source.

import type { DeliveryWithMerchant, Role, SessionUser } from './types';
import { isOpsOrAdmin } from './types';

/**
 * Most alert rows the bell carries the full delivery for.
 *
 * The panel needs the whole record to open the notify modal, and a backlog of
 * two hundred unassigned requests would otherwise put two hundred delivery rows
 * into the client payload of *every* portal route. The count is always the true
 * total — only the list is capped, and the panel says so.
 */
export const ALERT_LIST_LIMIT = 25;

export interface DeliveryAlert {
  /**
   * Identity of this alert, not of the delivery. Status is what the action is
   * derived from, so a row that moves on produces a different key and reads as a
   * new alert rather than a stale one.
   */
  key: string;
  /** What the reader has to do. */
  action: string;
  /** Whether this reader's own action here is the merchant pickup confirmation. */
  confirmPickup: boolean;
  record: DeliveryWithMerchant;
}

export interface AlertFeed {
  /** Every outstanding alert's key, uncapped — this is what "unread" is counted over. */
  keys: string[];
  /** The first ALERT_LIST_LIMIT alerts, with the records the panel needs. */
  items: DeliveryAlert[];
  /** The true total, which may exceed `items.length`. */
  total: number;
}

/**
 * What the person looking at this screen has to do next about a delivery.
 *
 * Derived from status rather than stored, so an item cannot go stale: it is
 * present exactly while the delivery is waiting on this reader, and disappears
 * the moment whoever it was waiting on acts. That is also why nothing here is
 * ever "dismissed" — the state is the alert. The bell's unread count is a
 * separate, purely local matter of whether this browser has *looked* yet.
 */
export function actionNeeded(r: DeliveryWithMerchant, canManage: boolean): string | null {
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

/**
 * Does this seat have outstanding work of its own at all?
 *
 * The log page redirects finance to the ledger, so this question never came up
 * while the queue lived on that page. The bell is on every tab, and finance
 * reads the whole business — so without this check a finance seat would be told
 * to confirm the pickup of every assigned delivery in the country, none of which
 * is theirs to confirm. Finance is read-only by construction; a read-only seat
 * has no alerts.
 */
export function seatHasAlerts(role: Role): boolean {
  return role === 'admin' || role === 'ops' || role === 'merchant';
}

/**
 * The alert feed for one seat, from the rows RLS already decided it may read.
 */
export function alertFeed(user: SessionUser, records: DeliveryWithMerchant[]): AlertFeed {
  if (!seatHasAlerts(user.role)) return { keys: [], items: [], total: 0 };

  const canManage = isOpsOrAdmin(user);
  const alerts: DeliveryAlert[] = [];

  for (const record of records) {
    const action = actionNeeded(record, canManage);
    if (!action) continue;
    alerts.push({
      key: `${record.id}|${record.status}`,
      action,
      confirmPickup: !canManage && record.status === 'Assigned',
      record,
    });
  }

  return {
    keys: alerts.map((a) => a.key),
    items: alerts.slice(0, ALERT_LIST_LIMIT),
    total: alerts.length,
  };
}
