import { NextResponse } from 'next/server';
import { absoluteOrigin, badRequest, handle, notFound, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { LinkError, issueLink } from '@/lib/deliveryLinks';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity';
import { shortId } from '@/lib/format';
import { LINK_PURPOSES, isOpsOrAdmin, type LinkPurpose } from '@/lib/types';

// Every call writes a row, so a browser stuck in a loop — a modal re-mounting, a
// script left running — would fill the table. The per-delivery limit is the
// tighter one: one delivery legitimately needs a handful of links across its
// whole life, not forty.
const PER_USER = { limit: 40, windowSeconds: 300 };
const PER_DELIVERY = { limit: 10, windowSeconds: 300 };

interface Body {
  purpose?: LinkPurpose;
}

/**
 * Mints one of the three capability links for a delivery.
 *
 * Who may mint: ops and admin for any delivery, and the merchant who owns it.
 * The merchant is in the loop because they are the one who confirms pickup and
 * then sends the recipient their confirmation link — that message comes from the
 * merchant, not from ops.
 *
 * Finance is excluded here rather than by a policy, and this is the one place
 * that matters: minting writes through the service-role client, so the read
 * below — which finance *can* satisfy, since it sees every delivery — would
 * otherwise be the only gate. Watching the money does not extend to issuing
 * capability links to riders.
 *
 * What may be minted is decided by the delivery's status, in issueLink(), not
 * here: a rider-response link only exists while a delivery is Pending, and so
 * on. That check is what stops a link asking a question the delivery has already
 * moved past.
 *
 * POST, not GET, because it writes: every call is a new token. The full URL is
 * built here rather than in the browser, so the address that reaches a rider or
 * a customer is the deployment's public one — not whatever host the ops laptop
 * happens to be on.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops', 'merchant');
    const { id } = await ctx.params;
    const { purpose } = (await req.json().catch(() => ({}))) as Body;

    if (!purpose || !LINK_PURPOSES.includes(purpose)) {
      badRequest(`Unknown link purpose. Expected one of: ${LINK_PURPOSES.join(', ')}.`);
    }

    await enforceRateLimit('delivery-link-user', user.id, PER_USER);
    await enforceRateLimit('delivery-link-delivery', id, PER_DELIVERY);

    // issueLink() writes with the service client — delivery_links is granted to
    // no public role — so the RLS SELECT policy is not otherwise in this path.
    // Reading the delivery through the caller's own session puts it back: a
    // merchant asking about someone else's order gets no row, and the answer is
    // the same as for an order that does not exist, so ids cannot be probed.
    if (!isOpsOrAdmin(user)) {
      const supabase = await createSupabaseServerClient();
      const { data: visible } = await supabase
        .from('deliveries')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (!visible) notFound('Delivery not found.');
    }

    try {
      const { token, expiresAt } = await issueLink(id, purpose, user.id);

      // The token itself is never recorded — it is the whole credential, and a
      // capability sitting in an audit table is a capability. What the log needs
      // is that somebody minted one, for which delivery, and of what kind.
      logActivity({
        actor: user,
        action: 'delivery.link_issued',
        entityType: 'delivery',
        entityId: id,
        entityLabel: `#${shortId(id)}`,
        details: { purpose, expiresAt },
      });

      return NextResponse.json({
        purpose,
        url: `${absoluteOrigin(req)}/d/${token}`,
        expiresAt,
      });
    } catch (e) {
      if (e instanceof LinkError) badRequest(e.message);
      throw e;
    }
  });
}
