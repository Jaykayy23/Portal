// Who gets told what, at each point in a delivery's life.
//
// This is the seam. Today every message is delivered by a person tapping a
// pre-filled wa.me or sms: link in the Notify modal — nothing is sent
// unattended. When a WhatsApp Business API account is wired up, the sender
// changes and this file does not: a server-side sender consumes exactly the same
// OutboundMessage list, because composing "what to say" has no opinion about
// who dials.
//
// Deliberately dependency-free (no database, no admin client, no React), so both
// the browser modal and a future Route Handler can call it.

import { shortId } from './format';
import type { Delivery, DeliveryWithMerchant, LinkPurpose } from './types';

/**
 * The moment being announced. Named after what just happened, not after who is
 * being told, because one event usually means several messages.
 */
export type NotifyTrigger =
  /** Request filed. Ops needs to assign someone. */
  | 'created'
  /** Ops assigned a rider. The rider must accept or decline. */
  | 'assigned'
  /** Rider declined. Ops needs to find someone else. */
  | 'declined'
  /** Rider accepted. Ops passes the rider's details to the merchant. */
  | 'accepted'
  /** Merchant confirmed the rider collected it. The recipient can be told. */
  | 'picked-up'
  /** Recipient confirmed receipt. The rider can close it out. */
  | 'recipient-confirmed'
  /** Rider confirmed completion. Nothing left to do. */
  | 'delivered';

/** One message, ready for a human to send or a provider to dispatch. */
export interface OutboundMessage {
  /** Stable id for React keys and, later, for a send log. */
  id: string;
  /** Who this goes to, as shown in the modal. */
  who: string;
  phone: string;
  text: string;
  /**
   * The link this message must carry before it is worth sending. The modal holds
   * the send buttons back until the token has been minted.
   */
  needsLink?: LinkPurpose;
}

export interface NotifyContext {
  /** Ops team number, from pricing params. */
  opsPhone: string;
  /** The merchant's number, present only for ops/admin views. */
  merchantPhone: string;
  /** Minted link URLs by purpose, as they become available. */
  links: Partial<Record<LinkPurpose, string>>;
}

/** "#a1b2c" — what people actually say on the phone. */
function orderNo(record: Delivery): string {
  return `#${shortId(record.id)}`;
}

function itemClause(record: Delivery): string {
  return record.itemCategory ? ` Item: ${record.itemCategory}.` : '';
}

function recipientClause(record: Delivery): string {
  // Dropped rather than sent half-empty for rows filed before recipients were
  // captured.
  return record.recipientName
    ? ` Recipient: ${record.recipientName} (${record.recipientPhone}).`
    : '';
}

function riderClause(record: Delivery): string {
  const bike = [record.riderModel, record.riderReg].filter(Boolean).join(' ');
  return `${record.riderName} (${record.riderPhone})${bike ? `, riding a ${bike}` : ''}`;
}

/**
 * Every message that should go out for this event, in the order ops should send
 * them.
 *
 * A message whose recipient has no number on file is still returned — the modal
 * renders it as "no phone number on file", which is more useful than silently
 * dropping a step from the flow.
 */
