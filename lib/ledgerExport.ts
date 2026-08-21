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
//   Summary   the totals, the rider float, and each merchant's position
//   Ledger    one row per delivery, with both money positions spelled out
//
// Amounts are written as numbers with a currency format rather than as "GHS
// 51.25" strings, so every column can be summed and sorted — the same rule
// lib/deliveryExport.ts follows, and the whole reason the file is worth having
// over a screenshot of the table.

import writeXlsxFile, { getSheetData } from 'write-excel-file/node';
import type { CellObject, Column, Row, SheetData } from 'write-excel-file/node';
import { shortId } from './format';
import {
  COMPANY,
  ledgerTotals,
  merchantBalances,
  riderFloat,
  type LedgerEntry,
} from './ledger';

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
    { header: header('Order #'), width: 10, cell: ({ delivery }) => shortId(delivery.id) },
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
    { header: header('Goods value'), width: 15, cell: ({ delivery }) => money(delivery.declaredValue || 0) },
    { header: header('Goods held by'), width: 22, cell: ({ item }) => item?.holderLabel ?? null },
    {
      header: header('Goods owed to'),
      width: 22,
      // Blank rather than 'Nobody' when the money is already home: an empty cell
      // filters and counts correctly, a word for "nothing" does not.
      cell: ({ item }) => (item && item.owedTo ? item.owedTo : null),
    },
    { header: header('Goods note'), width: 52, cell: ({ item }) => item?.detail ?? null },

    // --- the fee ---------------------------------------------------------
    {
      header: header('Fee paid by'),
      width: 13,
      cell: ({ delivery }) => delivery.deliveryPaidBy || null,
    },
    { header: header('Delivery fee'), width: 15, cell: ({ delivery }) => money(delivery.price || 0) },
    { header: header('Fee held by'), width: 22, cell: ({ fee }) => fee?.holderLabel ?? null },
    {
      header: header('Fee owed to'),
      width: 22,
      cell: ({ fee }) => (fee && fee.owedTo ? fee.owedTo : null),
    },
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
    [],
    heading('Money that has to move'),
    line('Cash with riders, owed to merchants', totals.cashWithRidersForMerchants),
    line(`Cash with riders, owed to ${COMPANY}`, totals.cashWithRidersForUs),
    line('Rider float, total', totals.cashWithRiders),
    line(`Merchant invoices due to ${COMPANY}`, totals.merchantInvoicesDue),
    line('Total outstanding', totals.outstanding),
    [],
    heading('Not collected yet'),
    line('Cash on delivery still to collect', totals.codAwaitingCollection),
    line('Fees still to collect at the door', totals.feesAwaitingCollection),
    line('Merchant fees accruing on open deliveries', totals.merchantFeesAccruing),
    [],
    heading('For information'),
    line('Prepaid goods, already with merchants', totals.prepaidWithMerchants),
    line('Delivery fees in this period', totals.feeTotal),
    line('Declared goods value in this period', totals.goodsTotal),
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
      ],
      ...floats.map((f): Row => [
        f.riderName,
        count(f.deliveries),
        money(f.forMerchants),
        money(f.forUs),
        money(f.total),
      ]),
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

export async function ledgerToXlsx(
  entries: LedgerEntry[],
  opts: LedgerExportOptions
): Promise<Buffer> {
  const columns = columnsFor(opts);

  return writeXlsxFile([
    {
      sheet: 'Summary',
      data: summarySheet(entries, opts),
      // Wide enough for the longest label on the left and the money on the right.
      columns: [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }],
    },
    {
      sheet: 'Ledger',
      // getSheetData is what turns the object columns above into raw rows; the
      // multi-sheet form of writeXlsxFile takes data, not objects.
      data: getSheetData(entries, columns),
      columns: columns.map((c) => ({ width: c.width })),
      stickyRowsCount: 1,
    },
  ]).toBuffer();
}

/** e.g. somoexpress-ledger-2026-08-21.xlsx */
export function ledgerFileName(now: Date = new Date()): string {
  return `somoexpress-ledger-${now.toISOString().slice(0, 10)}.xlsx`;
}
