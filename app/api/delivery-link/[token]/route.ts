import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle } from '@/lib/http';
import { enforceIpRateLimit, enforceRateLimit } from '@/lib/rateLimit';
import { LinkError, redeemLink } from '@/lib/deliveryLinks';
import { TRIGGER_ON_ENTERING } from '@/lib/deliveryMessages';
import { alertOnTransition } from '@/lib/autoNotify';
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

    const { view, redeemed } = result;

    // 'used' covers both a fresh answer and a second tap on a spent link; either
    // way the delivery is where the holder expects it, which is what the page
    // needs to render. Anything else is a link that cannot be redeemed, and the
    // status code lets the page say why rather than showing a generic failure.
    if (view.state !== 'used') {
      const message =
        view.state === 'expired'
          ? 'This link has expired. Please call the ops team for a new one.'
          : view.state === 'reassigned'
            ? 'This delivery is no longer assigned to you.'
            : view.state === 'superseded'
              ? 'This delivery has already moved on — nothing to do here.'
              : 'This link is not valid.';
      throw new HttpError(410, message);
    }

    // Half of this portal's alerts start here, at a tap from someone with no
    // account: a rider accepting a job is what tells the merchant who is coming,
    // and a recipient confirming receipt is what sends the rider the link that
    // closes the job out. Nobody was ever going to open a modal for these — until
    // now they waited for ops to notice the row had moved.
    //
    // Fired only for the tap that actually redeemed the link. Riders refresh
    // these pages; `redeemed` is what keeps a refresh from being a second text.
    // The status the link redeems into is known from its purpose and outcome, so
    // there is no need to re-read the delivery to find out what to announce.
    if (redeemed) {
      const trigger = TRIGGER_ON_ENTERING[redeemed.status];
      // Nothing is reported back to the caller. The holder is a rider at a gate
      // or a customer at their door; the alert is about them, not for them, and
      // whether it went is not their problem to see.
      if (trigger) await alertOnTransition(redeemed.deliveryId, trigger, req);
    }

    return NextResponse.json({ outcome: view.outcome, usedAt: view.usedAt });
  });
}
