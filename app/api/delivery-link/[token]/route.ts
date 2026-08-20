import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle } from '@/lib/http';
import { enforceIpRateLimit, enforceRateLimit } from '@/lib/rateLimit';
import { LinkError, redeemLink } from '@/lib/deliveryLinks';
import type { LinkAction } from '@/lib/types';

// A rider or customer taps once, maybe twice if unsure it worked. Anything past
// that from one address is not a person with a parcel. The per-token limit is the
// narrower of the two: it stops someone holding one leaked link from using this
// endpoint as a free write into the database, whatever address they come from.
const PER_IP = { limit: 20, windowSeconds: 300 };
const PER_TOKEN = { limit: 10, windowSeconds: 300 };

const ACTIONS: LinkAction[] = ['accept', 'decline', 'confirm'];

interface Body {
  action?: LinkAction;
}

/**
 * The one public write in the API: a rider accepting or declining a job, a
 * customer confirming receipt, or a rider closing a delivery out.
 *
 * Deliberately unauthenticated — riders and customers have no portal account.
 * The token in the path is the whole credential, and it buys exactly one status
 * change on exactly one delivery. lib/deliveryLinks.ts re-checks that the link
 * is live, unspent, still points at the rider it was issued to, and that the
 * delivery is still at the stage the link asks about.
 *
 * Rate limited by address and by token even though guessing a 256-bit token is
 * not a threat: the limit is there so an open endpoint cannot be pointed at the
 * database as a load generator.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;
    const { action } = (await req.json().catch(() => ({}))) as Body;

    if (!action || !ACTIONS.includes(action)) {
      badRequest(`Unknown action. Expected one of: ${ACTIONS.join(', ')}.`);
    }

    await enforceIpRateLimit('link-redeem-ip', req, PER_IP);
    await enforceRateLimit('link-redeem-token', token, PER_TOKEN);

    let result;
    try {
      result = await redeemLink(token, action);
    } catch (e) {
      if (e instanceof LinkError) {
        // The link was already spent by the time the delivery update ran, so the
        // only honest thing is to say it did not land and who to call.
        throw new HttpError(500, 'Could not record that — please call the ops team.');
      }
      throw e;
    }

    // 'used' covers both a fresh answer and a second tap on a spent link; either
    // way the delivery is where the holder expects it, which is what the page
    // needs to render. Anything else is a link that cannot be redeemed, and the
    // status code lets the page say why rather than showing a generic failure.
    if (result.state !== 'used') {
      const message =
        result.state === 'expired'
          ? 'This link has expired. Please call the ops team for a new one.'
          : result.state === 'reassigned'
            ? 'This delivery is no longer assigned to you.'
            : result.state === 'superseded'
              ? 'This delivery has already moved on — nothing to do here.'
              : 'This link is not valid.';
      throw new HttpError(410, message);
    }

    return NextResponse.json({ outcome: result.outcome, usedAt: result.usedAt });
  });
}
