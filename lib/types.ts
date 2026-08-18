export type Role = 'admin' | 'ops' | 'merchant';

export const ROLES: Role[] = ['admin', 'ops', 'merchant'];

/** Full account record as stored in db.json — includes the bcrypt hash. */
export interface Account {
  username: string;
  phone: string;
  passwordHash: string;
  role: Role;
  companyName: string;
  active: boolean;
  createdAt: string;
}

/** Account shape safe to send to a browser. Never contains passwordHash. */
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
  /** Merchant company name this request belongs to. */
  customer: string;
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

export interface Database {
  accounts: Record<string, Account>;
  riders: Record<string, Rider>;
  deliveries: Record<string, Delivery>;
  pricingParams: PricingParams;
  appSettings: AppSettings;
}

/** The signed-in identity attached to a request. */
export interface SessionUser {
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
