import { NextResponse } from 'next/server';
import { absoluteOrigin, badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { ConfirmationError, issueCompletionLink } from '@/lib/deliveryConfirmation';

// Every call writes a row, so an ops browser stuck in a loop — a modal
// re-mounting, a script left running — would fill the table. The per-delivery
// limit is the tighter one because a single order legitimately needs one link,
// or a few if ops re-sends the message.
const PER_USER = { limit: 40, windowSeconds: 300 };
const PER_DELIVERY = { limit: 10, windowSeconds: 300 };

/**
 * Mints the rider's completion link. Ops/admin only.
 *
 * POST, not GET, because it writes: every call is a new token. The Notify modal
 * calls it when it opens for an assigned delivery, so the link is already in the
 * message ops is about to send.
 *
 * The full URL is built here rather than in the browser, so the address a rider
 * receives is the deployment's public one — not whatever host the ops laptop
 * happens to be reaching the portal on.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops');
    const { id } = await ctx.params;

    await enforceRateLimit('completion-link-user', user.id, PER_USER);
    await enforceRateLimit('completion-link-delivery', id, PER_DELIVERY);

    try {
      const { token, expiresAt } = await issueCompletionLink(id, user.id);
      return NextResponse.json({ url: `${absoluteOrigin(req)}/d/${token}`, expiresAt });
    } catch (e) {
      if (e instanceof ConfirmationError) badRequest(e.message);
      throw e;
    }
  });
}
