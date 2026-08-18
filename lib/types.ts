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
  type: DeliveryType;
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
}

/** A delivery as sent to ops/admin — enriched with the merchant's phone number. */
export interface DeliveryWithMerchant extends Delivery {
  merchantPhone?: string;
}

export interface PricingParams {
  base: number;
  rate: number;
  minFare: number;
  minPct: number;
  opsPhone: string;
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
