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
// Legs settle in **parts**, which is why a position is a breakdown rather than a
// single holder. A rider who owes GHS 500 and hands in GHS 300 leaves that
// obligation in two places at once: GHS 200 still with them, GHS 300 with us and
// owed onward. Those are two different people's jobs, so they are two entries in
// `parts` and two entries in `steps`.
//
// What is derived and what is stored: the *positions* are derived on every read
// from the delivery row plus its settlement lines, and never stored. The
// *settlements* are stored, because a rider handing cash over is an event in the
// world that nothing else in the database records. See the settlements migrations
// for why the writes are functions rather than policies.
//
// The types live here rather than in lib/types.ts because they exist only to
// describe the output of the functions beside them.

import type { Delivery, DeliveryWithMerchant } from './types';

/** Us. Named once so the sentences below read like sentences. */
export const COMPANY = 'SomoExpress';

/**
 * How long a rider may hold cash before they stop being assignable.
 *
 * The twin of `private.float_deadline()` in the partial-settlements migration,
 * which is the one that actually refuses the assignment. This one drives the
 * display — the countdown, the overdue badge, the disabled option in the log's
 * rider dropdown. If you change one, change the other.
 */
export const FLOAT_DEADLINE_HOURS = 48;

/** Which of a delivery's two sums. */
export type SettlementStream = 'goods' | 'fee';

/** Money reaching us, or money leaving us. */
export type SettlementLeg = 'in' | 'out';

/**
 * Whether the money actually arrived.
 *
 * 'writeoff' closes an obligation that is not going to be met — a rider's
 * shortfall, or a fee a merchant is not going to pay. It counts as inbound, which
 * has one consequence worth knowing: it makes the merchant's full amount payable
 * onward. If a rider loses GHS 240 of a merchant's takings the merchant is still
 * owed all of it; the GHS 240 becomes the rider's debt to us.
 */
export type SettlementKind = 'payment' | 'writeoff';

/** Who physically has the money at this moment. */
export type MoneyHolder = 'Rider' | 'Merchant' | 'Customer' | 'SomoExpress';

/** Who it has to end up with. Null when it is already there. */
export type MoneyOwedTo = 'Merchant' | 'SomoExpress' | null;

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

/**
 * A leg, or part of one, that has been settled.
 *
 * `reference` and `method` come from the settlement header, which a merchant
 * cannot always read — a rider's remittance covers several merchants at once, so
 * its paperwork is internal. They are '' in that case, and `settledAt` is
 * snapshotted onto the line itself precisely so the merchant's own ledger can
 * still say when their position moved.
 */
export interface SettlementMark {
  stream: SettlementStream;
  leg: SettlementLeg;
  kind: SettlementKind;
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
 * A leg that could be recorded right now, and for how much.
 *
 * The rule lives here so the ledger, the settle dialog and the export all agree
 * on what is settleable. `record_settlement` in the database enforces the same
 * bound independently — this is what stops the UI offering an action that would
 * be refused, not what makes the refusal happen.
 */
export interface SettlementStep {
  deliveryId: string;
  stream: SettlementStream;
  leg: SettlementLeg;
  /** The counterparty of a settlement that would record this leg. */
  party: 'Rider' | 'Merchant';
  /** What is still owed on this leg — the most that can be recorded. */
  amount: number;
  /** The whole obligation, for "GHS 300 of GHS 500" in the dialog. */
  obligation: number;
  /** One line for the confirm list, e.g. 'Cash collected for the goods'. */
  label: string;
}

/** One place a slice of an obligation currently sits. */
export interface MoneyPart {
  amount: number;
  holder: MoneyHolder;
  owedTo: MoneyOwedTo;
  /** Short cell text — 'With Kwame Mensah', 'On merchant account'. */
  label: string;
  /** The obligation, or '' when there is none. */
  owedLabel: string;
}

/**
 * One sum of money on one delivery, broken down by where it sits.
 *
 * `parts` always sums to `amount`: it describes this obligation and nothing else.
 * A write-off is deliberately *not* in there — it is a claim against the rider,
 * not a slice of the merchant's money — so it sits in `writtenOff` and is shown
 * beside the parts rather than among them.
 */
export interface LedgerPosition {
  /** The full obligation. */
  amount: number;
  /** Settled on the inbound leg so far, payments and write-offs together. */
  settledIn: number;
  /** Paid onward. Always 0 for a fee, which has no outbound leg. */
  settledOut: number;
  /** Of `settledIn`, the part that never arrived and was charged to somebody. */
  writtenOff: number;
  /** Nothing left to move. */
  settled: boolean;
  /** The handover has not happened, so nothing has moved yet. */
  inFlight: boolean;
  parts: MoneyPart[];
  /** Legs recordable right now. Can be two for a part-remitted goods position. */
  steps: SettlementStep[];
  marks: SettlementMark[];
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

/**
 * When the money reached the rider's hands — the clock the deadline runs on.
 *
 * The first three are real records of a handover. `date` (created_at) is the
 * fallback for a row ops marked delivered by hand with no timestamp at all, and
 * it can only overstate the age, which errs toward chasing sooner. The SQL twin
 * is `private.delivery_handover_at`.
 */
export function handoverAt(d: Delivery): string {
  return d.recipientConfirmedAt || d.deliveredAt || d.pickedUpAt || d.date;
}

/** Whole hours since an ISO timestamp. 0 for anything unparseable. */
export function hoursSince(iso: string, now: Date = new Date()): number {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3_600_000));
}

