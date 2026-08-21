// Where the money is.
//
// The delivery log answers "where is the parcel". This answers the other half,
// which nothing in the portal answered before: whose pocket is the money in
// right now.
//
// Two sums travel with every delivery and they are genuinely independent:
//
//   the goods   worth `declaredValue`. Either the customer already paid the
//               merchant for them ('Prepaid'), or the rider collects the cash at
//               the door ('Cash on delivery').
//   the fee     worth `price`. Either it is billed to the merchant's account
//               ('Merchant'), or the rider collects it at the door ('Customer').
//
// Four combinations, all of them ordinary. What decides where the money *is* is
// those two answers plus one more fact: whether the handover has happened yet.
// Cash on delivery that has not been delivered is still in the customer's
// pocket; the same row an hour later is cash a rider is carrying around, and
// that is the difference between a forecast and a float somebody has to remit.
//
// Nothing here is stored. Every position below is derived from the delivery row
// on each read, which is deliberate: a settlement table would be a second source
// of truth to keep in step with the status, and the status is already the thing
// that moves. The cost is that this file cannot know a rider has since handed
// their cash in — see the note on `settled`.
//
// The types live here rather than in lib/types.ts because they exist only to
// describe the output of the functions beside them.

import type { Delivery, DeliveryWithMerchant } from './types';

/** Us. Named once so the sentences below read like sentences. */
export const COMPANY = 'SomoExpress';

/** Who physically has the money at this moment. */
export type MoneyHolder = 'Rider' | 'Merchant' | 'Customer';

/** Who it has to end up with. Null when it is already there. */
export type MoneyOwedTo = 'Merchant' | 'SomoExpress' | null;

/**
 * One sum of money on one delivery, and whose hands it is in.
 *
 * `settled` means "already where it belongs", which here can only ever be true
 * of prepaid goods: the customer paid the merchant directly and none of that
 * money passes through us. It is deliberately not a record of remittance — a
 * rider handing their float in at the end of a shift happens outside this
 * portal, so the ledger's job is to say what is owed, not to claim it has been
 * paid. Recording remittances would need a table of its own.
 */
export interface LedgerPosition {
  amount: number;
  holder: MoneyHolder;
  owedTo: MoneyOwedTo;
  settled: boolean;
  /** The handover has not happened, so this money has not moved yet. */
  inFlight: boolean;
  /** Short cell text — "With Kwame Mensah", "On merchant account". */
  holderLabel: string;
  /** The obligation, or '' when there is none. */
  owedLabel: string;
  /** One plain sentence, for the hover title and the export. */
  detail: string;
}

export interface LedgerEntry {
  delivery: DeliveryWithMerchant;
  /** Null on rows filed before payment terms were captured. */
  item: LedgerPosition | null;
  fee: LedgerPosition | null;
  /** Everything on this row that still has to move. */
  outstanding: number;
  /** True when neither term was recorded — nothing can be said about the money. */
  untracked: boolean;
}

/**
 * Has the parcel reached the recipient?
 *
 * This is the moment cash changes hands at the door, so it is the hinge the whole
 * file turns on. Both the timestamps and the statuses are checked: a timestamp is
 * the honest record (a recipient or a rider tapped their link), and the status
 * covers a row ops moved along by hand in the log, which is still ops telling us
 * the parcel arrived.
 */
export function handedOver(d: Delivery): boolean {
  return (
    !!d.recipientConfirmedAt ||
    !!d.deliveredAt ||
    d.status === 'Recipient confirmed' ||
    d.status === 'Delivered'
  );
}

/** What the rider is called on this row, or a stand-in before assignment. */
function riderOf(d: Delivery): string {
  return d.riderName || 'the rider';
}

/** Money for the goods. */
export function itemPosition(d: Delivery): LedgerPosition | null {
  if (!d.itemPayment) return null;
  const amount = d.declaredValue || 0;

  if (d.itemPayment === 'Prepaid') {
    return {
      amount,
      holder: 'Merchant',
      owedTo: null,
      settled: true,
      inFlight: false,
      holderLabel: 'With merchant',
      owedLabel: '',
      detail: `Prepaid — the customer paid ${d.customer} before the parcel left, so none of this money passes through ${COMPANY}.`,
    };
  }

  if (handedOver(d)) {
    return {
      amount,
      holder: 'Rider',
      owedTo: 'Merchant',
      settled: false,
      inFlight: false,
      holderLabel: `With ${riderOf(d)}`,
      owedLabel: `owed to ${d.customer}`,
      detail: `Cash on delivery, collected at the door — ${riderOf(d)} is carrying it, and it belongs to ${d.customer}.`,
    };
  }

  return {
    amount,
    holder: 'Customer',
    owedTo: 'Merchant',
    settled: false,
    inFlight: true,
    holderLabel: 'Still with customer',
    owedLabel: `for ${d.customer}`,
    detail: `Cash on delivery — nothing collected yet. ${riderOf(d)} takes it on handover, and it belongs to ${d.customer}.`,
  };
}

