// Delivery queries.
//
// Merchant isolation is now enforced by RLS (see supabase/migrations). These
// queries no longer filter by merchant themselves — Postgres does it. The
// explicit role branch below exists only to decide whether to *enrich* rows with
// the merchant's phone number, not to decide who sees what.

import { cache } from 'react';
import { createSupabaseServerClient } from './supabase/server';
import { keysetBefore, readAllPages, READ_PAGE_SIZE } from './pagedRead';
import { syncRiderAvailability } from './riderAvailability';
import { userMessage } from './errors';
import { seesAllMerchants, type Delivery, type DeliveryWithMerchant, type SessionUser } from './types';
import type { Database } from './database.types';

type DeliveryRow = Database['public']['Tables']['deliveries']['Row'];

export class DeliveryError extends Error {}

/** The row changed under the caller — refresh and retry, nothing was written. */
export class DeliveryConflictError extends DeliveryError {}

/** One request's worth of rows — the Data API's configured ceiling. */
export const DELIVERY_READ_LIMIT = READ_PAGE_SIZE;
/**
 * The ceiling across all pages of one history read.
 *
 * The window is what bounds an ordinary read; this only exists so a install that
 * has grown far past what these screens were built for degrades into a warning
 * instead of an out-of-memory kill. Twenty pages of deliveries is roughly 55 a
 * day for a year, well past the traffic the in-memory analytics in lib/analytics
 * were sized for — an install reaching it needs aggregation in SQL, and the
 * banner is what says so.
 */
export const DELIVERY_MAX_ROWS = 20 * DELIVERY_READ_LIMIT;
/** The full history loaded into portal screens and exports. */
export const DELIVERY_HISTORY_DAYS = 365;

/**
 * A whole-UTC-day range, inclusive of today and the preceding 364 dates.
 *
 * Whole days keep independently rendered server components on the same cache
 * key and avoid excluding deliveries filed later on the current date.
 */
export interface DeliveryHistoryRange {
  from: string;
  before: string;
}

export function deliveryHistoryRange(
  days = DELIVERY_HISTORY_DAYS,
  now = new Date()
): DeliveryHistoryRange {
  const before = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const from = new Date(before);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), before: before.toISOString() };
}

export function fromRow(r: DeliveryRow): Delivery {
  return {
    id: r.id,
    date: r.created_at,
    customer: r.customer,
    // Blank on rows filed before recipients were captured.
    recipientName: r.recipient_name ?? '',
    recipientPhone: r.recipient_phone ?? '',
    merchantId: r.merchant_id,
    submittedBy: r.submitted_by,
    pickup: r.pickup,
    dropoff: r.dropoff,
    distance: Number(r.distance),
    durationMin: Number(r.duration_min) || 0,
    type: r.type,
    itemCategory: r.item_category ?? '',
    surcharges: r.surcharges ?? [],
    declaredValue: Number(r.declared_value),
    itemPayment: r.item_payment ?? '',
    deliveryPaidBy: r.delivery_paid_by ?? '',
    // `agreed` is the one price column the app reads. See the
    // remove-negotiation migration for why the other two are still there.
    price: Number(r.agreed),
    status: r.status,
    riderId: r.rider_id ?? '',
    riderName: r.rider_name,
    riderPhone: r.rider_phone,
    riderReg: r.rider_reg,
    riderModel: r.rider_model,
    acceptedAt: r.accepted_at ?? '',
    declinedAt: r.declined_at ?? '',
    pickedUpAt: r.picked_up_at ?? '',
    recipientConfirmedAt: r.recipient_confirmed_at ?? '',
    deliveredAt: r.delivered_at ?? '',
  };
}

/**
 * Newest first. A merchant receives only their own rows because the RLS SELECT
 * policy allows nothing else — not because of anything in this function.
 *
 * For the roles that see every merchant — ops, admin and finance — each row is
 * enriched with the merchant's phone: ops needs it for the Notify action, and
 * finance needs a way to reach whoever owes an invoice. That's done with one
 * extra query over the merchant profiles rather than a lookup per row.
 *
 * Deduplicated per request with React's `cache`, keyed on scalar identity,
 * enrichment and range values rather than on the user object — two callers in
 * one render may hold different `SessionUser` objects, and `cache` compares
 * objects by identity, so passing the object would miss every time.
 *
 * Per request, so nothing survives into another user's render — and RLS decides
 * the rows either way.
 */
export function listDeliveriesFor(
  user: SessionUser,
  range = deliveryHistoryRange()
): Promise<DeliveryHistory> {
  const { from, before } = range;
  return listDeliveries(user.id, seesAllMerchants(user), from, before, DELIVERY_MAX_ROWS);
}

