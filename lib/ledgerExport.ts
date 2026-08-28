// The ledger as an .xlsx workbook.
//
// Separate from lib/deliveryExport.ts rather than another flag on it, because
// the two answer different questions and would otherwise fight over the same
// column list. The delivery export is the operational record — milestones, surge
// charges, the trail of who confirmed what. This one is the money: every row
// says which of the two sums is in whose hands, and it carries a second sheet of
// totals so the figures can be read without re-deriving them in Excel.
//
// Two sheets, because a finance person opening this wants the headline first and
// the workings second:
//
//   Summary       the totals, the rider float, and each merchant's position
//   Ledger        one row per delivery, with both money positions spelled out
//   Settlements   the remittance book: what was paid, by whom, against what
//
// Amounts are written as numbers with a currency format rather than as "GHS
// 51.25" strings, so every column can be summed and sorted — the same rule
// lib/deliveryExport.ts follows, and the whole reason the file is worth having
// over a screenshot of the table.

import writeXlsxFile, { getSheetData } from 'write-excel-file/node';
import type { CellObject, Column, Row, SheetData } from 'write-excel-file/node';
import { orderNo } from './format';
import {
  COMPANY,
  FLOAT_DEADLINE_HOURS,
  ledgerTotals,
  merchantBalances,
  riderFloat,
  type LedgerEntry,
  type LedgerPosition,
} from './ledger';
import type { SettlementRecord } from './settlements';

const MONEY = '"GHS" #,##0.00';

const HEADER = {
  fontWeight: 'bold',
  backgroundColor: '#f2f2f2',
  align: 'left',
} as const;

function header(value: string) {
  return { value, ...HEADER };
}

// Annotated as CellObject rather than inferred: a bare object literal loses the
// `NumberConstructor` narrowing that the library's Cell type wants, and only the
// cell callbacks get that narrowing from context for free.
function money(value: number): CellObject {
  return { type: Number, value, format: MONEY };
}

/** A plain whole number — job counts, delivery counts. */
function count(value: number): CellObject {
  return { type: Number, value, format: '0' };
}

export interface LedgerExportOptions {
  /**
   * Ops, admin and finance exports name the merchant on every row; a merchant's
   * own export does not, because every row would repeat their own name.
   */
  includeMerchant: boolean;
  /** Shown on the summary sheet so a filtered export says what it was filtered to. */
  scopeLabel: string;
  /**
   * Set when the workbook covers part of the period it is named for. It sits
   * directly under the title, above the first figure, because every total below
   * it is then a floor rather than a total — and a spreadsheet gets forwarded to
   * people who never saw the screen it came from.
   */
  notice?: string;
  /** The remittance book for the third sheet. Empty leaves the sheet out. */
  settlements: SettlementRecord[];
}

/**
 * Where the money sits, spelled out.
 *
 * A part-settled obligation is in more than one place, so this is a list and
 * not a single holder: 'GHS 200.00 with Kwame Mensah; GHS 300.00 with
 * SomoExpress'. Reading a spreadsheet cell is not reading a table, so the
 * amounts are spelled out rather than left to be inferred from a column.
 */
function partsSummary(position: LedgerPosition | null): string | null {
  if (!position || position.parts.length === 0) return null;
  return position.parts
    .map((part) => `GHS ${part.amount.toFixed(2)} ${part.label.toLowerCase()}`)
    .join('; ');
}

/** Who the unsettled parts are owed to, deduplicated. Blank when nobody. */
function owedSummary(position: LedgerPosition | null): string | null {
  if (!position) return null;
  const owed = [...new Set(position.parts.map((p) => p.owedTo).filter(Boolean))];
  return owed.length > 0 ? owed.join(', ') : null;
}

/** When a position cleared, or null while it is still travelling. */
function clearedOn(position: LedgerPosition | null) {
  if (!position || !position.settled) return null;
  const last = position.marks[position.marks.length - 1];
  if (!last) return null;
  const at = new Date(last.settledAt);
  return Number.isNaN(at.getTime())
    ? null
    : ({ type: Date, value: at, format: 'dd mmm yyyy' } as const);
}

