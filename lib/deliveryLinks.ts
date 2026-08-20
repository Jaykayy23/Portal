// Capability links: minting them for whoever is dispatching, and redeeming them
// for riders and recipients.
//
// Three questions, one mechanism. A rider accepting a job, a customer confirming
// receipt and a rider closing a delivery are all "someone with no portal account
// answers one question about one delivery from their phone", so they share the
// table, the token shape, the expiry and the redemption path. Only `purpose`
// differs, and that decides which question the public page asks.
//
// Holders are anonymous — there is no session to read and no RLS predicate that
// could describe them — so every query here runs through the service-role
// client, exactly like app_settings, and this module is the authorisation
// boundary. The Route Handler checks who may mint; redeeming is narrow enough
// that "holds a live token" is sufficient authority for the one status change it
// can cause.
//
// Only ever import this from server code. It reaches createAdminClient(), which
// carries a build-time 'server-only' guard, so a Client Component import fails
// the build rather than leaking the secret key.

import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { syncRiderAvailability } from './riderAvailability';
import { shortId } from './format';
import type { Database } from './database.types';
import {
  PURPOSE_REQUIRES_STATUS,
  type AmountsDue,
  type LinkSummary,
  type DeliveryStatus,
  type LinkAction,
  type LinkOutcome,
  type LinkPurpose,
  type LinkView,
} from './types';

export class LinkError extends Error {}

/**
 * How long a link stays live. Three days covers a parcel that goes out on a
 * Friday evening and is signed for on Monday morning, without leaving working
 * links scattered through months of WhatsApp history.
 */
const TOKEN_TTL_HOURS = 72;

/** 32 bytes = 256 bits of entropy. Guessing one is not a threat model. */
const TOKEN_BYTES = 32;

/** What each action means, and what it does to the delivery when taken. */
const ACTION_OUTCOME: Record<LinkAction, LinkOutcome> = {
  accept: 'accepted',
  decline: 'declined',
  confirm: 'confirmed',
};

/** Which actions a link of each purpose will accept. */
const PURPOSE_ACTIONS: Record<LinkPurpose, LinkAction[]> = {
  'rider-response': ['accept', 'decline'],
  'recipient-confirm': ['confirm'],
  'rider-complete': ['confirm'],
};

/**
 * The status a delivery moves to for each (purpose, outcome) pair.
 *
 * A decline is the only redemption that does not move the delivery forward — it
 * parks it in ops' queue with the rider still named, so the log says who refused
 * it rather than silently reverting to unassigned.
 */
const RESULTING_STATUS: Record<string, DeliveryStatus> = {
  'rider-response:accepted': 'Assigned',
  'rider-response:declined': 'Declined',
  'recipient-confirm:confirmed': 'Recipient confirmed',
  'rider-complete:confirmed': 'Delivered',
};

/**
 * The delivery column stamped by each redemption. Typed as the union of the
 * milestone columns rather than plain string, so a typo here is a build error
 * instead of an update that silently writes nothing.
 */
type MilestoneColumn = 'accepted_at' | 'declined_at' | 'recipient_confirmed_at' | 'delivered_at';

const RESULTING_TIMESTAMP: Record<string, MilestoneColumn> = {
  'rider-response:accepted': 'accepted_at',
  'rider-response:declined': 'declined_at',
  'recipient-confirm:confirmed': 'recipient_confirmed_at',
  'rider-complete:confirmed': 'delivered_at',
};

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
    recipient_name: string;
    item_payment: string;
    delivery_paid_by: string;
    declared_value: number | string;
    agreed: number | string;
  },
  riderName: string
): LinkSummary {
  // The rider collects exactly what the recipient owes, so one calculation serves
  // both audiences — only the wording on the page differs.
  const due: AmountsDue = {
    itemCash: delivery.item_payment === 'Cash on delivery' ? Number(delivery.declared_value) : 0,
    deliveryFee: delivery.delivery_paid_by === 'Customer' ? Number(delivery.agreed) : 0,
  };

  return {
    orderNo: shortId(delivery.id),
    customer: delivery.customer,
    pickup: delivery.pickup,
    dropoff: delivery.dropoff,
    itemCategory: delivery.item_category ?? '',
    // The link's own snapshot, falling back to the delivery's — they agree
    // except in the moment between a reassignment and the next issued link.
    riderName: riderName || delivery.rider_name,
    recipientName: delivery.recipient_name ?? '',
    due,
  };
}

export interface IssuedLink {
  /** The raw token. Returned exactly once — only its hash is kept. */
  token: string;
  purpose: LinkPurpose;
  expiresAt: string;
}

/**
 * Mints a link, if the delivery is at the stage that link is for.
 *
 * The status check is the important part: a rider-response link is only worth
 * minting while the delivery is Pending, so ops cannot accidentally send a
 * rider an accept/decline link for a job they already accepted, and nobody can
 * mint a completion link for a parcel that has not been picked up yet.
 *
 * Re-minting for the same purpose is allowed and mints a new token: the raw
 * value was never stored, so reuse is impossible. Earlier links for the same
 * purpose keep working — revoking them would break the message already sent, and
 * they all ask the same question about the same delivery.
 */
