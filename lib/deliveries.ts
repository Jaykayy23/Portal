// Server-side delivery queries shared by the Route Handlers and the pages that
// render the log.

import { getDb } from './db';
import {
  isOpsOrAdmin,
  type Database,
  type Delivery,
  type DeliveryWithMerchant,
  type SessionUser,
} from './types';

/**
 * Merchant accounts are matched to deliveries by company name, which is how the
 * original portal stored the link. Renaming a merchant's company name therefore
 * detaches their delivery history — worth replacing with an account id if this
 * schema ever gets a migration.
 */
export function findMerchantPhone(db: Database, companyName: string): string {
  if (!companyName) return '';
  const target = companyName.trim().toLowerCase();
  const match = Object.values(db.accounts).find(
    (a) => a.role === 'merchant' && (a.companyName || '').trim().toLowerCase() === target
  );
  return match ? match.phone : '';
}

/**
 * Newest first. Merchants get only their own rows; ops/admin get every row, each
 * enriched with the merchant's phone number for the Notify action.
 */
export function listDeliveriesFor(user: SessionUser): DeliveryWithMerchant[] {
  const db = getDb();
  const all: Delivery[] = Object.values(db.deliveries).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (!isOpsOrAdmin(user)) {
    const mine = user.companyName.trim().toLowerCase();
    return all.filter((r) => (r.customer || '').trim().toLowerCase() === mine);
  }
  return all.map((r) => ({ ...r, merchantPhone: findMerchantPhone(db, r.customer) }));
}
