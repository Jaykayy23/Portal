// Where the money is.
//
// The delivery log answers "where is the parcel". This answers the other half:
// whose pocket is the money in right now.
//
// Two sums travel with every delivery and they are genuinely independent:
//
//   the goods   worth `declaredValue`. Either the customer already paid the
//               merchant for them ('Prepaid'), or the rider collects the cash at
//               the door ('Cash on delivery').
//   the fee     worth `price`. Either it is billed to the merchant's account
//               ('Merchant'), or the rider collects it at the door ('Customer').
//
// Each sum has a route it has to travel, written here as legs — 'in' meaning
// money reaching us, 'out' meaning money leaving us:
//
//   goods, cash on delivery   customer -> rider -[in]-> us -[out]-> merchant
//   goods, prepaid            customer -> merchant. Never ours; no legs at all.
//   fee, customer pays        customer -> rider -[in]-> us. Ours on arrival.
//   fee, merchant pays        merchant -[in]-> us. Ours on arrival.
//
// So a position's state is decided by three things: the two payment terms,
// whether the handover has happened, and which legs have been settled. Cash on
// delivery that has not been delivered is still in the customer's pocket; the
// same row an hour later is cash a rider is carrying; the same row once they have
// remitted is cash we are holding and owe onward. Those are three different jobs
// for three different people, which is why they are three different states and
// not one "unpaid" flag.
//
// What is derived and what is stored: the *positions* are derived on every read
// from the delivery row plus its settlement lines, and never stored. The
// *settlements* are stored, because a rider handing cash over is an event in the
// world that nothing else in the database records. See the settlements migration
// for why the writes are functions rather than policies.
//
// The types live here rather than in lib/types.ts because they exist only to
// describe the output of the functions beside them.

import type { Delivery, DeliveryWithMerchant } from './types';

/** Us. Named once so the sentences below read like sentences. */
export const COMPANY = 'SomoExpress';

/** Which of a delivery's two sums. */
export type SettlementStream = 'goods' | 'fee';

/** Money reaching us, or money leaving us. */
export type SettlementLeg = 'in' | 'out';

/**
 * How a settlement was paid.
 *
 * 'Offset' is the one that is not a payment at all: it records a merchant's fee
 * invoice cancelled against cash-on-delivery money we were holding for them,
 * where the only thing that moved was the balance.
 *
 * Here rather than in lib/settlements.ts because the dialog that offers these is
 * a client component, and that module reaches for next/headers. Everything in
 * this file is safe on both sides of the boundary.
 */
export type SettlementMethod = 'Cash' | 'Mobile money' | 'Bank transfer' | 'Cheque' | 'Offset';

export const SETTLEMENT_METHODS: SettlementMethod[] = [
  'Cash',
  'Mobile money',
  'Bank transfer',
  'Cheque',
  'Offset',
];

/** Who physically has the money at this moment. */
export type MoneyHolder = 'Rider' | 'Merchant' | 'Customer' | 'SomoExpress';

/** Who it has to end up with. Null when it is already there. */
export type MoneyOwedTo = 'Merchant' | 'SomoExpress' | null;

/**
 * A leg that has been settled, as the ledger needs to read it.
 *
 * `reference` and `method` come from the settlement header, which a merchant
 * cannot always read — a rider's remittance covers several merchants at once, so
 * its paperwork is internal. They are '' in that case, and `settledAt` is
 * snapshotted onto the line itself precisely so the merchant's own ledger can
 * still say when their position cleared.
 */
export interface SettlementMark {
  stream: SettlementStream;
  leg: SettlementLeg;
  amount: number;
  settledAt: string;
  reference: string;
  method: string;
  /** The rider or merchant the settlement was with. '' when not readable. */
  counterparty: string;
}

/** Settled legs by delivery id. Voided lines are never in here. */
export type SettlementMarks = Map<string, SettlementMark[]>;

/**
 * The next leg that could legally be recorded against a position.
 *
 * The rule lives here so the ledger, the settle dialog and the export all agree
 * on what is settleable. `record_settlement` in the database enforces the same
 * rule independently — this is what stops the UI offering an action that would
 * be refused, not what makes the refusal happen.
 */
