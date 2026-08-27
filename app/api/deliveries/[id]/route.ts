import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { DeliveryConflictError, DeliveryError, patchDelivery } from '@/lib/deliveries';
import { TRIGGER_ON_ENTERING } from '@/lib/deliveryMessages';
import { alertOnTransition } from '@/lib/autoNotify';
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
      const { delivery, previousStatus } = await patchDelivery(id, {
        status,
        riderId,
        expectedRiderId,
        expectedStatus,
      });

      // The alert follows the transition, not the request. Assigning a rider to a
      // delivery that is already Pending — correcting a typo, swapping the phone
      // number on the row — moves nothing and announces nothing; putting a rider
      // on a fresh request moves it to Pending and sends them the job offer.
      //
      // This is also where sending exactly once is decided. patchDelivery's write
      // is anchored to `previousStatus`, so out of any number of ops racing the
      // same queue, exactly one request sees a change here.
      const trigger =
        delivery.status !== previousStatus ? TRIGGER_ON_ENTERING[delivery.status] : undefined;
      const alertsSent = trigger ? await alertOnTransition(id, trigger, req) : false;

      return NextResponse.json({ delivery, alertsSent });
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