/**
 * A history read and whether it is the whole window.
 *
 * `truncated` is not a detail for the log: everything computed from `records` —
 * outstanding balances, rider floats, the dashboard's counts — is then a floor
 * rather than a total, and a screen that shows those figures has to say so.
 */
export interface DeliveryHistory {
  records: DeliveryWithMerchant[];
  truncated: boolean;
}

const listDeliveries = cache(async function listDeliveries(
  _userId: string,
  enrichWithMerchantPhone: boolean,
  from: string,
  before: string,
  maxRows: number
): Promise<DeliveryHistory> {
  const supabase = await createSupabaseServerClient();

  // Paged rather than capped. A single .limit() would hand back the newest 1,000
  // rows of a year and no indication that the rest existed, so a debt older than
  // the cut would simply stop being owed — the ledger reporting less outstanding
  // money than there is, with nothing on screen to suggest it.
  const { rows, truncated } = await readAllPages({
    page: (cursor, size) => {
      let query = supabase
        .from('deliveries')
        .select('*')
        .gte('created_at', from)
        .lt('created_at', before);
      // ANDed with the window filters above, so each page picks up strictly
      // where the last one stopped without widening the range.
      if (cursor) query = query.or(keysetBefore('created_at', cursor));
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(size);
    },
    cursorOf: (row) => ({ sort: row.created_at, id: row.id }),
    maxRows,
    context: 'deliveries.listDeliveries',
    fail: (message) => new DeliveryError(message),
    unavailable: 'Could not load the delivery history.',
  });

  const records = rows.map(fromRow);
  if (!enrichWithMerchantPhone) return { records, truncated };

  const { data: merchants } = await supabase
    .from('profiles')
    .select('id, phone')
    .eq('role', 'merchant');

  const phoneById = new Map((merchants ?? []).map((m) => [m.id, m.phone]));
  return {
    records: records.map((r) => ({ ...r, merchantPhone: phoneById.get(r.merchantId) ?? '' })),
    truncated,
  };
});

/**
 * The alert bell has a separate operational read instead of loading the portal's
 * entire delivery window on every tab. These are precisely the statuses from
 * which `alertFeed` can produce work for at least one alert-bearing role.
 *
 * There is deliberately no age cutoff here: a request still waiting on someone
 * after a year is more important, not less. The status filter keeps terminal
 * history out, while the explicit limit prevents another silent Data API cliff.
 */
const ALERT_DELIVERY_STATUSES: Delivery['status'][] = [
  'Requested',
  'Approved',
  'Pending',
  'Declined',
  'Assigned',
  'Recipient confirmed',
];

export function listAlertDeliveriesFor(
  user: SessionUser
): Promise<DeliveryWithMerchant[]> {
  return listAlertDeliveries(user.id, seesAllMerchants(user));
}

const listAlertDeliveries = cache(async function listAlertDeliveries(
  _userId: string,
  enrichWithMerchantPhone: boolean
): Promise<DeliveryWithMerchant[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .in('status', ALERT_DELIVERY_STATUSES)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(DELIVERY_READ_LIMIT);

  if (error)
    throw new DeliveryError(
      userMessage('deliveries.listAlertDeliveries', error, 'Could not load the deliveries needing attention.')
    );
  const rows = (data ?? []).map(fromRow);
  if (!enrichWithMerchantPhone) return rows;

  const { data: merchants } = await supabase
    .from('profiles')
    .select('id, phone')
    .eq('role', 'merchant');

  const phoneById = new Map((merchants ?? []).map((m) => [m.id, m.phone]));
  return rows.map((r) => ({ ...r, merchantPhone: phoneById.get(r.merchantId) ?? '' }));
});

export interface CreateDeliveryInput {
  merchantId: string;
  customer: string;
  recipientName: string;
  recipientPhone: string;
  submittedBy: string;
  pickup: string;
  dropoff: string;
  distance: number;
  durationMin: number;
  type: Delivery['type'];
  itemCategory: string;
  surcharges: string[];
  declaredValue: number;
  itemPayment: Delivery['itemPayment'];
  deliveryPaidBy: Delivery['deliveryPaidBy'];
  /** Written to both `recommended` and `agreed`; there is only one figure now. */
  price: number;
  status: Delivery['status'];
}

export async function createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('deliveries')
    .insert({
      merchant_id: input.merchantId,
      customer: input.customer,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      submitted_by: input.submittedBy,
      pickup: input.pickup,
      dropoff: input.dropoff,
      distance: input.distance,
      duration_min: input.durationMin,
      type: input.type,
      item_category: input.itemCategory,
      surcharges: input.surcharges,
      declared_value: input.declaredValue,
      item_payment: input.itemPayment,
      delivery_paid_by: input.deliveryPaidBy,
      // Both columns get the computed price. `minimum` is left to its database
      // default of 0, meaning no floor was applied.
      recommended: input.price,
      agreed: input.price,
      status: input.status,
    })
    .select('*')
    .single();

  if (error)
    throw new DeliveryError(userMessage('deliveries.createDelivery', error, 'Could not save this delivery. Try again.'));
  return fromRow(data);
}