export async function issueLink(
  deliveryId: string,
  purpose: LinkPurpose,
  issuedBy: string
): Promise<IssuedLink> {
  const admin = createAdminClient();

  const { data: delivery, error } = await admin
    .from('deliveries')
    .select('id, status, rider_id, rider_name, rider_phone')
    .eq('id', deliveryId)
    .maybeSingle();

  if (error) throw new LinkError(error.message);
  if (!delivery) throw new LinkError('Delivery not found.');

  const required = PURPOSE_REQUIRES_STATUS[purpose];
  if (delivery.status !== required) {
    throw new LinkError(
      `That link is only valid while the delivery is "${required}" — this one is "${delivery.status}".`
    );
  }
  // Both rider-facing purposes need someone to send it to. The recipient link
  // does not, but a delivery at 'Picked up' has a rider by definition.
  if (!delivery.rider_id) {
    throw new LinkError('Assign a rider before creating this link.');
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000).toISOString();

  const { error: insertError } = await admin.from('delivery_links').insert({
    delivery_id: delivery.id,
    token_hash: hashToken(token),
    purpose,
    rider_id: delivery.rider_id,
    rider_name: delivery.rider_name,
    rider_phone: delivery.rider_phone,
    issued_by: issuedBy,
    expires_at: expiresAt,
  });

  if (insertError) throw new LinkError(insertError.message);
  return { token, purpose, expiresAt };
}

const INVALID: LinkView = {
  state: 'invalid',
  // Something has to fill this in; the page shows no question for 'invalid'.
  purpose: 'rider-complete',
  summary: null,
  outcome: null,
  usedAt: '',
};

/**
 * What the token is worth right now, without changing anything.
 *
 * An unknown token is told only that it is unknown — no order number, no
 * addresses. Every other state carries the summary, because at that point the
 * holder has already proved they were given a real link.
 */
export async function loadLink(token: string): Promise<LinkView> {
  if (!token) return INVALID;
  const admin = createAdminClient();

  const { data: link, error } = await admin
    .from('delivery_links')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (error) throw new LinkError(error.message);
  if (!link) return INVALID;

  const { data: delivery, error: deliveryError } = await admin
    .from('deliveries')
    .select(
      'id, status, customer, pickup, dropoff, item_category, rider_id, rider_name, recipient_name, item_payment, delivery_paid_by, declared_value, agreed'
    )
    .eq('id', link.delivery_id)
    .maybeSingle();

  if (deliveryError) throw new LinkError(deliveryError.message);
  if (!delivery) return INVALID;

  const summary = summarise(delivery, link.rider_name);
  const base = { purpose: link.purpose, summary, outcome: null, usedAt: '' };

  // Used wins over everything below: someone re-opening the message they were
  // sent should read what they already answered, never "expired".
  if (link.confirmed_at) {
    return {
      ...base,
      state: 'used',
      outcome: link.outcome,
      usedAt: link.confirmed_at,
    };
  }
  // A rider-facing link belongs to the rider it was issued to. The recipient's
  // link is about the parcel, not the rider, so a reassignment does not void it.
  if (link.purpose !== 'recipient-confirm' && delivery.rider_id !== link.rider_id) {
    return { ...base, state: 'reassigned' };
  }
  // The delivery has moved on — this question has already been answered, by
  // another link for the same purpose or by ops editing the status directly.
  if (delivery.status !== PURPOSE_REQUIRES_STATUS[link.purpose]) {
    return { ...base, state: 'superseded' };
  }
  if (Date.parse(link.expires_at) <= Date.now()) {
    return { ...base, state: 'expired' };
  }
  return { ...base, state: 'pending' };
}

/**
 * Redeems the link: records the outcome and moves the delivery.
 *
 * Idempotent by construction. The UPDATE that claims the link filters on
 * `confirmed_at is null`, so two taps a second apart race in Postgres rather
 * than in Node — the loser claims no row and is handed the winner's result
 * instead of writing a second, later timestamp over it.
 */
export async function redeemLink(token: string, action: LinkAction): Promise<LinkView> {
  const current = await loadLink(token);
  if (current.state !== 'pending') return current;

  if (!PURPOSE_ACTIONS[current.purpose].includes(action)) {
    throw new LinkError('That is not something this link can do.');
  }

  const outcome = ACTION_OUTCOME[action];
  const key = `${current.purpose}:${outcome}`;
  const nextStatus = RESULTING_STATUS[key];
  const stampColumn = RESULTING_TIMESTAMP[key];
  if (!nextStatus || !stampColumn) throw new LinkError('That is not something this link can do.');

  const admin = createAdminClient();
  const usedAt = new Date().toISOString();

  const { data: claimed, error } = await admin
    .from('delivery_links')
    .update({ confirmed_at: usedAt, outcome })
    .eq('token_hash', hashToken(token))
    .is('confirmed_at', null)
    .select('delivery_id, rider_id')
    .maybeSingle();

  if (error) throw new LinkError(error.message);
  // Someone else got there first — re-read rather than reporting a second time.
  if (!claimed) return loadLink(token);

  const update: Database['public']['Tables']['deliveries']['Update'] = { status: nextStatus };
  update[stampColumn] = usedAt;

  const { error: deliveryError } = await admin
    .from('deliveries')
    .update(update)
    .eq('id', claimed.delivery_id);

  // The link is already spent at this point, so failing here would leave the log
  // showing the old status with no way to retry. Surfacing it tells the holder to
  // call ops, which is the only useful thing they can do.
  if (deliveryError) throw new LinkError(deliveryError.message);

  // Accepting a job is exactly when a rider stops being free, and closing one out
  // is when they are again — so the Riders tab follows from here rather than being
  // remembered by ops. A decline changes nothing: they never had the parcel.
  if (key === 'rider-response:accepted' || key === 'rider-complete:confirmed') {
    await syncRiderAvailability(admin, claimed.rider_id);
  }

  return { ...current, state: 'used', outcome, usedAt };
}
