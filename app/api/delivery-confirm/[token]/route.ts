import { NextResponse } from 'next/server';
import { HttpError, handle } from '@/lib/http';
import { enforceIpRateLimit, enforceRateLimit } from '@/lib/rateLimit';
import { ConfirmationError, confirmDelivery } from '@/lib/deliveryConfirmation';

// A rider taps once, maybe twice if they are unsure it worked. Anything past
// that from one address is not a rider. The per-token limit is the narrower of
// the two: it stops someone with one leaked link from using this endpoint as a
// free write into the database, whatever address they come from.
const PER_IP = { limit: 20, windowSeconds: 300 };
const PER_TOKEN = { limit: 10, windowSeconds: 300 };

/**
 * The rider taps "I've delivered this" and this marks the delivery complete.
 *
 * Deliberately unauthenticated: riders have no portal account. The token in the
 * path is the whole credential, and it buys exactly one thing — completing the
 * one delivery it was issued for. lib/deliveryConfirmation.ts re-checks that the
 * link is live, unspent, and still points at the rider it was issued to.
 *
 * Rate limited by address and by token even though guessing a 256-bit token is
 * not a threat: the limit is there so an open, unauthenticated endpoint cannot
 * be pointed at the database as a load generator.
 *
 * Sits at /api/delivery-confirm rather than under /api/deliveries/[id] because
 * the caller has no delivery id — the token stands in for it, and this keeps the
 * one public path in the API clearly separate from the session-only ones.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;

    await enforceIpRateLimit('confirm-ip', req, PER_IP);
    await enforceRateLimit('confirm-token', token, PER_TOKEN);

    let result;
    try {
      result = await confirmDelivery(token);
    } catch (e) {
      if (e instanceof ConfirmationError) {
        throw new HttpError(500, 'Could not record the confirmation — please call ops.');
      }
      throw e;
    }

    // 'confirmed' covers both a fresh confirmation and a second tap on a link
    // already spent; either way the delivery is complete, which is what the page
    // needs to render. Anything else is a link that cannot be redeemed, and the
    // status code lets the page say why rather than showing a generic failure.
    if (result.state !== 'confirmed') {
      const message =
        result.state === 'expired'
          ? 'This link has expired. Ask ops to send you a new one.'
          : result.state === 'reassigned'
            ? 'This delivery is no longer assigned to you, so it cannot be confirmed here.'
            : 'This link is not valid.';
      throw new HttpError(410, message);
    }

    return NextResponse.json({ confirmedAt: result.confirmedAt });
  });
}