/** What the rider is called on this row, or a stand-in before assignment. */
function riderOf(d: Delivery): string {
  return d.riderName || 'the rider';
}

function sumMarks(
  marks: SettlementMark[],
  stream: SettlementStream,
  leg: SettlementLeg,
  kind?: SettlementKind
): number {
  return marks
    .filter((m) => m.stream === stream && m.leg === leg && (!kind || m.kind === kind))
    .reduce((total, m) => total + m.amount, 0);
}

/** 'on 21 Aug, cash, ref 4471' — the tail of a settled position's sentence. */
function markSentence(mark: SettlementMark): string {
  const when = new Date(mark.settledAt);
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return [date && `on ${date}`, mark.method && mark.method.toLowerCase(), mark.reference && `ref ${mark.reference}`]
    .filter(Boolean)
    .join(', ');
}

/** GHS, plainly, for the sentences below. Display formatting lives in lib/format. */
function ghs(n: number): string {
  return `GHS ${n.toFixed(2)}`;
}

/** Money for the goods. */
export function itemPosition(d: Delivery, marks: SettlementMark[] = []): LedgerPosition | null {
  if (!d.itemPayment) return null;
  const amount = d.declaredValue || 0;
  const empty = { settledIn: 0, settledOut: 0, writtenOff: 0, marks, steps: [] };

  if (d.itemPayment === 'Prepaid') {
    return {
      ...empty,
      amount,
      settled: true,
      inFlight: false,
      parts: [
        {
          amount,
          holder: 'Merchant',
          owedTo: null,
          label: 'With merchant',
          owedLabel: '',
        },
      ],
      detail: `Prepaid — the customer paid ${d.customer} before the parcel left, so none of this money passes through ${COMPANY}.`,
    };
  }

  if (!handedOver(d)) {
    return {
      ...empty,
      amount,
      settled: false,
      inFlight: true,
      parts: [
        {
          amount,
          holder: 'Customer',
          owedTo: 'Merchant',
          label: 'Still with customer',
          owedLabel: `for ${d.customer}`,
        },
      ],
      detail: `Cash on delivery — nothing collected yet. ${riderOf(d)} takes it on handover, and it belongs to ${d.customer}.`,
    };
  }

  const settledIn = sumMarks(marks, 'goods', 'in');
  const settledOut = sumMarks(marks, 'goods', 'out');
  const writtenOff = sumMarks(marks, 'goods', 'in', 'writeoff');

  const withRider = Math.max(0, amount - settledIn);
  const heldForMerchant = Math.max(0, settledIn - settledOut);
  const paidOut = settledOut;

  const parts: MoneyPart[] = [];
  const steps: SettlementStep[] = [];

  if (withRider > 0) {
    parts.push({
      amount: withRider,
      holder: 'Rider',
      owedTo: 'Merchant',
      label: `With ${riderOf(d)}`,
      owedLabel: `owed to ${d.customer}`,
    });
    steps.push({
      deliveryId: d.id,
      stream: 'goods',
      leg: 'in',
      party: 'Rider',
      amount: withRider,
      obligation: amount,
      label: 'Cash collected for the goods',
    });
  }

  if (heldForMerchant > 0) {
    parts.push({
      amount: heldForMerchant,
      holder: 'SomoExpress',
      owedTo: 'Merchant',
      label: `With ${COMPANY}`,
      owedLabel: `owed to ${d.customer}`,
    });
    steps.push({
      deliveryId: d.id,
      stream: 'goods',
      leg: 'out',
      party: 'Merchant',
      amount: heldForMerchant,
      obligation: amount,
      label: 'Cash-on-delivery takings owed to the merchant',
    });
  }

  if (paidOut > 0) {
    parts.push({
      amount: paidOut,
      holder: 'Merchant',
      owedTo: null,
      label: 'Paid to merchant',
      owedLabel: '',
    });
  }

  const last = marks[marks.length - 1];
  const detail =
    withRider > 0 && settledIn > 0
      ? `Part-remitted: ${ghs(settledIn)} of ${ghs(amount)} handed in, ${ghs(withRider)} still with ${riderOf(d)}.`
      : withRider > 0
        ? `Cash on delivery, collected at the door — ${riderOf(d)} is carrying it, and it belongs to ${d.customer}.`
        : heldForMerchant > 0
          ? `${riderOf(d)} remitted this${last ? ` ${markSentence(last)}` : ''}. ${COMPANY} is holding it, and it is owed to ${d.customer}.`
          : `Collected and settled — ${d.customer} was paid their takings${last ? ` ${markSentence(last)}` : ''}.`;

  return {
    amount,
    settledIn,
    settledOut,
    writtenOff,
    settled: withRider <= 0 && heldForMerchant <= 0,
    inFlight: false,
    parts,
    steps,
    marks,
    detail:
      writtenOff > 0
        ? `${detail} ${ghs(writtenOff)} of it was written off and charged to ${riderOf(d)}.`
        : detail,
  };
}

