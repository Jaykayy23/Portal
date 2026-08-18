import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import { findMerchantPhone } from '@/lib/deliveries';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/lib/types';

interface PatchBody {
  status?: DeliveryStatus;
  /** Empty string or null clears the assignment. */
  riderId?: string | null;
}

// Status changes and rider assignment. Ops/admin only — a merchant can file a
// request but never move it along.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status, riderId } = await readJson<PatchBody>(req);

    if (status !== undefined && !DELIVERY_STATUSES.includes(status)) {
      badRequest(`Invalid status. Expected one of: ${DELIVERY_STATUSES.join(', ')}.`);
    }
    // Checked before the write so an unknown rider is a 400 rather than a
    // silently half-applied patch.
    if (riderId && !getDb().riders[riderId]) badRequest('Unknown rider.');

    const updated = await updateDb((d) => {
      const record = d.deliveries[id];
      if (!record) return null;

      if (status) record.status = status;

      if (riderId !== undefined) {
        if (!riderId) {
          Object.assign(record, {
            riderId: '',
            riderName: '',
            riderPhone: '',
            riderReg: '',
            riderModel: '',
          });
        } else {
          const rider = d.riders[riderId];
          if (!rider) return null;
          Object.assign(record, {
            riderId: rider.id,
            riderName: rider.name,
            riderPhone: rider.phone,
            riderReg: rider.regNumber,
            riderModel: rider.model,
          });
          // Assigning a rider advances a fresh request automatically, but never
          // overrides an explicit status sent in the same patch.
          if (!status && record.status === 'Requested') record.status = 'Assigned';
        }
      }

      return { ...record, merchantPhone: findMerchantPhone(d, record.customer) };
    });
    if (!updated) notFound('Delivery not found.');

    return NextResponse.json({ delivery: updated });
  });
}