export interface SettlementStep {
  deliveryId: string;
  stream: SettlementStream;
  leg: SettlementLeg;
  /** The counterparty of a settlement that would record this leg. */
  party: 'Rider' | 'Merchant';
  amount: number;
  /** One line for the confirm list, e.g. 'Cash on delivery collected'. */
  label: string;
}

/**
 * One sum of money on one delivery, and whose hands it is in.
 *
 * `settled` means it has finished travelling: prepaid goods, which never leave
 * the merchant, or a leg-complete position whose settlement is recorded. It is
 * no longer a synonym for "prepaid" the way it was before settlements existed.
 */
export interface LedgerPosition {
  amount: number;
  holder: MoneyHolder;
  owedTo: MoneyOwedTo;
  settled: boolean;
  /** The handover has not happened, so this money has not moved yet. */
  inFlight: boolean;
  /** Short cell text — 'With Kwame Mensah', 'On merchant account'. */
  holderLabel: string;
  /** The obligation, or '' when there is none. */
  owedLabel: string;
  /** One plain sentence, for the hover title and the export. */
  detail: string;
  /** Legs already settled, newest last. */
  marks: SettlementMark[];
  /** What could be recorded next, or null when nothing can. */
  next: SettlementStep | null;
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
  /** True when every sum on the row has finished travelling. */
  cleared: boolean;
}

/**
 * Has the parcel reached the recipient?
 *
 * The moment cash changes hands at the door, and so the hinge the whole file
 * turns on. Both the timestamps and the statuses are checked: a timestamp is the
 * honest record (a recipient or a rider tapped their link) and the status covers
 * a row ops moved along by hand in the log, which is still ops saying it arrived.
 *
 * `private.delivery_handed_over` in the settlements migration is the SQL twin of
 * this. If you change one, change the other.
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

function markFor(
  marks: SettlementMark[],
  stream: SettlementStream,
  leg: SettlementLeg
): SettlementMark | undefined {
  return marks.find((m) => m.stream === stream && m.leg === leg);
}

/** 'settled on 21 Aug, ref 4471' — the tail of a cleared position's sentence. */
function markSentence(mark: SettlementMark): string {
  const when = new Date(mark.settledAt);
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const bits = [date && `on ${date}`, mark.method && mark.method.toLowerCase(), mark.reference && `ref ${mark.reference}`];
  return bits.filter(Boolean).join(', ');
}

/** Money for the goods. */
export function itemPosition(d: Delivery, marks: SettlementMark[] = []): LedgerPosition | null {
  if (!d.itemPayment) return null;
  const amount = d.declaredValue || 0;
  const base = { amount, marks, next: null as SettlementStep | null };

  if (d.itemPayment === 'Prepaid') {
    return {
      ...base,
      holder: 'Merchant',
      owedTo: null,
      settled: true,
      inFlight: false,
      holderLabel: 'With merchant',
      owedLabel: '',
      detail: `Prepaid — the customer paid ${d.customer} before the parcel left, so none of this money passes through ${COMPANY}.`,
    };
  }

  if (!handedOver(d)) {
    return {
      ...base,
      holder: 'Customer',
      owedTo: 'Merchant',
      settled: false,
      inFlight: true,
      holderLabel: 'Still with customer',
      owedLabel: `for ${d.customer}`,
      detail: `Cash on delivery — nothing collected yet. ${riderOf(d)} takes it on handover, and it belongs to ${d.customer}.`,
    };
  }

  const remitted = markFor(marks, 'goods', 'in');
  const paidOut = markFor(marks, 'goods', 'out');

  if (paidOut) {
    return {
      ...base,
      holder: 'Merchant',
      owedTo: null,
      settled: true,
      inFlight: false,
      holderLabel: 'Paid to merchant',
      owedLabel: '',
      detail: `Cash on delivery, collected and settled — ${d.customer} was paid their takings ${markSentence(paidOut)}.`,
    };
  }

  if (remitted) {
    return {
      ...base,
      holder: 'SomoExpress',
      owedTo: 'Merchant',
      settled: false,
      inFlight: false,
      holderLabel: `With ${COMPANY}`,
      owedLabel: `owed to ${d.customer}`,
      // The rider is out of it now; the obligation is ours.
      detail: `${riderOf(d)} remitted this ${markSentence(remitted)}. ${COMPANY} is holding it, and it is owed to ${d.customer}.`,
      next: {
        deliveryId: d.id,
        stream: 'goods',
        leg: 'out',
        party: 'Merchant',
        amount,
        label: 'Cash-on-delivery takings owed to the merchant',
      },
    };
  }

  return {
    ...base,
    holder: 'Rider',
    owedTo: 'Merchant',
    settled: false,
    inFlight: false,
    holderLabel: `With ${riderOf(d)}`,
    owedLabel: `owed to ${d.customer}`,
    detail: `Cash on delivery, collected at the door — ${riderOf(d)} is carrying it, and it belongs to ${d.customer}.`,
    next: {
      deliveryId: d.id,
      stream: 'goods',
      leg: 'in',
      party: 'Rider',
      amount,
      label: 'Cash collected for the goods',
    },
  };
}

