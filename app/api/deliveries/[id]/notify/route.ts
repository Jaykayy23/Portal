import { NextResponse } from 'next/server';
import { absoluteOrigin, badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { idempotencyKey, withIdempotency } from '@/lib/idempotency';
import { DeliveryError, getDeliveryFor } from '@/lib/deliveries';
import { LinkError, issueLink } from '@/lib/deliveryLinks';
import { getPricingParams } from '@/lib/settings';
import { TwilioError, sendOutbound } from '@/lib/twilio';
import { linkNeededFor, outboundFor, triggerForStatus } from '@/lib/deliveryMessages';
import type { DeliveryWithMerchant, LinkPurpose } from '@/lib/types';

/**
 * Sends this delivery's alerts by SMS, through Twilio.
 *
 * --- the message text is not accepted from the caller ------------------------
 *
 * This is the security property that shapes the whole handler. The request names
 * *which* messages to send — nothing more — and the text is composed here from
 * the delivery row by lib/deliveryMessages.ts, the same function the Notify modal
 * renders from. Taking the body from the browser instead would hand anyone with
 * an ops seat a way to send arbitrary text, from the company's number, to a
 * customer's phone. The one thing a caller can influence is which of the
 * portal's own messages goes out.
 *
 * The capability link is minted here for the same reason. It could have been
 * posted up from the modal, which already has one on screen — and then the URL
 * inside an outgoing SMS would be whatever the browser said it was.
 *
 * --- who may send -----------------------------------------------------------
 *
 * Ops and admin, and the merchant who owns the delivery. The merchant is in the
 * loop because one step of this flow is theirs: they confirm the pickup, and the
 * message telling the recipient it is on the way follows from that. They can
 * already send exactly these words from their own phone through the modal's
 * WhatsApp links — what is new is that it now costs the portal's Twilio credit,
 * which is what the per-user rate limit below is for.
 *
 * Finance is excluded, as it is for minting links: watching the money does not
 * extend to texting riders.
 */

// Sends cost money, so both limits are tighter than the link route's. A delivery
// legitimately needs a handful of messages across its whole life; a browser stuck
// re-posting needs none.
const PER_USER = { limit: 20, windowSeconds: 300 };
const PER_DELIVERY = { limit: 8, windowSeconds: 300 };

/** Anything longer than the longest event's message list is somebody probing. */
const MAX_SELECTED = 10;

interface Body {
  /**
   * OutboundMessage ids to send. Omitted sends every message for the delivery's
   * current step, which is what the modal's "send all" does.
   */
  only?: string[];
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops', 'merchant');
    const { id } = await ctx.params;
    const { only } = await readJson<Body>(req);

    let selected: string[] | null = null;
    if (only !== undefined) {
      if (!Array.isArray(only) || only.some((v) => typeof v !== 'string')) {
        badRequest('`only` must be a list of message ids.');
      }
      if (only.length === 0) badRequest('No messages were selected to send.');
      if (only.length > MAX_SELECTED) badRequest('That is more messages than any one step sends.');
      selected = only;
    }

    await enforceRateLimit('delivery-notify-user', user.id, PER_USER);
    await enforceRateLimit('delivery-notify-delivery', id, PER_DELIVERY);

    // An SMS is the textbook case for this: the money is spent and the handset
    // has it, so a retry after a dropped response is a second message to a
    // customer rather than a second attempt at the first one. The modal sends the
    // same key when it retries.
    //
    // The mint is inside the wrapper along with the send, so a replayed response
    // quotes the link that actually went out rather than a fresh one nobody was
    // sent.
    const sent = await withIdempotency('delivery-notify', user.id, idempotencyKey(req), async () => {
      // RLS decides what this caller can see, so a merchant reaching for someone
      // else's delivery gets the same answer as for one that does not exist.
      let record: DeliveryWithMerchant;
      try {
        record = await getDeliveryFor(id);
      } catch (e) {
        if (e instanceof DeliveryError) notFound(e.message);
        throw e;
      }

      const trigger = triggerForStatus(record);
      const needed = linkNeededFor(trigger);
      const params = await getPricingParams();

      // Not named `ctx`: that is the route's own params argument, and shadowing
      // it here would make this the confusing kind of correct.
      const audience = {
        opsPhone: params.opsPhone,
        merchantPhone: record.merchantPhone || '',
      };

      // Composed twice, and the first pass is not waste. A link is minted only
      // when one of the messages actually being sent carries it — send the ops
      // notice on its own and no rider link is issued — but which messages carry
      // it is a fact about the composed list, and the URL has to be inside the
      // text by the time it is composed for real. So: compose to find out, then
      // mint, then compose the text that goes out. outboundFor() is pure.
      const preview = outboundFor(trigger, record, { ...audience, links: {} });
      const wanted = selected ? preview.filter((m) => selected.includes(m.id)) : preview;
      if (wanted.length === 0) {
        badRequest('Nothing to send — this delivery has no outstanding alerts at that step.');
      }

      // Failing to mint refuses the whole send rather than sending without it. A
      // job offer with no accept/decline link is worse than no message at all:
      // the rider has been told about a job and given no way to answer.
      // The purpose travels with the link so the re-compose below needs no
      // non-null assertion to reach it.
      let link: { purpose: LinkPurpose; url: string; expiresAt: string } | null = null;
      if (needed && wanted.some((m) => m.needsLink === needed)) {
        try {
          const issued = await issueLink(id, needed, user.id);
          link = {
            purpose: needed,
            url: `${absoluteOrigin(req)}/d/${issued.token}`,
            expiresAt: issued.expiresAt,
          };
        } catch (e) {
          if (e instanceof LinkError) badRequest(e.message);
          throw e;
        }
      }

      const messages = link
        ? outboundFor(trigger, record, { ...audience, links: { [link.purpose]: link.url } }).filter((m) =>
            wanted.some((w) => w.id === m.id)
          )
        : wanted;

      try {
        return { trigger, link, results: await sendOutbound(messages) };
      } catch (e) {
        // Thrown only when the portal cannot send at all, which is a 400 the
        // admin can act on rather than a server fault.
        if (e instanceof TwilioError) badRequest(e.message);
        throw e;
      }
    });

    return NextResponse.json(sent);
  });
}
