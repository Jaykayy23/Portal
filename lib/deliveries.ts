// Delivery queries.
//
// Merchant isolation is now enforced by RLS (see supabase/migrations). These
// queries no longer filter by merchant themselves — Postgres does it. The
// explicit ops/admin branch below exists only to decide whether to *enrich* rows
// with the merchant's phone number, not to decide who sees what.

import { createSupabaseServerClient } from './supabase/server';
import { isOpsOrAdmin, type Delivery, type DeliveryWithMerchant, type SessionUser } from './types';
import type { Database } from './database.types';

type DeliveryRow = Database['public']['Tables']['deliveries']['Row'];

export class DeliveryError extends Error {}

export function fromRow(r: DeliveryRow): Delivery {
  return {
    id: r.id,
    date: r.created_at,
    customer: r.customer,
    merchantId: r.merchant_id,
    submittedBy: r.submitted_by,
    pickup: r.pickup,
    dropoff: r.dropoff,
    distance: Number(r.distance),
    type: r.type,
    surcharges: r.surcharges ?? [],
    declaredValue: Number(r.declared_value),
    recommended: Number(r.recommended),
    minimum: Number(r.minimum),
    agreed: Number(r.agreed),
    status: r.status,
    riderId: r.rider_id ?? '',
    riderName: r.rider_name,
    riderPhone: r.rider_phone,
    riderReg: r.rider_reg,
    riderModel: r.rider_model,
  };
}

/**
 * Newest first. A merchant receives only their own rows because the RLS SELECT
 * policy allows nothing else — not because of anything in this function.
 *
 * For ops/admin each row is enriched with the merchant's phone for the Notify
 * action. That's done with one extra query over the merchant profiles rather than
 * a lookup per row.
 */
export async function listDeliveriesFor(user: SessionUser): Promise<DeliveryWithMerchant[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new DeliveryError(error.message);
  const rows = (data ?? []).map(fromRow);

  if (!isOpsOrAdmin(user)) return rows;

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
  submittedBy: string;
  pickup: string;
  dropoff: string;
  distance: number;
  type: Delivery['type'];
  surcharges: string[];
  declaredValue: number;
  recommended: number;
  minimum: number;
  agreed: number;
  status: Delivery['status'];
}

export async function createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('deliveries')
    .insert({
      merchant_id: input.merchantId,
      customer: input.customer,
      submitted_by: input.submittedBy,
      pickup: input.pickup,
      dropoff: input.dropoff,
      distance: input.distance,
      type: input.type,
      surcharges: input.surcharges,
      declared_value: input.declaredValue,
      recommended: input.recommended,
      minimum: input.minimum,
      agreed: input.agreed,
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

  if (patch.riderId !== undefined) {
    if (!patch.riderId) {
      Object.assign(update, {
        rider_id: null,
        rider_name: '',
        rider_phone: '',
        rider_reg: '',
        rider_model: '',
      });
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

      if (!patch.status) {
        const { data: current } = await supabase
          .from('deliveries')
          .select('status')
          .eq('id', id)
          .maybeSingle();
        // Assigning a rider advances a fresh request, but never overrides an
        // explicit status sent in the same patch.
        if (current?.status === 'Requested') update.status = 'Assigned';
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
  const { data: merchant } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}