/** The delivery fee — our revenue, and the half most often owed to us. */
export function feePosition(d: Delivery): LedgerPosition | null {
  if (!d.deliveryPaidBy) return null;
  const amount = d.price || 0;
  const done = handedOver(d);

  if (d.deliveryPaidBy === 'Merchant') {
    return {
      amount,
      holder: 'Merchant',
      owedTo: 'SomoExpress',
      settled: false,
      // Billed on completion, so a delivery still in flight is a fee accruing
      // rather than an invoice anyone can chase today.
      inFlight: !done,
      holderLabel: 'On merchant account',
      owedLabel: `${d.customer} owes ${COMPANY}`,
      detail: done
        ? `The fee is on the account of ${d.customer} and the delivery is complete — invoice it and collect.`
        : `The fee goes on the account of ${d.customer} once this delivery completes.`,
    };
  }

  if (done) {
    return {
      amount,
      holder: 'Rider',
      owedTo: 'SomoExpress',
      settled: false,
      inFlight: false,
      holderLabel: `With ${riderOf(d)}`,
      owedLabel: `owed to ${COMPANY}`,
      detail: `The customer paid the fee to ${riderOf(d)} at the door, so the rider is holding money belonging to ${COMPANY}.`,
    };
  }

  return {
    amount,
    holder: 'Customer',
    owedTo: 'SomoExpress',
    settled: false,
    inFlight: true,
    holderLabel: 'Customer pays rider',
    owedLabel: `owed to ${COMPANY}`,
    detail: `The customer pays the fee to ${riderOf(d)} on handover — nothing collected yet.`,
  };
}

export function toLedgerEntry(delivery: DeliveryWithMerchant): LedgerEntry {
  const item = itemPosition(delivery);
  const fee = feePosition(delivery);
  const outstanding =
    (item && !item.settled ? item.amount : 0) + (fee && !fee.settled ? fee.amount : 0);

  return { delivery, item, fee, outstanding, untracked: !item && !fee };
}

