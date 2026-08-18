import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { DeliveryError, patchDelivery } from '@/lib/deliveries';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/lib/types';

interface PatchBody {
  status?: DeliveryStatus;
  /** Empty string or null clears the assignment. */
  riderId?: string | null;
}

// Status changes and rider assignment. Ops/admin only — checked here for a clean
// 403, and enforced again by the RLS UPDATE policy.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status, riderId } = await readJson<PatchBody>(req);

    if (status !== undefined && !DELIVERY_STATUSES.includes(status)) {
      badRequest(`Invalid status. Expected one of: ${DELIVERY_STATUSES.join(', ')}.`);
    }
    if (status === undefined && riderId === undefined) {
      badRequest('Nothing to update.');
    }

    try {
      return NextResponse.json({ delivery: await patchDelivery(id, { status, riderId }) });
    } catch (e) {
      if (e instanceof DeliveryError) {
        if (e.message === 'Unknown rider.') badRequest(e.message);
        notFound(e.message);
      }
      throw e;
    }
  });
}