function columnsFor(opts: LedgerExportOptions): Column<LedgerEntry>[] {
  const columns: Column<LedgerEntry>[] = [
    {
      header: header('Date'),
      width: 20,
      cell: ({ delivery }) => {
        const at = new Date(delivery.date);
        return Number.isNaN(at.getTime())
          ? null
          : { type: Date, value: at, format: 'dd mmm yyyy hh:mm' };
      },
    },
    { header: header('Order #'), width: 10, cell: ({ delivery }) => orderNo(delivery.id) },
  ];

  if (opts.includeMerchant) {
    columns.push(
      { header: header('Merchant'), width: 22, cell: ({ delivery }) => delivery.customer },
      {
        header: header('Merchant phone'),
        width: 16,
        // Whoever is chasing an invoice needs a number to ring, and it is already
        // on the row for ops' Notify action.
        cell: ({ delivery }) => delivery.merchantPhone || null,
      }
    );
  }

  columns.push(
    { header: header('Pickup'), width: 28, cell: ({ delivery }) => delivery.pickup },
    { header: header('Drop-off'), width: 28, cell: ({ delivery }) => delivery.dropoff },
    {
      header: header('Recipient'),
      width: 20,
      cell: ({ delivery }) => delivery.recipientName || null,
    },
    {
      header: header('Recipient phone'),
      width: 16,
      cell: ({ delivery }) => delivery.recipientPhone || null,
    },
    {
      header: header('Distance (km)'),
      width: 13,
      cell: ({ delivery }) => ({ type: Number, value: delivery.distance, format: '0.0' }),
    },
    {
      header: header('Time (min)'),
      width: 11,
      cell: ({ delivery }) =>
        delivery.durationMin > 0 ? { type: Number, value: delivery.durationMin, format: '0' } : null,
    },
    { header: header('Delivery type'), width: 13, cell: ({ delivery }) => delivery.type },
    { header: header('Item'), width: 18, cell: ({ delivery }) => delivery.itemCategory || null },
    { header: header('Status'), width: 18, cell: ({ delivery }) => delivery.status },
    { header: header('Rider'), width: 18, cell: ({ delivery }) => delivery.riderName || null },
    {
      header: header('Rider phone'),
      width: 16,
      cell: ({ delivery }) => delivery.riderPhone || null,
    },

    // --- the goods -------------------------------------------------------
    {
      header: header('Item payment'),
      width: 17,
      cell: ({ delivery }) => delivery.itemPayment || null,
    },
    { header: header('Cost of item'), width: 15, cell: ({ delivery }) => money(delivery.declaredValue || 0) },
    { header: header('Goods position'), width: 46, cell: ({ item }) => partsSummary(item) },
    {
      header: header('Goods owed to'),
      width: 22,
      // Blank rather than 'Nobody' when the money is already home: an empty cell
      // filters and counts correctly, a word for "nothing" does not.
      cell: ({ item }) => owedSummary(item),
    },
    {
      header: header('Goods remitted'),
      width: 15,
      cell: ({ item }) => (item && item.settledIn > 0 ? money(item.settledIn) : null),
    },
    {
      header: header('Goods written off'),
      width: 16,
      cell: ({ item }) => (item && item.writtenOff > 0 ? money(item.writtenOff) : null),
    },
    {
      header: header('Goods settled'),
      width: 15,
      // Blank while the money is still moving, which is what makes the column
      // filterable: non-empty means finished.
      cell: ({ item }) => clearedOn(item),
    },
    { header: header('Goods note'), width: 52, cell: ({ item }) => item?.detail ?? null },

    // --- the fee ---------------------------------------------------------
    {
      header: header('Fee paid by'),
      width: 13,
      cell: ({ delivery }) => delivery.deliveryPaidBy || null,
    },
    { header: header('Delivery fee'), width: 15, cell: ({ delivery }) => money(delivery.price || 0) },
    { header: header('Fee position'), width: 40, cell: ({ fee }) => partsSummary(fee) },
    {
      header: header('Fee owed to'),
      width: 22,
      cell: ({ fee }) => owedSummary(fee),
    },
    {
      header: header('Fee written off'),
      width: 16,
      cell: ({ fee }) => (fee && fee.writtenOff > 0 ? money(fee.writtenOff) : null),
    },
    { header: header('Fee settled'), width: 15, cell: ({ fee }) => clearedOn(fee) },
    { header: header('Fee note'), width: 52, cell: ({ fee }) => fee?.detail ?? null },

    {
      header: header('Outstanding'),
      width: 15,
      cell: ({ outstanding }) => money(outstanding),
    }
  );

  return columns;
}

