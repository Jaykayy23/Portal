// The portal telling people things without being asked to.
//
// Every message this file sends was already being sent — composed by
// lib/deliveryMessages.ts, dialled by lib/sms.ts, with a capability link minted
// by lib/deliveryLinks.ts. The only thing that has changed is who decides to
// send: it used to be an ops person pressing a button in a modal that opened
// automatically after every action, and that decision was never really theirs.
// A rider offered a job is always told. A recipient whose parcel has been
// collected is always told. The modal was a prompt with one correct answer, and
// the cost of getting it wrong — a rider sitting on a job offer nobody sent —
// fell on whoever was waiting.
//
// So: the transition fires the alert, and the Notify modal becomes the place you
// go when something did not arrive.
//
// --- three properties this has to have --------------------------------------
//
//   it cannot fail the request     A merchant confirming a pickup must not see
//                                  their confirmation fail because BMS was slow.
//                                  The send runs in after(), past the response,
//                                  and every error is caught and logged.
//   it cannot send twice           Enforced upstream, not here. Each caller
//                                  fires this only when the delivery genuinely
//                                  changed status, and all four of those writes
//                                  are anchored in Postgres so exactly one
//                                  concurrent request wins. See the note on
//                                  delivery_notifications in the migration for
//                                  why a unique index would be worse.
//   it has to leave a record       Nobody is watching an automatic send. What
//                                  went out, to whom, and whether BMS took it
//                                  goes to delivery_notifications, which is what
//                                  the Notify modal reads to show ops that the
//                                  rider was already texted.
//
// Server-only: it reaches the admin client and the BMS credentials.
import 'server-only';

import { after } from 'next/server';
import { createAdminClient } from './supabase/admin';
import { absoluteOrigin } from './http';
import { fromRow } from './deliveries';
import { issueLink } from './deliveryLinks';
import { smsStatus, sendOutbound, type OutboundSendResult } from './sms';
import { toBmsRecipient } from './smsConfig';
import { linkNeededFor, outboundFor, type NotifyTrigger } from './deliveryMessages';
import { logFailure } from './errors';
import type { DeliveryWithMerchant, LinkPurpose, SentAlert } from './types';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Queues this delivery's alerts for a transition that has just happened.
 *
 * Returns whether anything was queued, and that answer is worth the one small
 * read it costs: it is what lets the screen say "job offer sent" instead of
 * opening a modal, and — when SMS is switched off — what tells it to open the
 * modal after all, so a portal with no BMS account behaves exactly as it did
 * before. The client does not have to guess, and it does not have to be told the
 * configuration.
 *
 * Only the check is awaited. The sending itself runs after the response has gone
 * out: three messages at up to fifteen seconds each is not something to hold a
 * merchant's spinner open for, and there is nothing they could do with the
 * result anyway.
 *
 * `req` is read synchronously, here, for the origin the links must carry — the
 * after() callback has no request to read it from.
 */
export async function alertOnTransition(
  deliveryId: string,
  trigger: NotifyTrigger,
  req: Request
): Promise<boolean> {
  // smsStatus() never throws — an app deployed ahead of the SMS migration
  // answers "no", which is the right answer and not a 500 on every status change.
  if (!(await smsStatus()).enabled) return false;

  const origin = absoluteOrigin(req);

  after(async () => {
    try {
      await sendAlerts(deliveryId, trigger, origin);
    } catch (e) {
      // The request is long finished; there is nobody to tell. The log is the
      // whole point of catching this — an uncaught throw in after() is a stack
      // trace with no indication of which delivery it was about.
      logFailure(`autoNotify.${trigger} for delivery ${deliveryId}`, e);
    }
  });

  return true;
}

/**
 * Composes, mints and sends. Not exported: the only way in is above, and it is
 * deliberately not a thing a Route Handler can await.
 */
