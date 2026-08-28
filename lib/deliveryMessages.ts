// Who gets told what, at each point in a delivery's life.
//
// This is the seam, and it has held: the portal now sends these messages itself,
// the moment the delivery moves (lib/autoNotify.ts), and this file did not
// change to make that happen. Composing "what to say" has no opinion about who
// dials — the Notify modal renders the same list for its WhatsApp deep links,
// and a WhatsApp Business API sender would consume it too.
//
// Deliberately dependency-free (no database, no admin client, no React), so the
// browser modal and the server's sender can both call it.

import { amountsDue, cashToCollect } from './amounts';
import { fmtMoney, orderNo } from './format';
import type { Delivery, DeliveryWithMerchant, LinkPurpose } from './types';

/**
 * The moment being announced. Named after what just happened, not after who is
 * being told, because one event usually means several messages.
 */
export type NotifyTrigger =
  /** Request filed. Ops needs to assign someone. */
  | 'created'
  /** Ops offered the job to a rider. They must accept or decline. */
  | 'offered'
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

/**
 * What the rider must collect, and what they must not.
 *
 * Spelled out in both directions on purpose. "Prepaid" said explicitly is what
 * stops a rider asking a customer for money they have already paid, which is the
 * mistake that costs the merchant a customer rather than costing anyone cash.
 *
 * The cost of the item is quoted as the reference for a cash-on-delivery item
 * because it is the only figure the portal holds for the goods — see the README
 * note on adding a separate COD amount if the two ever need to differ.
 *
 * The breakdown is followed by the total, and the total is what the rider is
 * held to: cost of item plus fee, added by the system so nobody is doing sums
 * at a gate on a bad line. It is stated even when only one of the two applies,
 * so "TOTAL CASH TO COLLECT" means the same thing in every message a rider ever
 * gets rather than being a line they have to notice is missing.
 */
function paymentClause(record: Delivery): string {
  const due = amountsDue(record);
  const parts: string[] = [];

  if (record.itemPayment === 'Cash on delivery') {
    parts.push(`COLLECT CASH for the item (cost of item ${fmtMoney(due.itemCash)})`);
  } else if (record.itemPayment === 'Prepaid') {
    parts.push('item is PREPAID, collect nothing for the goods');
  }

  if (record.deliveryPaidBy === 'Customer') {
    parts.push(`collect the delivery fee of ${fmtMoney(due.deliveryFee)} from the customer`);
  } else if (record.deliveryPaidBy === 'Merchant') {
    parts.push('delivery fee is on the merchant account, do not collect it');
  }

  // Rows filed before payment terms were captured say nothing rather than
  // guessing, which would be the one kind of wrong that costs somebody money.
  if (!parts.length) return '';

  const total = cashToCollect(due);
  const totalClause =
    total > 0
      ? ` TOTAL CASH TO COLLECT from the customer: ${fmtMoney(total)}.`
      : ' TOTAL CASH TO COLLECT: nothing — this is a no-cash delivery.';

  return ` PAYMENT: ${parts.join('; ')}.${totalClause}`;
}

/**
 * What the recipient should have ready, if anything.
 *
 * The total leads and the breakdown follows, so the amount is settled before a
 * rider is standing at the door with a different figure in their message. Both
 * sides are quoting the same calculation — see lib/amounts.ts.
 */
function recipientPaymentClause(record: Delivery): string {
  const due = amountsDue(record);
  const { itemCash, deliveryFee } = due;

  if (itemCash > 0 && deliveryFee > 0) {
    return ` Please have ${fmtMoney(cashToCollect(due))} ready for the rider — ${fmtMoney(
      itemCash
    )} for the item and ${fmtMoney(deliveryFee)} delivery fee.`;
  }
  if (itemCash > 0) {
    return ` Please have ${fmtMoney(itemCash)} for the item ready for the rider.`;
  }
  if (deliveryFee > 0) {
    return ` Please have the delivery fee of ${fmtMoney(deliveryFee)} ready for the rider.`;
  }
  // Nothing owed, and nothing said: "GHS 0.00 to pay" only invites a phone call.
  return '';
}