/** A label row and a number, the shape every line of the summary sheet takes. */
function line(label: string, value: number, asMoney = true): Row {
  return [label, asMoney ? money(value) : count(value)];
}

function heading(text: string): Row {
  return [{ value: text, fontWeight: 'bold' }];
}

function summarySheet(entries: LedgerEntry[], opts: LedgerExportOptions): SheetData {
  const totals = ledgerTotals(entries);
  const floats = riderFloat(entries);
  const balances = merchantBalances(entries);

  const rows: SheetData = [
    heading(`${COMPANY} ledger`),
    [opts.scopeLabel],
    ...(opts.notice
      ? [[{ value: opts.notice, fontWeight: 'bold', textColor: '#9a3412', wrap: true }] as Row]
      : []),
    [],
    heading('Money that has to move'),
    line('Cash with riders, owed to merchants', totals.cashWithRidersForMerchants),
    line(`Cash with riders, owed to ${COMPANY}`, totals.cashWithRidersForUs),
    line('Rider float, total', totals.cashWithRiders),
    line(`Remitted to ${COMPANY}, owed onward to merchants`, totals.heldForMerchants),
    line('Owed to merchants, whoever is holding it', totals.owedToMerchants),
    line(`Merchant invoices due to ${COMPANY}`, totals.merchantInvoicesDue),
    line('Total outstanding', totals.outstanding),
    [],
    heading('Not collected yet'),
    line('Cash on delivery still to collect', totals.codAwaitingCollection),
    line('Fees still to collect at the door', totals.feesAwaitingCollection),
    line('Merchant fees accruing on open deliveries', totals.merchantFeesAccruing),
    [],
    heading('Settled'),
    line(`Fees that have reached ${COMPANY}`, totals.feesCollected),
    line('Cash-on-delivery takings paid to merchants', totals.goodsPaidToMerchants),
    line('Rows with nothing left to move', totals.clearedRows, false),
    [],
    heading('Written off'),
    line('Rider shortfalls charged to pay', totals.riderDebt),
    line('Fees waived on merchant accounts', totals.merchantWriteOffs),
    [],
    heading('For information'),
    line('Prepaid goods, already with merchants', totals.prepaidWithMerchants),
    line('Delivery fees in this period', totals.feeTotal),
    line('Cost of items in this period', totals.goodsTotal),
    line('Deliveries', totals.deliveries, false),
    line('Rows with no payment terms recorded', totals.untracked, false),
    [],
  ];

  if (floats.length > 0) {
    rows.push(
      heading('Rider float — cash in hand, not yet remitted'),
      [
        header('Rider'),
        header('Deliveries'),
        header('For merchants'),
        header(`For ${COMPANY}`),
        header('Total'),
        header('Held since'),
        header('Hours'),
        header(`Overdue (${FLOAT_DEADLINE_HOURS}h)`),
        header('Written off to debt'),
      ],
      ...floats.map((f): Row => {
        const since = f.oldestSince ? new Date(f.oldestSince) : null;
        return [
          f.riderName,
          count(f.deliveries),
          money(f.forMerchants),
          money(f.forUs),
          money(f.total),
          since && !Number.isNaN(since.getTime())
            ? { type: Date, value: since, format: 'dd mmm yyyy hh:mm' }
            : null,
          f.oldestSince ? count(f.hoursHeld) : null,
          // The word, not TRUE: a filter on 'OVERDUE' reads as itself in a
          // column somebody is scanning for trouble.
          f.overdue ? 'OVERDUE' : null,
          f.writtenOff > 0 ? money(f.writtenOff) : null,
        ];
      }),
      []
    );
  }

  if (opts.includeMerchant && balances.length > 0) {
    rows.push(
      heading('Merchant positions'),
      [
        header('Merchant'),
        header('Deliveries'),
        header(`Owes ${COMPANY}`),
        header('We owe them'),
        header('Net'),
        header('Fees in period'),
      ],
      ...balances.map((b): Row => [
        b.name,
        count(b.deliveries),
        money(b.owesUs),
        money(b.weOweThem),
        money(b.net),
        money(b.feeTotal),
      ])
    );
  }

  return rows;
}