async function sendAlerts(
  deliveryId: string,
  trigger: NotifyTrigger,
  origin: string
): Promise<void> {
  const admin = createAdminClient();

  const record = await loadDelivery(admin, deliveryId);
  if (!record) return;

  const audience = {
    opsPhone: await loadOpsPhone(admin),
    merchantPhone: record.merchantPhone || '',
  };

  // Composed twice for the same reason the Notify route does it: whether a link
  // is needed is a fact about the composed list, and the URL has to be inside the
  // text by the time it is composed for real. outboundFor() is pure.
  const preview = outboundFor(trigger, record, { ...audience, links: {} });

  // A recipient with no number on file, or an ops number nobody has configured,
  // is dropped before it costs a request — postMessage() would refuse it anyway,
  // and a log row saying so on every delivery is noise, not a record. The modal
  // already shows "no phone number on file" against that contact.
  const reachable = preview.filter((m) => toBmsRecipient(m.phone));
  if (reachable.length === 0) {
    console.warn(
      `[somoexpress] No reachable number for the "${trigger}" alerts on delivery ${deliveryId}.`
    );
    return;
  }

  // The purpose travels with the URL so the re-compose below reaches it without
  // a non-null assertion — same shape the Notify route uses, same reason.
  const needed = linkNeededFor(trigger);
  let link: { purpose: LinkPurpose; url: string } | null = null;
  if (needed && reachable.some((m) => m.needsLink === needed)) {
    try {
      const issued = await issueLink(deliveryId, needed, null);
      link = { purpose: needed, url: `${origin}/d/${issued.token}` };
    } catch (e) {
      // The delivery moved again between the transition and this callback, most
      // likely — issueLink() refuses to mint for a status that has passed. The
      // messages that need the link are dropped and the rest still go: ops
      // hearing "offered to Kofi" is worth more than silence, and a job offer
      // with an empty link in it is worse than no message at all.
      logFailure(`autoNotify.${trigger} link for delivery ${deliveryId}`, e);
    }
  }

  const composed = link
    ? outboundFor(trigger, record, { ...audience, links: { [link.purpose]: link.url } })
    : preview;

  const messages = composed.filter(
    (m) => reachable.some((r) => r.id === m.id) && (!m.needsLink || !!link)
  );
  if (messages.length === 0) return;

  const results = await sendOutbound(messages);
  await recordSends(deliveryId, trigger, results, { automatic: true, sentBy: null });

  // Worth a line even on success: it is the only trace an automatic send leaves
  // outside the database, and "which delivery, how many, did they land" is what
  // anyone reading these logs is trying to answer.
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.warn(
      `[somoexpress] ${failed.length} of ${results.length} "${trigger}" alerts failed for delivery ${deliveryId}.`
    );
  }
}

/**
 * The delivery, read with the admin client rather than the caller's session.
 *
 * Not an oversight and not a shortcut past RLS. Three of the transitions that
 * land here are anonymous — a rider tapping accept, a recipient confirming
 * receipt, a rider closing a job — and there is no session to read the row with.
 * Authorisation happened before the write that caused this: the token was
 * checked, or requireUser() ran, or the RLS UPDATE policy refused. This function
 * only ever runs after a delivery has already legitimately changed.
 *
 * Null when the row has since been deleted, which is not an error worth raising
 * in a callback nobody is reading.
 */
async function loadDelivery(admin: Admin, id: string): Promise<DeliveryWithMerchant | null> {
  const { data, error } = await admin.from('deliveries').select('*').eq('id', id).maybeSingle();
  if (error) {
    logFailure('autoNotify.loadDelivery', error);
    return null;
  }
  if (!data) return null;

  const delivery = fromRow(data);
  const { data: merchant } = await admin
    .from('profiles')
    .select('phone')
    .eq('id', delivery.merchantId)
    .maybeSingle();

  return { ...delivery, merchantPhone: merchant?.phone ?? '' };
}

/**
 * The ops number. Same admin client, same reason — and it is not secret: it is
 * printed in every ops message this portal has ever composed.
 */
async function loadOpsPhone(admin: Admin): Promise<string> {
  const { data, error } = await admin
    .from('pricing_params')
    .select('ops_phone')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    logFailure('autoNotify.loadOpsPhone', error);
    return '';
  }
  return data?.ops_phone ?? '';
}

/**
 * Writes what happened to delivery_notifications.
 *
 * Best-effort by construction: the messages are already gone by the time this
 * runs, and failing to record that would be a worse outcome than not trying.
 * Both the automatic path and the modal's re-send land here, distinguished by
 * `automatic` — which is the first question anyone asks of this table.
 */
export async function recordSends(
  deliveryId: string,
  trigger: NotifyTrigger,
  results: OutboundSendResult[],
  meta: { automatic: boolean; sentBy: string | null }
): Promise<void> {
  if (results.length === 0) return;

  const { error } = await createAdminClient().from('delivery_notifications').insert(
    results.map((r) => ({
      delivery_id: deliveryId,
      event: trigger,
      message_id: r.id,
      who: r.who,
      phone: r.phone,
      automatic: meta.automatic,
      sent_by: meta.sentBy,
      ok: r.ok,
      campaign_id: r.campaignId,
      parts: r.parts,
      error: r.error,
    }))
  );

  if (error) logFailure('autoNotify.recordSends', error);
}

/**
 * What this delivery has already been sent, newest first.
 *
 * Read with the admin client because delivery_notifications is granted to no
 * public role. The caller is responsible for having established that this person
 * may see the delivery at all — the Notify route does it by loading the delivery
 * under RLS first, which is the same check that decides everything else it shows.
 *
 * Fails soft: an app deployed ahead of this migration asks PostgREST for a table
 * that is not there yet, and the honest answer to "what has been sent?" is
 * "nothing recorded", not a 500 on every modal open.
 */
export async function listSentAlerts(deliveryId: string): Promise<SentAlert[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('delivery_notifications')
    .select('message_id, event, who, phone, automatic, ok, parts, error, created_at')
    .eq('delivery_id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logFailure('autoNotify.listSentAlerts', error);
    return [];
  }

  return (data ?? []).map((r) => ({
    messageId: r.message_id,
    event: r.event,
    who: r.who,
    phone: r.phone,
    automatic: r.automatic,
    ok: r.ok,
    parts: r.parts,
    error: r.error,
    sentAt: r.created_at,
  }));
}
