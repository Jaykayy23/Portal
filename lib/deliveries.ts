// Delivery queries.
//
// Merchant isolation is now enforced by RLS (see supabase/migrations). These
// queries no longer filter by merchant themselves — Postgres does it. The
// explicit role branch below exists only to decide whether to *enrich* rows with
// the merchant's phone number, not to decide who sees what.

import { createSupabaseServerClient } from './supabase/server';
import { syncRiderAvailability } from './riderAvailability';
import { seesAllMerchants, type Delivery, type DeliveryWithMerchant, type SessionUser } from './types';
import type { Database } from './database.types';

type DeliveryRow = Database['public']['Tables']['deliveries']['Row'];

export class DeliveryError extends Error {}

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
 */
export async function listDeliveriesFor(user: SessionUser): Promise<DeliveryWithMerchant[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new DeliveryError(error.message);
  const rows = (data ?? []).map(fromRow);

  if (!seesAllMerchants(user)) return rows;

  const { data: merchants } = await supabase
    .from('profiles')
    .select('id, phone')
    .eq('role', 'merchant');

  const phoneById = new Map((merchants ?? []).map((m) => [m.id, m.phone]));
  return rows.map((r) => ({ ...r, merchantPhone: phoneById.get(r.merchantId) ?? '' }));
}

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

  if (error) throw new DeliveryError(error.message);
  return fromRow(data);
}

export interface PatchDeliveryInput {
  status?: Delivery['status'];
  /** undefined = leave alone, '' or null = unassign, otherwise a rider id. */
  riderId?: string | null;
}

/**
 * Status change and/or rider assignment. Ops/admin only — enforced by the RLS
 * UPDATE policy, so a merchant's request affects zero rows and surfaces as
 * "Delivery not found" rather than a silent success.
 */
export async function patchDelivery(
  id: string,
  patch: PatchDeliveryInput
): Promise<DeliveryWithMerchant> {
  const supabase = await createSupabaseServerClient();

  const update: Database['public']['Tables']['deliveries']['Update'] = {};
  if (patch.status) update.status = patch.status;

  // Read before writing: once the rider column is overwritten there is no way to
  // ask who used to be carrying this, and that rider's availability has to be
  // recomputed or they stay 'On delivery' for a job that is no longer theirs.
  let previousRiderId: string | null = null;
  if (patch.riderId !== undefined) {
    const { data: before } = await supabase
      .from('deliveries')
      .select('rider_id')
      .eq('id', id)
      .maybeSingle();
    previousRiderId = before?.rider_id ?? null;
  }

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
        const { data: current } = await supabase
          .from('deliveries')
          .select('status')
          .eq('id', id)
          .maybeSingle();
        if (
          current?.status === 'Pending' ||
          current?.status === 'Declined' ||
          current?.status === 'Assigned'
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
      if (riderError) throw new DeliveryError(riderError.message);
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
        const { data: current } = await supabase
          .from('deliveries')
          .select('status')
          .eq('id', id)
          .maybeSingle();
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
          current?.status === 'Requested' ||
          current?.status === 'Approved' ||
          current?.status === 'Declined'
        ) {
          update.status = 'Pending';
        }
      }
    }
  }

  const { data, error } = await supabase
    .from('deliveries')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw new DeliveryError(error.message);
  if (!data) throw new DeliveryError('Delivery not found.');

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

  if (error) throw new DeliveryError(error.message);

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

/** One delivery plus the merchant phone, as the patch and pickup paths return it. */
async function readDelivery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<DeliveryWithMerchant> {
  const { data, error } = await supabase.from('deliveries').select('*').eq('id', id).maybeSingle();
  if (error) throw new DeliveryError(error.message);
  if (!data) throw new DeliveryError('Delivery not found.');

  const delivery = fromRow(data);
  const { data: merchant } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}
