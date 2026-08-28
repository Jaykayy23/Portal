import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { DeliveryError, confirmPickup } from '@/lib/deliveries';
import { alertOnTransition } from '@/lib/autoNotify';
import { logActivity } from '@/lib/activity';
import { orderNo } from '@/lib/format';

const PER_USER = { limit: 30, windowSeconds: 300 };

/**
 * The merchant confirming the rider has collected the item.
 *
 * Its own route rather than a status in PATCH /api/deliveries/[id], because that
 * handler is ops/admin only — by design, so a merchant cannot edit a request they
 * filed. This single transition is the merchant's to make: they are the person
 * physically handing the parcel over.
 *
 * The role list here only rules out the roles that can never do this at all —
 * finance holds no UPDATE policy on deliveries. Which delivery the rest may move,
 * and what they may change on it, is decided by the RLS policy
 * `deliveries_update_merchant_pickup` and the column guard beside it — see
 * supabase/migrations. A merchant aiming this at another merchant's order updates
 * nothing.
 *
 * Idempotent without a key: the update filters on the delivery still being
 * 'Assigned', so a second tap finds nothing to change and returns the same row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops', 'merchant');
    const { id } = await ctx.params;
    await enforceRateLimit('delivery-pickup', user.id, PER_USER);

    try {
      const { delivery, moved } = await confirmPickup(id);

      // Only the call that actually moved it. A double tap is one pickup.
      if (moved) {
        logActivity({
          actor: user,
          action: 'delivery.pickup_confirmed',
          entityType: 'delivery',
          entityId: delivery.id,
          entityLabel: orderNo(delivery.id),
          details: { rider: delivery.riderName },
        });
      }

      // The recipient's "it is on the way" message, with their confirmation link
      // in it, is the whole reason this transition exists — so it goes out here
      // rather than waiting for the merchant to notice a modal. `moved` is what
      // keeps a double tap from texting them twice: the second call finds the
      // delivery already 'Picked up' and announces nothing.
      const alertsSent = moved ? await alertOnTransition(id, 'picked-up', req) : false;

      return NextResponse.json({ delivery, alertsSent });
    } catch (e) {
      if (e instanceof DeliveryError) badRequest(e.message);
      throw e;
    }
  });
}