export function toLedger(rows: DeliveryWithMerchant[]): LedgerEntry[] {
  return rows.map(toLedgerEntry);
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/**
 * The figures across a set of rows.
 *
 * Split by who has to do something about it rather than by column, because that
 * is the only split that turns into an action: cash with riders gets remitted,
 * merchant invoices get raised, and anything in flight gets left alone until the
 * parcel lands.
 */
export interface LedgerTotals {
  deliveries: number;
  /** Collected COD cash a rider is carrying. Belongs to the merchant. */
  cashWithRidersForMerchants: number;
  /** Fees collected at the door. Belongs to us. */
  cashWithRidersForUs: number;
  /** The two above — the whole rider float. */
  cashWithRiders: number;
  /** Fees on merchant accounts for completed deliveries. Invoice these. */
  merchantInvoicesDue: number;
  /** Fees on merchant accounts for deliveries still in flight. Not chaseable yet. */
  merchantFeesAccruing: number;
  /** COD cash the rider has yet to collect. */
  codAwaitingCollection: number;
  /** Fees the rider has yet to collect from customers. */
  feesAwaitingCollection: number;
  /** Goods the merchant was already paid for. Informational — never ours. */
  prepaidWithMerchants: number;
  /** Every delivery fee on these rows, whoever settles it. */
  feeTotal: number;
  /** Every declared goods value on these rows. */
  goodsTotal: number;
  /** Everything above that still has to move, from any direction. */
  outstanding: number;
  /** Rows filed before payment terms existed — nothing can be said about them. */
  untracked: number;
}

export function ledgerTotals(entries: LedgerEntry[]): LedgerTotals {
  const t: LedgerTotals = {
    deliveries: entries.length,
    cashWithRidersForMerchants: 0,
    cashWithRidersForUs: 0,
    cashWithRiders: 0,
    merchantInvoicesDue: 0,
    merchantFeesAccruing: 0,
    codAwaitingCollection: 0,
    feesAwaitingCollection: 0,
    prepaidWithMerchants: 0,
    feeTotal: 0,
    goodsTotal: 0,
    outstanding: 0,
    untracked: 0,
  };

  for (const e of entries) {
    t.feeTotal += e.delivery.price || 0;
    t.goodsTotal += e.delivery.declaredValue || 0;
    t.outstanding += e.outstanding;
    if (e.untracked) t.untracked += 1;

    if (e.item) {
      if (e.item.settled) t.prepaidWithMerchants += e.item.amount;
      else if (e.item.holder === 'Rider') t.cashWithRidersForMerchants += e.item.amount;
      else t.codAwaitingCollection += e.item.amount;
    }

    if (e.fee) {
      if (e.fee.holder === 'Rider') t.cashWithRidersForUs += e.fee.amount;
      else if (e.fee.holder === 'Merchant') {
        if (e.fee.inFlight) t.merchantFeesAccruing += e.fee.amount;
        else t.merchantInvoicesDue += e.fee.amount;
      } else t.feesAwaitingCollection += e.fee.amount;
    }
  }

  t.cashWithRiders = t.cashWithRidersForMerchants + t.cashWithRidersForUs;
  return t;
}

// ---------------------------------------------------------------------------
// Who is holding what
// ---------------------------------------------------------------------------

/** One rider's float — what they are carrying, and for whom. */
export interface RiderFloat {
  riderId: string;
  riderName: string;
  deliveries: number;
  forMerchants: number;
  forUs: number;
  total: number;
}

/**
 * Cash currently in rider hands, biggest float first.
 *
 * Keyed on the rider id where there is one and on the snapshotted name
 * otherwise: a rider deleted from the roster leaves `rider_id` null on their old
 * rows, and the money they were carrying does not stop existing because their
 * roster entry did.
 */
export function riderFloat(entries: LedgerEntry[]): RiderFloat[] {
  const byRider = new Map<string, RiderFloat>();

  for (const e of entries) {
    const positions = [e.item, e.fee].filter(
      (p): p is LedgerPosition => !!p && p.holder === 'Rider' && p.amount > 0
    );
    if (positions.length === 0) continue;

    const d = e.delivery;
    const key = d.riderId || `name:${d.riderName}`;
    const row: RiderFloat = byRider.get(key) ?? {
      riderId: d.riderId,
      riderName: d.riderName || 'Unnamed rider',
      deliveries: 0,
      forMerchants: 0,
      forUs: 0,
      total: 0,
    };

    row.deliveries += 1;
    for (const p of positions) {
      if (p.owedTo === 'Merchant') row.forMerchants += p.amount;
      else row.forUs += p.amount;
      row.total += p.amount;
    }
    byRider.set(key, row);
  }

  return [...byRider.values()].sort((a, b) => b.total - a.total);
}

/** One merchant's position with us, in both directions. */
export interface MerchantBalance {
  merchantId: string;
  name: string;
  deliveries: number;
  /** Delivery fees on their account, for completed deliveries. They pay us. */
  owesUs: number;
  /** COD cash riders are holding on their behalf. We pay them. */
  weOweThem: number;
  /** Their fees over the period, whoever settles them. */
  feeTotal: number;
  /** Positive means the merchant owes on balance, negative means we do. */
  net: number;
}

export function merchantBalances(entries: LedgerEntry[]): MerchantBalance[] {
  const byMerchant = new Map<string, MerchantBalance>();

  for (const e of entries) {
    const d = e.delivery;
    const row: MerchantBalance = byMerchant.get(d.merchantId) ?? {
      merchantId: d.merchantId,
      name: d.customer,
      deliveries: 0,
      owesUs: 0,
      weOweThem: 0,
      feeTotal: 0,
      net: 0,
    };

    row.deliveries += 1;
    row.feeTotal += d.price || 0;
    if (e.fee && e.fee.holder === 'Merchant' && !e.fee.inFlight) row.owesUs += e.fee.amount;
    if (e.item && e.item.holder === 'Rider') row.weOweThem += e.item.amount;
    row.net = row.owesUs - row.weOweThem;

    byMerchant.set(d.merchantId, row);
  }

  // Busiest position first, in either direction: a merchant we owe GHS 4,000 is
  // as much of a thing to deal with as one who owes us GHS 4,000.
  return [...byMerchant.values()].sort(
    (a, b) => b.owesUs + b.weOweThem - (a.owesUs + a.weOweThem)
  );
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * The question someone came to the ledger with.
 *
 * Each one is an action rather than a category: remit the rider float, raise the
 * merchant invoices, pay the merchants their COD takings, or leave the in-flight
 * rows alone.
 */
export type LedgerFocus =
  | 'all'
  | 'rider-cash'
  | 'merchant-owes'
  | 'owed-to-merchant'
  | 'in-flight'
  | 'no-terms';

export const LEDGER_FOCUSES: { value: LedgerFocus; label: string; hint: string }[] = [
  { value: 'all', label: 'Everything', hint: 'Every delivery in range' },
  {
    value: 'rider-cash',
    label: 'Cash with riders',
    hint: 'Collected at the door and not yet remitted',
  },
  {
    value: 'merchant-owes',
    label: 'Merchant invoices due',
    hint: 'Completed deliveries whose fee is on the merchant account',
  },
  {
    value: 'owed-to-merchant',
    label: 'Owed to merchants',
    hint: 'Cash on delivery a rider collected on a merchant behalf',
  },
  {
    value: 'in-flight',
    label: 'Not collected yet',
    hint: 'Money that only moves once the parcel is handed over',
  },
  {
    value: 'no-terms',
    label: 'No terms recorded',
    hint: 'Filed before payment terms were captured',
  },
];

export function matchesFocus(e: LedgerEntry, focus: LedgerFocus): boolean {
  switch (focus) {
    case 'all':
      return true;
    case 'rider-cash':
      return e.item?.holder === 'Rider' || e.fee?.holder === 'Rider';
    case 'merchant-owes':
      return e.fee?.holder === 'Merchant' && !e.fee.inFlight;
    case 'owed-to-merchant':
      return e.item?.holder === 'Rider';
    case 'in-flight':
      return (!!e.item && e.item.inFlight) || (!!e.fee && e.fee.inFlight);
    case 'no-terms':
      return e.untracked;
  }
}