/**
 * The remittance book as its own sheet.
 *
 * Voided settlements stay in, marked. "We recorded this and then unwound it, here
 * is who and why" is the thing a sheet that quietly omitted them could not say,
 * and it is the first question anyone reconciling will ask.
 */
function settlementsSheet(settlements: SettlementRecord[]): SheetData {
  const rows: SheetData = [
    [
      header('Date'),
      header('With'),
      header('Kind'),
      header(`In to ${COMPANY}`),
      header('Out'),
      header('How'),
      header('Written off'),
      header('Reference'),
      header('Orders'),
      header('Recorded by'),
      header('Voided'),
      header('Void reason'),
      header('Note'),
    ],
  ];

  for (const s of settlements) {
    const at = new Date(s.settledAt);
    const voided = s.voidedAt ? new Date(s.voidedAt) : null;
    rows.push([
      Number.isNaN(at.getTime()) ? null : { type: Date, value: at, format: 'dd mmm yyyy hh:mm' },
      s.riderName || s.merchantName || null,
      s.riderName ? 'Rider remittance' : 'Merchant settlement',
      s.totalIn > 0 ? money(s.totalIn) : null,
      s.totalOut > 0 ? money(s.totalOut) : null,
      s.method || null,
      s.totalWrittenOff > 0 ? money(s.totalWrittenOff) : null,
      s.reference || null,
      s.lines
        .map(
          (l) =>
            `${l.orderNo} ${l.stream}/${l.leg}${l.kind === 'writeoff' ? ' (written off)' : ''} GHS ${l.amount.toFixed(2)}`
        )
        .join(', ') || null,
      s.recordedByName || null,
      voided && !Number.isNaN(voided.getTime())
        ? { type: Date, value: voided, format: 'dd mmm yyyy' }
        : null,
      s.voidReason || null,
      s.note || null,
    ]);
  }

  return rows;
}

export async function ledgerToXlsx(
  entries: LedgerEntry[],
  opts: LedgerExportOptions
): Promise<Buffer> {
  const columns = columnsFor(opts);

  const sheets: Parameters<typeof writeXlsxFile>[0] = [
    {
      sheet: 'Summary',
      data: summarySheet(entries, opts),
      // Wide enough for the longest label on the left and the money on the right.
      columns: [
        { width: 46 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 20 },
        { width: 22 },
        { width: 10 },
        { width: 20 },
      ],
    },
    {
      sheet: 'Ledger',
      // getSheetData is what turns the object columns above into raw rows; the
      // multi-sheet form of writeXlsxFile takes data, not objects.
      data: getSheetData(entries, columns),
      columns: columns.map((c) => ({ width: c.width })),
      stickyRowsCount: 1,
    },
  ];

  if (opts.settlements.length > 0) {
    sheets.push({
      sheet: 'Settlements',
      data: settlementsSheet(opts.settlements),
      columns: [
        { width: 20 },
        { width: 22 },
        { width: 20 },
        { width: 16 },
        { width: 16 },
        { width: 15 },
        { width: 16 },
        { width: 20 },
        { width: 54 },
        { width: 18 },
        { width: 14 },
        { width: 30 },
        { width: 30 },
      ],
      stickyRowsCount: 1,
    });
  }

  return writeXlsxFile(sheets).toBuffer();
}

/** e.g. somoexpress-ledger-2026-08-21.xlsx */
export function ledgerFileName(now: Date = new Date()): string {
  return `somoexpress-ledger-${now.toISOString().slice(0, 10)}.xlsx`;
}
