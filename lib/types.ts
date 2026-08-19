// App-facing domain types.
//
// These stay camelCase while the database is snake_case. The mapping happens in
// the per-domain query modules (lib/accounts.ts, lib/riders.ts, lib/deliveries.ts,
// lib/settings.ts), which keeps SQL column naming out of the React components.

export type Role = 'admin' | 'ops' | 'merchant';

export const ROLES: Role[] = ['admin', 'ops', 'merchant'];

/** Account shape safe to send to a browser. */
export interface PublicAccount {
  username: string;
  role: Role;
  companyName: string;
  phone: string;
  active: boolean;
  createdAt?: string;
}

export type RiderStatus = 'Available' | 'On delivery' | 'Offline';

export const RIDER_STATUSES: RiderStatus[] = ['Available', 'On delivery', 'Offline'];

export interface Rider {
  id: string;
  name: string;
  phone: string;
  regNumber: string;
  model: string;
  status: RiderStatus;
}

export type DeliveryStatus =
  | 'Requested'
  | 'Requires approval'
  | 'Approved'
  | 'Assigned'
  | 'Delivered';

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  'Requested',
  'Requires approval',
  'Approved',
  'Assigned',
  'Delivered',
];

export type DeliveryType = 'Standard' | 'Express' | 'Fragile';

export const DELIVERY_TYPES: { value: DeliveryType; label: string }[] = [
  { value: 'Standard', label: 'Standard' },
  { value: 'Express', label: 'Express (same-day)' },
  { value: 'Fragile', label: 'Fragile / handle with care' },
];

export interface Delivery {
  id: string;
  date: string;
  /** Merchant company name captured at submission time. */
  customer: string;
  merchantId: string;
  submittedBy: string;
  pickup: string;
  dropoff: string;
  distance: number;
  /** Estimated driving time in minutes, captured with the distance at quote time. */
  durationMin: number;
  type: DeliveryType;
  /** What was being sent, e.g. 'Food'. Snapshotted, so a renamed category never
   *  rewrites an old record. Empty for rows filed before categories existed. */
  itemCategory: string;
  surcharges: string[];
  declaredValue: number;
  recommended: number;
  minimum: number;
  agreed: number;
  status: DeliveryStatus;
  riderId: string;
  riderName: string;
  riderPhone: string;
  riderReg: string;
  riderModel: string;
  /** When the rider confirmed completion via their link. '' if they never did. */
  deliveredAt: string;
}

/**
 * What a rider sees after opening their completion link.
 *
 * Deliberately narrow: no price, no declared value, nothing about any other
 * order. Whoever holds the link holds the whole credential, so it shows only
 * what someone needs to recognise the job they just finished.
 */
export interface CompletionSummary {
  /** The short human-facing order number, not the uuid. */
  orderNo: string;
  customer: string;
  pickup: string;
  dropoff: string;
  itemCategory: string;
  riderName: string;
}

export type CompletionState =
  /** Live link, waiting on the rider's tap. */
  | 'pending'
  /** Already confirmed — by this link or an earlier one for the same delivery. */
  | 'confirmed'
  /** Past its expiry. Ops can issue a fresh one from the Notify modal. */
  | 'expired'
  /** The delivery has since been given to a different rider (or unassigned). */
  | 'reassigned'
  /** No such link. Also what a mistyped or truncated URL looks like. */
  | 'invalid';

export interface CompletionView {
  state: CompletionState;
  /** Null for 'invalid' — an unknown token is told nothing at all. */
  summary: CompletionSummary | null;
  /** ISO timestamp when state is 'confirmed', otherwise ''. */
  confirmedAt: string;
}

/** A delivery as sent to ops/admin — enriched with the merchant's phone number. */
export interface DeliveryWithMerchant extends Delivery {
  merchantPhone?: string;
}

/**
 * One selectable surge charge. Configured by admin under Settings, so the id is
 * whatever was slugified from the label when the row was created — deliveries
 * store these ids, which is why an existing one is never rewritten.
 */
export interface SurchargeOption {
  id: string;
  label: string;
  amount: number;
}

export interface PricingParams {
  base: number;
  rate: number;
  /** GHS per minute of estimated driving time. 0 disables time-based pricing. */
  perMin: number;
  minFare: number;
  minPct: number;
  opsPhone: string;
  /** Surge charges offered on the New delivery form, in display order. */
  surcharges: SurchargeOption[];
}

/**
 * Options the admin configures for the New delivery form. Kept separate from
 * PricingParams because none of it touches the quote.
 */
export interface DeliveryOptions {
  /** Item categories in display order. Empty hides the field from the form. */
  itemCategories: string[];
}

export interface OtherKey {
  name: string;
  value: string;
}

export interface AppSettings {
  mapsApiKey: string;
  whatsappOtpKey: string;
  smsApiKey: string;
  otherKeys: OtherKey[];
  logoDataUrl: string;
}

/** The signed-in identity. `id` is the auth.users UUID, and the RLS subject. */
export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  companyName: string;
  phone: string;
}

export function isOpsOrAdmin(user: Pick<SessionUser, 'role'> | null): boolean {
  return user?.role === 'admin' || user?.role === 'ops';
}

export function isAdmin(user: Pick<SessionUser, 'role'> | null): boolean {
  return user?.role === 'admin';
}
