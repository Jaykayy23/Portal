// Rider completion links: minting them for ops, and redeeming them for riders.
//
// The rider is an anonymous visitor holding a token — there is no session to
// read and no RLS predicate that could describe them. So every query here runs
// through the service-role client, exactly like app_settings, and this module is
// the authorisation boundary: the Route Handler checks the caller is ops/admin
// before issuing, and redeeming is deliberately narrow enough that "holds a
// valid token" is sufficient authority for the one thing it does.
//
// Only ever import this from server code. It reaches createAdminClient(), which
// carries a build-time 'server-only' guard, so a Client Component import fails
// the build rather than leaking the secret key.

import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { shortId } from './format';
import type { CompletionSummary, CompletionView } from './types';

export class ConfirmationError extends Error {}

/**
 * How long a link stays live. Three days covers a parcel that goes out on a
 * Friday evening and is signed for on Monday morning, without leaving working
 * links scattered through months of WhatsApp history.
 */
const TOKEN_TTL_HOURS = 72;

/** 32 bytes = 256 bits of entropy. Guessing one is not a threat model. */
const TOKEN_BYTES = 32;

/**
 * Only the hash is stored, so a database dump yields nothing clickable. sha256
 * with no salt or stretching is right here and would not be for a password: the
 * input is full-entropy random, not something a person chose, so there is no
 * dictionary to run against it.
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function summarise(
  delivery: {
    id: string;
    customer: string;
    pickup: string;
    dropoff: string;
    item_category: string;
    rider_name: string;
  },
  riderName: string
): CompletionSummary {
  return {
    orderNo: shortId(delivery.id),
    customer: delivery.customer,
    pickup: delivery.pickup,
    dropoff: delivery.dropoff,
    itemCategory: delivery.item_category ?? '',
    // The link's own snapshot, falling back to the delivery's — they agree
    // except in the moment between a reassignment and the next issued link.
    riderName: riderName || delivery.rider_name,
  };
}

export interface IssuedLink {
  /** The raw token. Returned exactly once — only its hash is kept. */
  token: string;
  expiresAt: string;
}

/**
 * Mints a link for an assigned delivery.
 *
 * Re-opening the Notify modal mints another one rather than reusing the last:
 * the raw token was never stored, so reuse is not possible. Earlier links are
 * left working on purpose — revoking them would break the message ops already
 * sent, and any one of them confirms the same single delivery, so a second tap
 * simply finds the job already done.
 */
export async function issueCompletionLink(
  deliveryId: string,
  issuedBy: string
): Promise<IssuedLink> {
  const admin = createAdminClient();

  const { data: delivery, error } = await admin
    .from('deliveries')
    .select('id, rider_id, rider_name, rider_phone, delivered_at')
    .eq('id', deliveryId)
    .maybeSingle();

  if (error) throw new ConfirmationError(error.message);
  if (!delivery) throw new ConfirmationError('Delivery not found.');
  if (!delivery.rider_id) {
    throw new ConfirmationError('Assign a rider before creating a completion link.');
  }
  // Refusing here is what keeps delivered_at meaning "when it was delivered": a
  // second link redeemed a day later would quietly re-stamp a finished job.
  // Ops correcting a mistaken confirmation do it in the log, not by re-issuing.
  if (delivery.delivered_at) {
    throw new ConfirmationError('This delivery has already been confirmed by the rider.');
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000).toISOString();

  const { error: insertError } = await admin.from('delivery_confirmations').insert({
    delivery_id: delivery.id,
    token_hash: hashToken(token),
    rider_id: delivery.rider_id,
    rider_name: delivery.rider_name,
    rider_phone: delivery.rider_phone,
    issued_by: issuedBy,
    expires_at: expiresAt,
  });

  if (insertError) throw new ConfirmationError(insertError.message);
  return { token, expiresAt };
}

const INVALID: CompletionView = { state: 'invalid', summary: null, confirmedAt: '' };

/**
 * What the token is worth right now, without changing anything.
 *
 * An unknown token is told only that it is unknown — no order number, no
 * addresses. Every other state carries the summary, because at that point the
 * holder has already proved they were given a real link.
 */
export async function loadConfirmation(token: string): Promise<CompletionView> {
  if (!token) return INVALID;
  const admin = createAdminClient();

  const { data: link, error } = await admin
    .from('delivery_confirmations')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (error) throw new ConfirmationError(error.message);
  if (!link) return INVALID;

  const { data: delivery, error: deliveryError } = await admin
    .from('deliveries')
    .select('id, customer, pickup, dropoff, item_category, rider_id, rider_name')
    .eq('id', link.delivery_id)
    .maybeSingle();

  if (deliveryError) throw new ConfirmationError(deliveryError.message);
  if (!delivery) return INVALID;

  const summary = summarise(delivery, link.rider_name);

  // Confirmed wins over both checks below: once the job is done, a rider
  // re-opening the message they were sent should read "already confirmed",
  // never "expired" or "reassigned".
  if (link.confirmed_at) {
    return { state: 'confirmed', summary, confirmedAt: link.confirmed_at };
  }
  // The delivery moved to someone else, so this link is answering for a job its
  // holder is no longer carrying.
  if (delivery.rider_id !== link.rider_id) {
    return { state: 'reassigned', summary, confirmedAt: '' };
  }
  if (Date.parse(link.expires_at) <= Date.now()) {
    return { state: 'expired', summary, confirmedAt: '' };
  }
  return { state: 'pending', summary, confirmedAt: '' };
}

/**
 * Redeems the link: marks the delivery Delivered and stamps the moment.
 *
 * Idempotent by construction. The UPDATE that claims the link filters on
 * `confirmed_at is null`, so two taps a second apart race in Postgres rather
 * than in Node — the loser claims no row and is handed the winner's result
 * instead of writing a second, later timestamp over it.
 */
export async function confirmDelivery(token: string): Promise<CompletionView> {
  const current = await loadConfirmation(token);
  if (current.state !== 'pending') return current;

  const admin = createAdminClient();
  const confirmedAt = new Date().toISOString();

  const { data: claimed, error } = await admin
    .from('delivery_confirmations')
    .update({ confirmed_at: confirmedAt })
    .eq('token_hash', hashToken(token))
    .is('confirmed_at', null)
    .select('delivery_id, confirmed_at')
    .maybeSingle();

  if (error) throw new ConfirmationError(error.message);
  // Someone else got there first — re-read rather than reporting a second time.
  if (!claimed) return loadConfirmation(token);

  const { error: deliveryError } = await admin
    .from('deliveries')
    .update({ status: 'Delivered', delivered_at: confirmedAt })
    .eq('id', claimed.delivery_id);

  // The link is already spent at this point, so failing here would leave the log
  // saying Assigned with no way to retry. Surfacing it as an error tells the
  // rider to call ops, which is the only useful thing they can do.
  if (deliveryError) throw new ConfirmationError(deliveryError.message);

  return { ...current, state: 'confirmed', confirmedAt };
}
