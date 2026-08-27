// What changes hands at the door, in one place.
//
// Three surfaces need this number and they must never disagree: the WhatsApp/SMS
// message the rider gets (lib/deliveryMessages.ts), the page they open at the
// gate (app/d/[token]/page.tsx), and the log ops works from
// (components/delivery/DeliveryLog.tsx). A rider told GHS 181 on WhatsApp and
// shown GHS 150 on the page stops trusting both, so the arithmetic lives here
// rather than being repeated per surface.
//
// Dependency-free on purpose — the link page computes this from a raw database
// row on the server, the message composer from a `Delivery`, and neither should
// have to reach for the other's imports.

import type { AmountsDue, DeliveryPayer, ItemPayment } from './types';

/**
 * The two amounts payable on handover, from the delivery's payment terms.
 *
 * Takes the terms rather than a whole delivery so both callers can use it: the
 * link page holds snake_case columns straight out of Postgres, where a numeric
 * arrives as a string.
 *
 * A term that was never captured — '' on rows filed before payment terms
 * existed — yields a zero amount *and* a false reason, which is what lets the
 * rider's page stay silent about money nobody recorded instead of implying it is
 * prepaid.
 */
export function amountsDue(terms: {
  itemPayment: ItemPayment | '' | string;
  deliveryPaidBy: DeliveryPayer | '' | string;
  declaredValue: number | string;
  price: number | string;
}): AmountsDue {
  const cod = terms.itemPayment === 'Cash on delivery';
  const customerPaysFee = terms.deliveryPaidBy === 'Customer';

  return {
    itemCash: cod ? money(terms.declaredValue) : 0,
    deliveryFee: customerPaysFee ? money(terms.price) : 0,
    itemPrepaid: terms.itemPayment === 'Prepaid',
    feeOnMerchant: terms.deliveryPaidBy === 'Merchant',
  };
}

/**
 * Cost of item + delivery fee — the single figure the rider hands back at
 * base, and the only one they should ever have to do arithmetic on. They don't:
 * that is the whole point of this function existing.
 *
 * Zero when there is nothing to collect, which reads the same as "prepaid,
 * merchant pays the fee" and is why callers test the components (or
 * `hasCashToCollect`) rather than treating a zero as unknown.
 */
export function cashToCollect(due: AmountsDue): number {
  return round2(due.itemCash + due.deliveryFee);
}

/** Is the rider carrying somebody's money home on this one? */
export function hasCashToCollect(due: AmountsDue): boolean {
  return cashToCollect(due) > 0;
}

/** A numeric column, however Postgres or a form handed it over. */
function money(v: number | string): number {
  return round2(Number(v) || 0);
}

// Both amounts are already whole pesewas; rounding the sum keeps float dust out
// of a figure somebody counts out in cash.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