/** The delivery fee — our revenue, and the half most often owed to us. */
export function feePosition(d: Delivery, marks: SettlementMark[] = []): LedgerPosition | null {
  if (!d.deliveryPaidBy) return null;
  const amount = d.price || 0;
  const done = handedOver(d);
  const merchantPays = d.deliveryPaidBy === 'Merchant';

  const settledIn = sumMarks(marks, 'fee', 'in');
  const writtenOff = sumMarks(marks, 'fee', 'in', 'writeoff');
  const received = Math.max(0, settledIn - writtenOff);
  const outstanding = Math.max(0, amount - settledIn);

  const parts: MoneyPart[] = [];
  const steps: SettlementStep[] = [];

  if (outstanding > 0) {
    // Who is sitting on it depends on the term and on whether the parcel landed.
    const holder: MoneyHolder = merchantPays ? 'Merchant' : done ? 'Rider' : 'Customer';
    parts.push({
      amount: outstanding,
      holder,
      owedTo: 'SomoExpress',
      label: merchantPays
        ? 'On merchant account'
        : done
          ? `With ${riderOf(d)}`
          : 'Customer pays rider',
      owedLabel: merchantPays ? `${d.customer} owes ${COMPANY}` : `owed to ${COMPANY}`,
    });

    // Nothing is recordable until the parcel has actually been handed over.
    if (done) {
      steps.push({
        deliveryId: d.id,
        stream: 'fee',
        leg: 'in',
        party: merchantPays ? 'Merchant' : 'Rider',
        amount: outstanding,
        obligation: amount,
        label: merchantPays
          ? 'Delivery fee billed to the merchant'
          : 'Delivery fee collected at the door',
      });
    }
  }

  if (received > 0) {
    parts.push({
      amount: received,
      // Ours on arrival: there is no onward leg for a fee.
      holder: 'SomoExpress',
      owedTo: null,
      label: 'Paid',
      owedLabel: '',
    });
  }

  if (writtenOff > 0) {
    // Not a part of the obligation any more, but it has to appear somewhere or
    // the parts would not sum to the amount.
    parts.push({
      amount: writtenOff,
      holder: 'SomoExpress',
      owedTo: null,
      label: 'Written off',
      owedLabel: '',
    });
  }

  const last = marks[marks.length - 1];
  const detail = merchantPays
    ? outstanding > 0
      ? done
        ? `The fee is on the account of ${d.customer} and the delivery is complete — invoice it and collect.`
        : `The fee goes on the account of ${d.customer} once this delivery completes.`
      : `${d.customer} settled this fee${last ? ` ${markSentence(last)}` : ''}.`
    : outstanding > 0
      ? done
        ? `The customer paid the fee to ${riderOf(d)} at the door, so the rider is holding money belonging to ${COMPANY}.`
        : `The customer pays the fee to ${riderOf(d)} on handover — nothing collected yet.`
      : `Collected at the door and remitted${last ? ` ${markSentence(last)}` : ''}.`;

  return {
    amount,
    settledIn,
    settledOut: 0,
    writtenOff,
    settled: outstanding <= 0,
    inFlight: !done && outstanding > 0,
    parts,
    steps,
    marks,
    detail:
      writtenOff > 0 ? `${detail} ${ghs(writtenOff)} of it was written off.` : detail,
  };
}