/** The delivery fee — our revenue, and the half most often owed to us. */
export function feePosition(d: Delivery, marks: SettlementMark[] = []): LedgerPosition | null {
  if (!d.deliveryPaidBy) return null;
  const amount = d.price || 0;
  const done = handedOver(d);
  const base = { amount, marks, next: null as SettlementStep | null };
  const collected = markFor(marks, 'fee', 'in');

  if (collected) {
    return {
      ...base,
      // Ours on arrival: there is no onward leg for a fee.
      holder: 'SomoExpress',
      owedTo: null,
      settled: true,
      inFlight: false,
      holderLabel: 'Paid',
      owedLabel: '',
      detail:
        d.deliveryPaidBy === 'Merchant'
          ? `${d.customer} settled this fee ${markSentence(collected)}.`
          : `The fee was collected at the door and remitted ${markSentence(collected)}.`,
    };
  }

  if (d.deliveryPaidBy === 'Merchant') {
    return {
      ...base,
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
      next: done
        ? {
            deliveryId: d.id,
            stream: 'fee',
            leg: 'in',
            party: 'Merchant',
            amount,
            label: 'Delivery fee billed to the merchant',
          }
        : null,
    };
  }

  if (!done) {
    return {
      ...base,
      holder: 'Customer',
      owedTo: 'SomoExpress',
      settled: false,
      inFlight: true,
      holderLabel: 'Customer pays rider',
      owedLabel: `owed to ${COMPANY}`,
      detail: `The customer pays the fee to ${riderOf(d)} on handover — nothing collected yet.`,
    };
  }

  return {
    ...base,
    holder: 'Rider',
    owedTo: 'SomoExpress',
    settled: false,
    inFlight: false,
    holderLabel: `With ${riderOf(d)}`,
    owedLabel: `owed to ${COMPANY}`,
    detail: `The customer paid the fee to ${riderOf(d)} at the door, so the rider is holding money belonging to ${COMPANY}.`,
    next: {
      deliveryId: d.id,
      stream: 'fee',
      leg: 'in',
      party: 'Rider',
      amount,
      label: 'Delivery fee collected at the door',
    },
  };
}

export function toLedgerEntry(
  delivery: DeliveryWithMerchant,
  marks: SettlementMark[] = []
): LedgerEntry {
  const item = itemPosition(delivery, marks);
  const fee = feePosition(delivery, marks);
  const outstanding =
    (item && !item.settled ? item.amount : 0) + (fee && !fee.settled ? fee.amount : 0);

  return {
    delivery,
    item,
    fee,
    outstanding,
    untracked: !item && !fee,
    cleared: !!(item || fee) && (!item || item.settled) && (!fee || fee.settled),
  };
}

export function toLedger(
  rows: DeliveryWithMerchant[],
  marks: SettlementMarks = new Map()
): LedgerEntry[] {
  return rows.map((r) => toLedgerEntry(r, marks.get(r.id) ?? []));
}

/**
 * Every leg on these rows that could be recorded right now, for one counterparty.
 *
 * What the settle dialog is built from. Passing the rider id or the merchant id
 * narrows it to the legs that counterparty can actually discharge — a rider
 * cannot remit an order they did not carry, and the database refuses it too.
 */
