import { NextResponse } from 'next/server';
import { HttpError, handle } from '@/lib/http';
import { ConfirmationError, confirmDelivery } from '@/lib/deliveryConfirmation';

/**
 * The rider taps "I've delivered this" and this marks the delivery complete.
 *
 * Deliberately unauthenticated: riders have no portal account. The token in the
 * path is the whole credential, and it buys exactly one thing — completing the
 * one delivery it was issued for. lib/deliveryConfirmation.ts re-checks that the
 * link is live, unspent, and still points at the rider it was issued to.
 *
 * No rate limit, on purpose: there is nothing to brute-force. A token is 256
 * random bits, and a wrong one reveals only that it is wrong.
 *
 * Sits at /api/delivery-confirm rather than under /api/deliveries/[id] because
 * the caller has no delivery id — the token stands in for it, and this keeps the
 * one public path in the API clearly separate from the session-only ones.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;

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