export function toLedgerEntry(
  delivery: DeliveryWithMerchant,
  marks: SettlementMark[] = []
): LedgerEntry {
  const item = itemPosition(delivery, marks);
  const fee = feePosition(delivery, marks);

  // What still has to move, which for a part-settled goods position is the
  // rider's remainder plus what we owe onward.
  const outstanding =
    (item ? item.parts.filter((p) => p.owedTo).reduce((sum, p) => sum + p.amount, 0) : 0) +
    (fee ? fee.parts.filter((p) => p.owedTo).reduce((sum, p) => sum + p.amount, 0) : 0);

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
 * A write-off that is the rider's debt, on this row.
 *
 * Cash-on-delivery money and a fee the customer paid at the door were both in the
 * rider's hands, so a shortfall on either is theirs. A fee written off on a
 * merchant's account never touched a rider — that is a concession to the
 * merchant, and it is counted separately.
 */
export function riderDebtOn(e: LedgerEntry): number {
  const goods = e.item?.writtenOff ?? 0;
  const fee = e.delivery.deliveryPaidBy === 'Customer' ? (e.fee?.writtenOff ?? 0) : 0;
  return goods + fee;
}

/** A fee waived on a merchant's account. Never a rider's problem. */
export function merchantWriteOffOn(e: LedgerEntry): number {
  return e.delivery.deliveryPaidBy === 'Merchant' ? (e.fee?.writtenOff ?? 0) : 0;
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
      for (const step of position?.steps ?? []) {
        if (step.amount <= 0) continue;
        if (wantRider) {
          if (step.party !== 'Rider' || e.delivery.riderId !== party.riderId) continue;
        } else {
          if (step.party !== 'Merchant' || e.delivery.merchantId !== party.merchantId) continue;
        }
        steps.push(step);
      }
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
 * merchant invoices get raised, cash we already hold gets paid out, shortfalls
 * get deducted from pay, and anything in flight gets left alone until the parcel
 * lands.
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
  /** Shortfalls charged to riders — a deduction from pay, not a loss. */
  riderDebt: number;
  /** Fees waived on merchant accounts. A loss. */
  merchantWriteOffs: number;
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
    riderDebt: 0,
    merchantWriteOffs: 0,
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
    t.riderDebt += riderDebtOn(e);
    t.merchantWriteOffs += merchantWriteOffOn(e);
    if (e.untracked) t.untracked += 1;
    if (e.cleared) t.clearedRows += 1;

    if (e.item) {
      if (e.delivery.itemPayment === 'Prepaid') {
        t.prepaidWithMerchants += e.item.amount;
      } else {
        // Summing the parts rather than branching on a single holder, which is
        // what makes a part-remitted position land in two buckets at once.
        for (const part of e.item.parts) {
          if (part.holder === 'Rider') t.cashWithRidersForMerchants += part.amount;
          else if (part.holder === 'SomoExpress') t.heldForMerchants += part.amount;
          else if (part.holder === 'Customer') t.codAwaitingCollection += part.amount;
          else t.goodsPaidToMerchants += part.amount;
        }
      }
    }

    if (e.fee) {
      for (const part of e.fee.parts) {
        if (part.holder === 'Rider') t.cashWithRidersForUs += part.amount;
        else if (part.holder === 'Customer') t.feesAwaitingCollection += part.amount;
        else if (part.holder === 'Merchant') {
          if (e.fee.inFlight) t.merchantFeesAccruing += part.amount;
          else t.merchantInvoicesDue += part.amount;
        } else t.feesCollected += part.amount;
      }
    }
  }

  t.cashWithRiders = t.cashWithRidersForMerchants + t.cashWithRidersForUs;
  t.owedToMerchants = t.cashWithRidersForMerchants + t.heldForMerchants;
  return t;
}

