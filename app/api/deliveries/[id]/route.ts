import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { DeliveryConflictError, DeliveryError, patchDelivery } from '@/lib/deliveries';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/lib/types';

interface PatchBody {
  status?: DeliveryStatus;
  /** Empty string or null clears the assignment. */
  riderId?: string | null;
  /**
   * What the caller's screen showed when they acted — the write is refused with
   * a 409 if the row no longer matches, so two ops working the same stale queue
   * cannot both "successfully" assign the same delivery. Optional: a caller that
   * omits them still gets the in-flight guard inside patchDelivery.
   */
  expectedRiderId?: string | null;
  expectedStatus?: DeliveryStatus;
}

// Status changes and rider assignment. Ops/admin only — checked here for a clean
// 403, and enforced again by the RLS UPDATE policy.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status, riderId, expectedRiderId, expectedStatus } = await readJson<PatchBody>(req);

    if (status !== undefined && !DELIVERY_STATUSES.includes(status)) {
      badRequest(`Invalid status. Expected one of: ${DELIVERY_STATUSES.join(', ')}.`);
    }
    if (expectedStatus !== undefined && !DELIVERY_STATUSES.includes(expectedStatus)) {
      badRequest(`Invalid expectedStatus. Expected one of: ${DELIVERY_STATUSES.join(', ')}.`);
    }
    if (status === undefined && riderId === undefined) {
      badRequest('Nothing to update.');
    }

    try {
      return NextResponse.json({
        delivery: await patchDelivery(id, { status, riderId, expectedRiderId, expectedStatus }),
      });
    } catch (e) {
      if (e instanceof DeliveryConflictError) throw new HttpError(409, e.message);
      if (e instanceof DeliveryError) {
        if (e.message === 'Unknown rider.') badRequest(e.message);
        notFound(e.message);
      }
      throw e;
    }
  });
}