export interface PatchDeliveryInput {
  status?: Delivery['status'];
  /** undefined = leave alone, '' or null = unassign, otherwise a rider id. */
  riderId?: string | null;
  /**
   * What the caller's screen showed when they acted. With two ops working the
   * same queue, a dropdown can be up to a poll interval stale — anchoring the
   * write to what was on screen turns "both assignments succeed and two riders
   * get messaged" into a refused second write. undefined = don't check (older
   * clients, scripts that only know the target state).
   */
  expectedRiderId?: string | null;
  expectedStatus?: Delivery['status'];
}

/**
 * Status change and/or rider assignment. Ops/admin only — enforced by the RLS
 * UPDATE policy, so a merchant's request affects zero rows and surfaces as
 * "Delivery not found" rather than a silent success.
 *
 * Concurrency: the row is read once, every decision below is made from that
 * snapshot, and the UPDATE at the end refuses to land unless the row still
 * matches it. Two ops racing each other therefore resolve in Postgres — the
 * loser gets a DeliveryConflictError instead of silently overwriting, which
 * matters most for assignment, where "both won" means two riders dispatched.
 */
export async function patchDelivery(
  id: string,
  patch: PatchDeliveryInput
): Promise<DeliveryWithMerchant> {
  const supabase = await createSupabaseServerClient();

  const { data: before, error: readError } = await supabase
    .from('deliveries')
    .select('status, rider_id')
    .eq('id', id)
    .maybeSingle();
  if (readError)
    throw new DeliveryError(userMessage('deliveries.patchDelivery (read)', readError, 'Could not open this delivery.'));
  if (!before) throw new DeliveryError('Delivery not found.');

  const conflict = () =>
    new DeliveryConflictError(
      'This delivery was changed by someone else just now — nothing was saved. Check the refreshed row and try again.'
    );

  // The stale-screen case: the caller acted on a row that had already moved by
  // the time their request arrived. ('' and null both mean "no rider".)
  if (patch.expectedRiderId !== undefined && (patch.expectedRiderId || null) !== before.rider_id) {
    throw conflict();
  }
  if (patch.expectedStatus !== undefined && patch.expectedStatus !== before.status) {
    throw conflict();
  }

  const update: Database['public']['Tables']['deliveries']['Update'] = {};
  if (patch.status) update.status = patch.status;

  // Kept from the snapshot: once the rider column is overwritten there is no way
  // to ask who used to be carrying this, and that rider's availability has to be
  // recomputed or they stay 'On delivery' for a job that is no longer theirs.
  const previousRiderId = before.rider_id;

  if (patch.riderId !== undefined) {
    if (!patch.riderId) {
      Object.assign(update, {
        rider_id: null,
        rider_name: '',
        rider_phone: '',
        rider_reg: '',
        rider_model: '',
        accepted_at: null,
        declined_at: null,
      });

      // A status that only makes sense with a rider attached goes back to the
      // queue. Anything from 'Picked up' on is left alone: the parcel really was
      // collected, and erasing that because ops corrected the rider field would
      // lose the more important fact.
      if (!patch.status) {
        if (
          before.status === 'Pending' ||
          before.status === 'Declined' ||
          before.status === 'Assigned'
        ) {
          update.status = 'Requested';
        }
      }
    } else {
      const { data: rider, error: riderError } = await supabase
        .from('riders')
        .select('*')
        .eq('id', patch.riderId)
        .maybeSingle();
      if (riderError)
        throw new DeliveryError(
          userMessage('deliveries.patchDelivery (rider)', riderError, 'Could not look that rider up.')
        );
      if (!rider) throw new DeliveryError('Unknown rider.');

      // Snapshotted onto the delivery so the record still reads correctly if the
      // rider's details are edited later.
      Object.assign(update, {
        rider_id: rider.id,
        rider_name: rider.name,
        rider_phone: rider.phone,
        rider_reg: rider.reg_number,
        rider_model: rider.model,
      });

      // The previous rider's answer belongs to the previous rider. Clearing both
      // stamps is what makes a reassignment a clean start rather than a job that
      // looks accepted and declined at once.
      Object.assign(update, { accepted_at: null, declined_at: null });

      if (!patch.status) {
        // Offering the job to a rider advances a fresh request, and un-parks one
        // the last rider declined — but never overrides an explicit status sent in
        // the same patch. It stops at 'Pending': only the rider's own acceptance
        // makes a delivery 'Assigned'.
        //
        // 'Approved' belongs here for the same reason 'Requested' does: both are
        // pre-rider states that the log reports as "Assign a rider", so leaving one
        // behind would keep that line in Needs attention for a delivery that
        // already has someone on it.
        if (
          before.status === 'Requested' ||
          before.status === 'Approved' ||
          before.status === 'Declined'
        ) {
          update.status = 'Pending';
        }
      }
    }
  }

  // Anchored to the snapshot: if another request landed between the read above
  // and here, this updates zero rows instead of overwriting it.
  let write = supabase.from('deliveries').update(update).eq('id', id).eq('status', before.status);
  write = previousRiderId === null ? write.is('rider_id', null) : write.eq('rider_id', previousRiderId);
  const { data, error } = await write.select('*').maybeSingle();

  if (error)
    throw new DeliveryError(
      userMessage('deliveries.patchDelivery (write)', error, 'Could not update this delivery. Refresh and try again.')
    );
  if (!data) {
    // Zero rows is either a row that moved underneath us or one the caller
    // cannot see at all — and RLS makes "not yours" and "gone" the same answer.
    const { data: still } = await supabase
      .from('deliveries')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!still) throw new DeliveryError('Delivery not found.');
    throw conflict();
  }

  const delivery = fromRow(data);

  // The rider taken off the job may now be free; the one put on it is only
  // 'Pending' until they accept, so nothing changes for them here. Recomputed from
  // what they are actually carrying rather than assumed, which is what makes
  // swapping a rider mid-delivery come out right.
  if (patch.riderId !== undefined && previousRiderId && previousRiderId !== delivery.riderId) {
    await syncRiderAvailability(supabase, previousRiderId, id);
  }

  const { data: merchant } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}