// ---------------------------------------------------------------------------
// Who is holding what, and for how long
// ---------------------------------------------------------------------------

/** One rider's float — what they are carrying, for whom, and since when. */
export interface RiderFloat {
  riderId: string;
  riderName: string;
  /** Deliveries with money still in their hands. */
  deliveries: number;
  forMerchants: number;
  forUs: number;
  total: number;
  /** Shortfalls already charged to them. Out of the float, into their debt. */
  writtenOff: number;
  /** Handover time of the oldest thing still in their hands. '' when nothing is. */
  oldestSince: string;
  /** Whole hours they have held that oldest amount. */
  hoursHeld: number;
  /** Hours left before the deadline. Negative once it has passed. */
  hoursLeft: number;
  /**
   * Past the deadline, so the database will refuse to assign them anything new.
   * See `private.block_overdue_rider_assignment`.
   */
  overdue: boolean;
}

/**
 * Cash currently in rider hands, most overdue first, then biggest.
 *
 * Only un-remitted money: once a rider hands their float in, they drop off this
 * table, which is the entire point of recording it. A written-off shortfall also
 * leaves the float — the decision has been made and charged to them — so writing
 * one off is the honest way to unblock a rider who cannot produce the cash.
 *
 * Keyed on the rider id where there is one and on the snapshotted name otherwise:
 * a rider removed from the roster leaves `rider_id` null on their old rows, and
 * the money they were carrying does not stop existing because their roster entry
 * did.
 */
export function riderFloat(entries: LedgerEntry[], now: Date = new Date()): RiderFloat[] {
  const byRider = new Map<string, RiderFloat>();

  const rowFor = (d: DeliveryWithMerchant): RiderFloat => {
    const key = d.riderId || `name:${d.riderName}`;
    const existing = byRider.get(key);
    if (existing) return existing;
    const fresh: RiderFloat = {
      riderId: d.riderId,
      riderName: d.riderName || 'Unnamed rider',
      deliveries: 0,
      forMerchants: 0,
      forUs: 0,
      total: 0,
      writtenOff: 0,
      oldestSince: '',
      hoursHeld: 0,
      hoursLeft: FLOAT_DEADLINE_HOURS,
      overdue: false,
    };
    byRider.set(key, fresh);
    return fresh;
  };

  for (const e of entries) {
    const d = e.delivery;
    if (!d.riderId && !d.riderName) continue;

    const debt = riderDebtOn(e);
    const held = [e.item, e.fee].flatMap((position) =>
      (position?.parts ?? []).filter((p) => p.holder === 'Rider' && p.amount > 0)
    );

    if (held.length === 0 && debt === 0) continue;

    const row = rowFor(d);
    row.writtenOff += debt;

    if (held.length === 0) continue;

    row.deliveries += 1;
    for (const part of held) {
      if (part.owedTo === 'Merchant') row.forMerchants += part.amount;
      else row.forUs += part.amount;
      row.total += part.amount;
    }

    // The clock runs from the handover, not from the delivery being filed.
    const since = handoverAt(d);
    if (!row.oldestSince || since < row.oldestSince) row.oldestSince = since;
  }

  const rows = [...byRider.values()].filter((r) => r.total > 0 || r.writtenOff > 0);
  for (const row of rows) {
    row.hoursHeld = row.oldestSince ? hoursSince(row.oldestSince, now) : 0;
    row.hoursLeft = FLOAT_DEADLINE_HOURS - row.hoursHeld;
    // Only un-remitted cash blocks. A rider whose shortfall has been written off
    // owes nothing that is ageing, so they are assignable again.
    row.overdue = row.total > 0 && row.hoursHeld >= FLOAT_DEADLINE_HOURS;
  }

  return rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (b.hoursHeld !== a.hoursHeld) return b.hoursHeld - a.hoursHeld;
    return b.total - a.total;
  });
}