export function outboundFor(
  trigger: NotifyTrigger,
  record: DeliveryWithMerchant,
  ctx: NotifyContext
): OutboundMessage[] {
  const no = orderNo(record);
  const route = `${record.pickup} -> ${record.dropoff}`;

  switch (trigger) {
    case 'created':
      return [
        {
          id: 'ops-created',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `New SomoExpress delivery request ${no}: ${record.customer} — ${route} (${record.distance.toFixed(1)}km${record.durationMin > 0 ? `, ~${record.durationMin.toFixed(0)}min` : ''}).${itemClause(record)}${recipientClause(record)} Declared value GHS ${record.declaredValue}. Recommended GHS ${record.recommended.toFixed(2)}, agreed GHS ${record.agreed.toFixed(2)}. Please assign a rider.`,
        },
      ];

    case 'assigned':
      return [
        {
          id: 'rider-assigned',
          who: `Rider — ${record.riderName}`,
          phone: record.riderPhone,
          needsLink: 'rider-response',
          text: `SomoExpress job offer ${no}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}.${recipientClause(record)} Merchant: ${record.customer}.${itemClause(record)} Type: ${record.type}. Tap here to accept or decline: ${ctx.links['rider-response'] ?? ''}`,
        },
        {
          id: 'ops-assigned',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no} offered to ${riderClause(record)}. Route: ${route}. Awaiting their accept or decline.`,
        },
      ];

    case 'declined':
      return [
        {
          id: 'ops-declined',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no} was DECLINED by ${record.riderName} (${record.riderPhone}). Route: ${route}. Please assign another rider.`,
        },
      ];

    case 'accepted':
      return [
        {
          id: 'merchant-accepted',
          who: `Merchant — ${record.customer}`,
          phone: ctx.merchantPhone,
          text: `Your SomoExpress delivery ${no} has been accepted by rider ${riderClause(record)}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}. Please confirm in the portal once they have collected the item.`,
        },
        {
          id: 'ops-accepted',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no} accepted by ${record.riderName}. Merchant ${record.customer} has been sent the rider's details.`,
        },
      ];

    case 'picked-up':
      return [
        {
          id: 'recipient-picked-up',
          who: `Recipient — ${record.recipientName || 'customer'}`,
          phone: record.recipientPhone,
          needsLink: 'recipient-confirm',
          text: `Hello${record.recipientName ? ` ${record.recipientName}` : ''}, your SomoExpress delivery ${no} from ${record.customer} is on the way. Rider: ${riderClause(record)}. When it reaches you, tap here to confirm you have received it: ${ctx.links['recipient-confirm'] ?? ''}`,
        },
        {
          id: 'ops-picked-up',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no}: item PICKED UP by ${record.riderName} and out for delivery. Route: ${route}. Recipient has been sent their confirmation link.`,
        },
      ];

    case 'recipient-confirmed':
      return [
        {
          id: 'rider-complete',
          who: `Rider — ${record.riderName}`,
          phone: record.riderPhone,
          needsLink: 'rider-complete',
          text: `SomoExpress ${no}: ${record.recipientName || 'the recipient'} has confirmed receipt. Tap here to close the job off: ${ctx.links['rider-complete'] ?? ''}`,
        },
        {
          id: 'ops-recipient-confirmed',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no}: recipient ${record.recipientName || ''} has CONFIRMED receipt. Route: ${route}. Rider ${record.riderName} has been sent their completion link.`,
        },
        {
          id: 'merchant-recipient-confirmed',
          who: `Merchant — ${record.customer}`,
          phone: ctx.merchantPhone,
          text: `Your SomoExpress delivery ${no} has been received by ${record.recipientName || 'the recipient'} at ${record.dropoff}. Thank you.`,
        },
      ];

    case 'delivered':
      return [
        {
          id: 'ops-delivered',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no} is COMPLETE — rider ${record.riderName} has confirmed delivery. Route: ${route}.`,
        },
        {
          id: 'merchant-delivered',
          who: `Merchant — ${record.customer}`,
          phone: ctx.merchantPhone,
          text: `Your SomoExpress delivery ${no} is complete. Rider ${record.riderName} confirmed handover at ${record.dropoff}.`,
        },
      ];
  }
}

/**
 * The link that has to exist before this event's messages are worth sending.
 *
 * At most one per trigger, which is what lets the modal hold every send button
 * until the token is minted rather than tracking them individually.
 */
export function linkNeededFor(trigger: NotifyTrigger): LinkPurpose | null {
  switch (trigger) {
    case 'assigned':
      return 'rider-response';
    case 'picked-up':
      return 'recipient-confirm';
    case 'recipient-confirmed':
      return 'rider-complete';
    default:
      return null;
  }
}

/** Modal heading per event — what the person at the keyboard is here to do. */
export const TRIGGER_TITLE: Record<NotifyTrigger, string> = {
  created: 'Alert ops about this request',
  assigned: 'Send the job offer',
  declined: 'Rider declined — tell ops',
  accepted: 'Rider accepted — send the merchant the details',
  'picked-up': 'Picked up — tell the customer it is on the way',
  'recipient-confirmed': 'Received — send the rider their completion link',
  delivered: 'Delivery complete',
};

/**
 * The event a delivery's current status implies.
 *
 * The Notify modal is opened from a row in the log, not from the event itself, so
 * this is how it knows which set of messages to offer. Statuses with nobody to
 * tell — a request still waiting on approval — map to 'created', which is always
 * a safe thing to re-send to ops.
 */
export function triggerForStatus(record: Delivery): NotifyTrigger {
  switch (record.status) {
    case 'Assigned':
      return 'assigned';
    case 'Declined':
      return 'declined';
    case 'Accepted':
      return 'accepted';
    case 'Picked up':
      return 'picked-up';
    case 'Recipient confirmed':
      return 'recipient-confirmed';
    case 'Delivered':
      return 'delivered';
    default:
      return 'created';
  }
}