/**
 * The same total, compressed for an ops message.
 *
 * Ops need it at two moments: filing the request, where it is what the merchant's
 * customer will be asked for, and offering the job, where it is the float that
 * rider will be carrying and will have to remit. Both read the figure the rider
 * was given, never a second calculation.
 */
function opsCashClause(record: Delivery): string {
  // Same silence as the rider's clause on rows filed before terms were captured.
  if (!record.itemPayment && !record.deliveryPaidBy) return '';

  const total = cashToCollect(amountsDue(record));
  return total > 0
    ? ` Cash to collect on delivery: ${fmtMoney(total)}.`
    : ' No cash to collect (prepaid, fee on the merchant).';
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
  // "SME4f2a1" — what people actually say on the phone.
  const no = orderNo(record.id);
  const route = `${record.pickup} -> ${record.dropoff}`;

  switch (trigger) {
    case 'created':
      return [
        {
          id: 'ops-created',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `New SomoExpress delivery request ${no}: ${record.customer} — ${route} (${record.distance.toFixed(1)}km${record.durationMin > 0 ? `, ~${record.durationMin.toFixed(0)}min` : ''}).${itemClause(record)}${recipientClause(record)} Cost of item ${fmtMoney(record.declaredValue)}. Delivery fee ${fmtMoney(record.price)}.${opsCashClause(record)} Please assign a rider.`,
        },
      ];

    case 'offered':
      return [
        {
          id: 'rider-offered',
          who: `Rider — ${record.riderName}`,
          phone: record.riderPhone,
          needsLink: 'rider-response',
          text: `SomoExpress job offer ${no}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}.${recipientClause(record)} Merchant: ${record.customer}.${itemClause(record)} Type: ${record.type}.${paymentClause(record)} Tap here to accept or decline: ${ctx.links['rider-response'] ?? ''}`,
        },
        {
          id: 'ops-offered',
          who: 'Ops team',
          phone: ctx.opsPhone,
          text: `SomoExpress ${no} offered to ${riderClause(record)}. Route: ${route}.${opsCashClause(record)} Awaiting their accept or decline.`,
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
          text: `Hello${record.recipientName ? ` ${record.recipientName}` : ''}, your SomoExpress delivery ${no} from ${record.customer} is on the way. Rider: ${riderClause(record)}.${recipientPaymentClause(record)} When it reaches you, tap here to confirm you have received it: ${ctx.links['recipient-confirm'] ?? ''}`,
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
          text: `SomoExpress ${no}: ${record.recipientName || 'the recipient'} has confirmed receipt.${paymentClause(record)} Tap here to close the job off: ${ctx.links['rider-complete'] ?? ''}`,
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
    case 'offered':
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
  offered: 'Send the job offer',
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
    case 'Pending':
      return 'offered';
    case 'Declined':
      return 'declined';
    case 'Assigned':
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

/**
 * The alert a delivery *arriving* at each status fires on its own.
 *
 * A near-twin of triggerForStatus() above, and the difference between them is
 * the point. That one answers "this row is sitting at X — what would you send
 * about it?", for a modal opened on a row that may not have moved in days, and
 * so it always has an answer. This one answers "the row just became X — who has
 * to be told, right now?", and for two statuses the answer is nobody:
 *
 *   Requested  is where a delivery starts. Its ops alert fires from the create
 *              route, which knows the row is new. Firing it from here as well
 *              would text ops "New delivery request" every time someone took a
 *              rider off a job and dropped it back into the queue.
 *   Approved   is a pre-rider state ops moves a row into themselves. They are
 *              the audience for a 'created' alert and they are the ones doing
 *              it, so there is nothing to say.
 *
 * Absent from the map therefore means "no automatic alert", not "not handled".
 */
export const TRIGGER_ON_ENTERING: Partial<Record<Delivery['status'], NotifyTrigger>> = {
  Pending: 'offered',
  Declined: 'declined',
  Assigned: 'accepted',
  'Picked up': 'picked-up',
  'Recipient confirmed': 'recipient-confirmed',
  Delivered: 'delivered',
};