/** The rider ids the database will refuse to assign new deliveries to. */
export function blockedRiderIds(floats: RiderFloat[]): Set<string> {
  return new Set(floats.filter((f) => f.overdue && f.riderId).map((f) => f.riderId));
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

    if (e.fee && !e.fee.inFlight) {
      for (const part of e.fee.parts) {
        if (part.holder === 'Merchant') row.owesUs += part.amount;
      }
    }
    if (e.item && !e.item.inFlight) {
      for (const part of e.item.parts) {
        if (part.owedTo !== 'Merchant') continue;
        row.weOweThem += part.amount;
        if (part.holder === 'SomoExpress') row.readyToPayOut += part.amount;
      }
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
 * Each one is an action rather than a category: chase the overdue floats, remit
 * the rest, raise the merchant invoices, pay merchants the takings we are already
 * holding, or leave the in-flight rows alone.
 */
export type LedgerFocus =
  | 'all'
  | 'outstanding'
  | 'overdue-float'
  | 'rider-cash'
  | 'merchant-owes'
  | 'to-pay-out'
  | 'owed-to-merchant'
  | 'written-off'
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
    value: 'overdue-float',
    label: 'Overdue rider cash',
    hint: `Held by a rider for more than ${FLOAT_DEADLINE_HOURS} hours`,
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
    value: 'written-off',
    label: 'Written off',
    hint: 'Shortfalls charged to a rider, or fees waived',
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

function holds(e: LedgerEntry, holder: MoneyHolder): boolean {
  return [e.item, e.fee].some((p) => (p?.parts ?? []).some((part) => part.holder === holder));
}

export function matchesFocus(
  e: LedgerEntry,
  focus: LedgerFocus,
  now: Date = new Date()
): boolean {
  switch (focus) {
    case 'all':
      return true;
    case 'outstanding':
      return e.outstanding > 0;
    case 'overdue-float':
      return (
        holds(e, 'Rider') && hoursSince(handoverAt(e.delivery), now) >= FLOAT_DEADLINE_HOURS
      );
    case 'rider-cash':
      return holds(e, 'Rider');
    case 'merchant-owes':
      return !!e.fee && !e.fee.inFlight && e.fee.parts.some((p) => p.holder === 'Merchant');
    case 'to-pay-out':
      return !!e.item && e.item.parts.some((p) => p.holder === 'SomoExpress' && !!p.owedTo);
    case 'owed-to-merchant':
      return (
        !!e.item && !e.item.inFlight && e.item.parts.some((p) => p.owedTo === 'Merchant')
      );
    case 'written-off':
      return (e.item?.writtenOff ?? 0) > 0 || (e.fee?.writtenOff ?? 0) > 0;
    case 'in-flight':
      return (!!e.item && e.item.inFlight) || (!!e.fee && e.fee.inFlight);
    case 'settled':
      return e.cleared;
    case 'no-terms':
      return e.untracked;
  }
}