export function settleableSteps(
  entries: LedgerEntry[],
  party: { riderId: string } | { merchantId: string }
): SettlementStep[] {
  const wantRider = 'riderId' in party;
  const steps: SettlementStep[] = [];

  for (const e of entries) {
    for (const position of [e.item, e.fee]) {
      const step = position?.next;
      if (!step || step.amount <= 0) continue;
      if (wantRider) {
        if (step.party !== 'Rider' || e.delivery.riderId !== party.riderId) continue;
      } else {
        if (step.party !== 'Merchant' || e.delivery.merchantId !== party.merchantId) continue;
      }
      steps.push(step);
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/**
 * The figures across a set of rows.
 *
 * Split by who has to do something about it rather than by column, because that
 * is the only split that turns into an action: rider floats get remitted,
 * merchant invoices get raised, cash we are already holding gets paid out, and
 * anything in flight gets left alone until the parcel lands.
 */
export interface LedgerTotals {
  deliveries: number;
  /** Collected cash-on-delivery a rider is still carrying. */
  cashWithRidersForMerchants: number;
  /** Fees collected at the door and not yet remitted. */
  cashWithRidersForUs: number;
  /** The two above — the whole rider float. */
  cashWithRiders: number;
  /** Remitted cash-on-delivery we are holding, owed onward to merchants. */
  heldForMerchants: number;
  /** Everything owed to merchants, whoever is holding it. */
  owedToMerchants: number;
  /** Fees on merchant accounts for completed deliveries. Invoice these. */
  merchantInvoicesDue: number;
  /** Fees on merchant accounts for deliveries still in flight. Not chaseable yet. */
  merchantFeesAccruing: number;
  /** Cash-on-delivery the rider has yet to collect. */
  codAwaitingCollection: number;
  /** Fees the rider has yet to collect from customers. */
  feesAwaitingCollection: number;
  /** Goods the merchant was already paid for. Informational — never ours. */
  prepaidWithMerchants: number;
  /** Cash-on-delivery takings we have paid out. Settled. */
  goodsPaidToMerchants: number;
  /** Fees that have reached us. Settled. */
  feesCollected: number;
  /** Every delivery fee on these rows, whoever settles it. */
  feeTotal: number;
  /** Every declared goods value on these rows. */
  goodsTotal: number;
  /** Everything above that still has to move, from any direction. */
  outstanding: number;
  /** Rows where every sum has finished travelling. */
  clearedRows: number;
  /** Rows filed before payment terms existed — nothing can be said about them. */
  untracked: number;
}

export function ledgerTotals(entries: LedgerEntry[]): LedgerTotals {
  const t: LedgerTotals = {
    deliveries: entries.length,
    cashWithRidersForMerchants: 0,
    cashWithRidersForUs: 0,
    cashWithRiders: 0,
    heldForMerchants: 0,
    owedToMerchants: 0,
    merchantInvoicesDue: 0,
    merchantFeesAccruing: 0,
    codAwaitingCollection: 0,
    feesAwaitingCollection: 0,
    prepaidWithMerchants: 0,
    goodsPaidToMerchants: 0,
    feesCollected: 0,
    feeTotal: 0,
    goodsTotal: 0,
    outstanding: 0,
    clearedRows: 0,
    untracked: 0,
  };

  for (const e of entries) {
    t.feeTotal += e.delivery.price || 0;
    t.goodsTotal += e.delivery.declaredValue || 0;
    t.outstanding += e.outstanding;
    if (e.untracked) t.untracked += 1;
    if (e.cleared) t.clearedRows += 1;

    if (e.item) {
      // Keyed on the term rather than on `settled`, which now covers a COD
      // position that has been paid out as well as a prepaid one.
      if (e.delivery.itemPayment === 'Prepaid') t.prepaidWithMerchants += e.item.amount;
      else if (e.item.settled) t.goodsPaidToMerchants += e.item.amount;
      else if (e.item.holder === 'Rider') t.cashWithRidersForMerchants += e.item.amount;
      else if (e.item.holder === 'SomoExpress') t.heldForMerchants += e.item.amount;
      else t.codAwaitingCollection += e.item.amount;
    }

    if (e.fee) {
      if (e.fee.settled) t.feesCollected += e.fee.amount;
      else if (e.fee.holder === 'Rider') t.cashWithRidersForUs += e.fee.amount;
      else if (e.fee.holder === 'Merchant') {
        if (e.fee.inFlight) t.merchantFeesAccruing += e.fee.amount;
        else t.merchantInvoicesDue += e.fee.amount;
      } else t.feesAwaitingCollection += e.fee.amount;
    }
  }

  t.cashWithRiders = t.cashWithRidersForMerchants + t.cashWithRidersForUs;
  t.owedToMerchants = t.cashWithRidersForMerchants + t.heldForMerchants;
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
 * Only un-remitted positions: once a rider hands their float in, they drop off
 * this table, which is the entire point of recording it.
 *
 * Keyed on the rider id where there is one and on the snapshotted name
 * otherwise: a rider removed from the roster leaves `rider_id` null on their old
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
  /** Cash-on-delivery takings owed to them, whoever is holding it. */
  weOweThem: number;
  /** Of that, the part we are already holding and could pay out today. */
  readyToPayOut: number;
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
      readyToPayOut: 0,
      feeTotal: 0,
      net: 0,
    };

    row.deliveries += 1;
    row.feeTotal += d.price || 0;
    if (e.fee && e.fee.holder === 'Merchant' && !e.fee.inFlight && !e.fee.settled) {
      row.owesUs += e.fee.amount;
    }
    if (e.item && e.item.owedTo === 'Merchant' && !e.item.settled && !e.item.inFlight) {
      row.weOweThem += e.item.amount;
      if (e.item.holder === 'SomoExpress') row.readyToPayOut += e.item.amount;
    }
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
 * merchant invoices, pay merchants the takings we are already holding, or leave
 * the in-flight rows alone.
 */
export type LedgerFocus =
  | 'all'
  | 'outstanding'
  | 'rider-cash'
  | 'merchant-owes'
  | 'to-pay-out'
  | 'owed-to-merchant'
  | 'in-flight'
  | 'settled'
  | 'no-terms';

export const LEDGER_FOCUSES: { value: LedgerFocus; label: string; hint: string }[] = [
  { value: 'all', label: 'Everything', hint: 'Every delivery in range' },
  {
    value: 'outstanding',
    label: 'Anything outstanding',
    hint: 'Every row with money still to move, in either direction',
  },
  {
    value: 'rider-cash',
    label: 'Cash with riders',
    hint: 'Collected at the door and not yet remitted',
  },
  {
    value: 'merchant-owes',
    label: 'Merchant invoices due',
    hint: 'Completed deliveries whose fee is on the merchant account, unpaid',
  },
  {
    value: 'to-pay-out',
    label: 'Ready to pay out',
    hint: 'Takings we are holding that a merchant is owed',
  },
  {
    value: 'owed-to-merchant',
    label: 'Owed to merchants',
    hint: 'Cash on delivery collected, whoever is holding it',
  },
  {
    value: 'in-flight',
    label: 'Not collected yet',
    hint: 'Money that only moves once the parcel is handed over',
  },
  { value: 'settled', label: 'Fully settled', hint: 'Rows where nothing is left to move' },
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
    case 'outstanding':
      return e.outstanding > 0;
    case 'rider-cash':
      return e.item?.holder === 'Rider' || e.fee?.holder === 'Rider';
    case 'merchant-owes':
      return e.fee?.holder === 'Merchant' && !e.fee.inFlight && !e.fee.settled;
    case 'to-pay-out':
      return e.item?.holder === 'SomoExpress' && !e.item.settled;
    case 'owed-to-merchant':
      return !!e.item && e.item.owedTo === 'Merchant' && !e.item.settled && !e.item.inFlight;
    case 'in-flight':
      return (!!e.item && e.item.inFlight) || (!!e.fee && e.fee.inFlight);
    case 'settled':
      return e.cleared;
    case 'no-terms':
      return e.untracked;
  }
}