/**
 * The merchant confirming the rider has collected the item.
 *
 * Runs through the caller's own session, like every other query in this file, so
 * the RLS policies are what authorise it — `deliveries_update_merchant_pickup`
 * for a merchant on their own accepted row, and the existing ops/admin policy for
 * everyone else. A merchant reaching for someone else's delivery updates zero
 * rows; there is no check in this function that could be forgotten, because there
 * is no check in this function.
 *
 * The status filter is not the authorisation — the policy already carries it —
 * but it does make the transition atomic: two taps a second apart cannot both
 * stamp a time.
 */
export async function confirmPickup(deliveryId: string): Promise<DeliveryWithMerchant> {
  const supabase = await createSupabaseServerClient();

  const pickedUpAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('deliveries')
    .update({ status: 'Picked up', picked_up_at: pickedUpAt })
    .eq('id', deliveryId)
    .eq('status', 'Assigned')
    .select('*')
    .maybeSingle();

  if (error)
    throw new DeliveryError(
      userMessage('deliveries.confirmPickup', error, 'Could not confirm pickup. Refresh and try again.')
    );

  if (!updated) {
    // Nothing was updated, and the interesting part is why. A row the caller can
    // read is a status problem; a row they cannot is either someone else's or
    // nonexistent, and those two are deliberately indistinguishable.
    const { data: current } = await supabase
      .from('deliveries')
      .select('status')
      .eq('id', deliveryId)
      .maybeSingle();

    if (!current) throw new DeliveryError('Delivery not found.');
    if (current.status === 'Picked up') {
      // Already done — almost certainly this caller's own double tap, so treat it
      // as success and hand back the row rather than inventing a failure.
      return readDelivery(supabase, deliveryId);
    }
    throw new DeliveryError(
      `Pickup can only be confirmed once the rider has accepted — this delivery is "${current.status}".`
    );
  }

  const delivery = fromRow(updated);
  const { data: merchant } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}

/**
 * One delivery, as the caller's own session is allowed to see it.
 *
 * The RLS SELECT policies are the authorisation, exactly as in listDeliveriesFor:
 * a merchant asking about somebody else's order gets no row, and "not yours" and
 * "does not exist" are deliberately the same answer. That is what lets the notify
 * route load a delivery without a visibility check of its own.
 */
export async function getDeliveryFor(id: string): Promise<DeliveryWithMerchant> {
  return readDelivery(await createSupabaseServerClient(), id);
}

/** One delivery plus the merchant phone, as the patch and pickup paths return it. */
async function readDelivery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<DeliveryWithMerchant> {
  const { data, error } = await supabase.from('deliveries').select('*').eq('id', id).maybeSingle();
  if (error)
    throw new DeliveryError(userMessage('deliveries.readDelivery', error, 'Could not load this delivery.'));
  if (!data) throw new DeliveryError('Delivery not found.');

  const delivery = fromRow(data);
  const { data: merchant } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}
