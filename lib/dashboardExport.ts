// The dashboard as a downloadable file — .xlsx or .csv.
//
// Separate from lib/ledgerExport.ts and lib/deliveryExport.ts for the same reason
// those two are separate from each other: they answer different questions. The
// delivery export is the operational record, one row per job. The ledger export
// is the money, one row per obligation. This one is the *counted* view — the
// figures on the dashboard, in the same groupings, so somebody can take the
// period's numbers into a spreadsheet and chart them without re-deriving
// anything.
//
// Two formats out of one description of the file
// ---------------------------------------------
// The dashboard is a stack of small tables, not one big one, and that shape does
// not survive a naive CSV. So the contents are described once as an ordered list
// of `Section`s — each a title, a column list and typed cells — and rendered
// twice:
//
//   xlsx   sections grouped onto six sheets, mirroring the dashboard's cards,
//          with numbers written as numbers under a currency/percent format so
//          every column sums and sorts
//   csv    the same sections stacked into one file, each under its own title
//          row and separated by a blank line
//
// The alternative — two builders — would have meant two places to change every
// time a tile is added to the screen, and they would have drifted within a
// release. The cost of the shared model is the small `Cell` union below; the
// benefit is that the CSV can never silently omit a figure the workbook has.
//
// Why CSV at all, when the workbook is richer: a CSV opens in anything, imports
// into anything, and diffs. The workbook is for reading; the CSV is for feeding
// something else. The CSV therefore writes plain machine-readable values — bare
// numbers, ISO dates — and states its currency in the header block, while the
// workbook carries the display formatting.

import writeXlsxFile from 'write-excel-file/node';
import type { Row, SheetData } from 'write-excel-file/node';
import {
  RANGES,
  categoryMix,
  chartDays,
  deliveryKpis,
  feePayerMix,
  itemPaymentMix,
  merchantVolume,
  perDay,
  rangeDays,
  repeatCustomers,
  riderPerformance,
  statusMix,
  topDropoffs,
  type RangeKey,
  type Tally,
} from './analytics';
import { COMPANY, ledgerTotals, toLedger } from './ledger';
import { DELIVERY_STATUSES, type DeliveryWithMerchant } from './types';

export type ExportFormat = 'xlsx' | 'csv';

export const EXPORT_FORMATS: ExportFormat[] = ['xlsx', 'csv'];

const MONEY = '"GHS" #,##0.00';

// ---------------------------------------------------------------------------
// The format-neutral cell
// ---------------------------------------------------------------------------

/**
 * One cell, described by what it *means* rather than by how it looks.
 *
 * The renderers decide the appearance: 'money' becomes a formatted number in the
 * workbook and a bare `51.25` in the CSV. Keeping the meaning here is what stops
 * the CSV from shipping "GHS 51.25" strings that nothing downstream can add up.
 */
type Cell =
  | { kind: 'text'; value: string | null }
  | { kind: 'money'; value: number }
  | { kind: 'count'; value: number }
  | { kind: 'decimal'; value: number; places: number }
  /** A whole percentage, 0–100 — not a fraction. Both renderers divide as needed. */
  | { kind: 'percent'; value: number }
  | { kind: 'date'; value: string | null; time?: boolean }
  /** A group label inside a section, spanning the row. */
  | { kind: 'heading'; value: string };

const text = (value: string | null): Cell => ({ kind: 'text', value });
const money = (value: number): Cell => ({ kind: 'money', value });
const count = (value: number): Cell => ({ kind: 'count', value });
const decimal = (value: number, places = 1): Cell => ({ kind: 'decimal', value, places });
const percent = (value: number): Cell => ({ kind: 'percent', value });
const date = (value: string | null, time = false): Cell => ({ kind: 'date', value, time });
const heading = (value: string): Cell => ({ kind: 'heading', value });

interface Column {
  header: string;
  width: number;
}

interface Section {
  title: string;
  /** Printed under the title, where the section covers less than the period does. */
  note?: string;
  /** Empty for label/value sections, which need no header row. */
  columns: Column[];
  rows: Cell[][];
}

export interface DashboardExportOptions {
  /** The period the figures cover. Drives both the label and the daily buckets. */
  range: RangeKey;
  /**
   * Ops, admin and finance exports carry the merchant league table; a merchant's
   * own export does not, because it would be one row of themselves.
   */
  includeMerchants: boolean;
  /** Shown in the header block so a filtered export says what it was filtered to. */
  scopeLabel: string;
  /**
   * Set when the file covers part of the period it is named for. It sits directly
   * above the first figure, because every count below it is then a floor rather
   * than a total — and a spreadsheet gets forwarded to people who never saw the
   * screen it came from.
   */
  notice?: string;
  /** Fixed at the call site so the workbook and its file name agree. */
  now?: Date;
}

// ---------------------------------------------------------------------------
// What the file contains
// ---------------------------------------------------------------------------

/** `count` and its share of the section's total — the pair every bar chart shows. */
function tallyRows(rows: Tally[]): Cell[][] {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => [
    text(r.label),
    count(r.count),
    percent(total > 0 ? (r.count / total) * 100 : 0),
    money(r.value),
  ]);
}

const TALLY_COLUMNS: Column[] = [
  { header: 'Label', width: 34 },
  { header: 'Deliveries', width: 12 },
  { header: 'Share', width: 10 },
  { header: 'Delivery fees', width: 15 },
];

/** A tally section, with the first column named for what it actually lists. */
function tallySection(title: string, label: string, rows: Tally[], note?: string): Section {
  return {
    title,
    note,
    columns: [{ ...TALLY_COLUMNS[0], header: label }, ...TALLY_COLUMNS.slice(1)],
    rows: tallyRows(rows),
  };
}

/**
 * The headline figures, mirroring the dashboard's tiles in the order they appear.
 *
 * Grouped with headings rather than run together: the screen groups them into
 * cards, and a flat list of twenty-eight label/value pairs is a different, worse
 * document from the one somebody pressed the button on.
 */
function overviewSection(records: DeliveryWithMerchant[]): Section {
  const kpis = deliveryKpis(records);
  const totals = ledgerTotals(toLedger(records));

  const rows: Cell[][] = [
    [heading('Volume')],
    [text('Deliveries filed'), count(kpis.total)],
    [text('Merchants'), count(kpis.merchants)],
    [text('Recipients'), count(kpis.customers)],
    [text('Handed over'), count(kpis.completed)],
    [text('Handed over (share)'), percent(kpis.completionRate)],
    [text('Still open'), count(kpis.open)],
    [text('Still open — to assign'), count(kpis.awaitingRider)],
    [text('Still open — awaiting an answer'), count(kpis.awaitingAnswer)],
    [text('Still open — on the road'), count(kpis.onTheRoad)],
    [text('Rider declines'), count(kpis.declined)],
    [text('Rider declines (share)'), percent(kpis.declineRate)],
    [],

    [heading('Fees and goods')],
    [text('Delivery fees'), money(kpis.feeTotal)],
    [text('Average fee per delivery'), money(kpis.avgFee)],
    [text('Cost of items carried'), money(kpis.goodsTotal)],
    [],

    [heading('Average trip')],
    [text('Distance (km)'), decimal(kpis.avgDistance, 1)],
    // Blank rather than zero where no row carried an estimate: an empty cell is
    // "not quoted", a 0 is "quoted as instant", and the dashboard tile says the
    // same thing in words.
    [
      text('Estimated time (min), where quoted'),
      kpis.avgMinutes > 0 ? decimal(kpis.avgMinutes, 0) : text(null),
    ],
    [],

    [heading('Payment shape')],
    [text('Cash on delivery (share of deliveries)'), percent(kpis.codShare)],
    [text('Fees on merchant accounts (share)'), percent(kpis.merchantPaidShare)],
    [],

    // The same labels lib/ledgerExport.ts uses for the same figures. Somebody
    // reconciling the two files should not have to work out which of two
    // wordings means the same total.
    [heading('Money in this period')],
    [text('Cash with riders, owed to merchants'), money(totals.cashWithRidersForMerchants)],
    [text(`Cash with riders, owed to ${COMPANY}`), money(totals.cashWithRidersForUs)],
    [text('Rider float, total'), money(totals.cashWithRiders)],
    [text('Owed to merchants, whoever is holding it'), money(totals.owedToMerchants)],
    [text(`Merchant invoices due to ${COMPANY}`), money(totals.merchantInvoicesDue)],
    [text('Cash on delivery still to collect'), money(totals.codAwaitingCollection)],
    [text('Fees still to collect at the door'), money(totals.feesAwaitingCollection)],
    [text('Total outstanding'), money(totals.outstanding)],
  ];

  return {
    title: 'Overview',
    columns: [],
    rows,
  };
}

function dayBySectionDays(records: DeliveryWithMerchant[], range: RangeKey, now: Date): Section {
  const days = chartDays(range);
  const buckets = perDay(records, days, now);

  return {
    title: 'Day by day',
    // The dashboard's chart caps the full-year view at a month, and so does this
    // sheet. Saying so beats a reader concluding the year held thirty days.
    note:
      rangeDays(range) === 0
        ? `The last ${days} days only — the full period is too wide for a daily breakdown.`
        : undefined,
    columns: [
      { header: 'Date', width: 14 },
      { header: 'Deliveries filed', width: 16 },
      { header: 'Handed over', width: 14 },
      { header: 'Delivery fees', width: 15 },
    ],
    rows: buckets.map((b) => [
      // b.key is already a local YYYY-MM-DD; parsed back to a real date so the
      // workbook column sorts and charts as time rather than as text.
      date(b.key),
      count(b.deliveries),
      count(b.completed),
      money(b.fees),
    ]),
  };
}

function merchantsSection(records: DeliveryWithMerchant[]): Section {
  return {
    title: 'Merchants',
    columns: [
      { header: 'Merchant', width: 26 },
      { header: 'Deliveries', width: 12 },
      { header: 'Handed over', width: 13 },
      { header: 'Handed over (share)', width: 17 },
      { header: 'Delivery fees', width: 15 },
      { header: 'Average fee', width: 13 },
      { header: 'Cost of items', width: 15 },
      { header: 'Last request', width: 20 },
    ],
    rows: merchantVolume(records).map((m) => [
      text(m.name),
      count(m.deliveries),
      count(m.completed),
      percent(m.deliveries > 0 ? (m.completed / m.deliveries) * 100 : 0),
      money(m.feeTotal),
      money(m.avgFee),
      money(m.goodsTotal),
      date(m.lastAt, true),
    ]),
  };
}

function ridersSection(records: DeliveryWithMerchant[]): Section {
  return {
    title: 'Riders',
    // The same caveat the screen's InfoHint carries: these come off the rider
    // details snapshotted onto each delivery, so a rider who has left the fleet
    // still appears against the jobs they carried.
    note: 'Read from the rider recorded on each delivery, so former riders still appear.',
    columns: [
      { header: 'Rider', width: 24 },
      { header: 'Given', width: 10 },
      { header: 'Handed over', width: 13 },
      { header: 'Handed over (share)', width: 17 },
      { header: 'Declined', width: 10 },
      { header: 'Delivery fees', width: 15 },
    ],
    rows: riderPerformance(records).map((r) => [
      text(r.riderName),
      count(r.offered),
      count(r.completed),
      percent(r.completionRate),
      count(r.declined),
      money(r.feeTotal),
    ]),
  };
}

function repeatsSection(records: DeliveryWithMerchant[]): Section {
  return {
    title: 'Repeat recipients',
    note: 'Matched on the phone number — the name is typed fresh on every request.',
    columns: [
      { header: 'Recipient', width: 24 },
      { header: 'Phone', width: 16 },
      { header: 'Deliveries', width: 12 },
      { header: 'Cost of items', width: 15 },
      { header: 'Most recent', width: 20 },
    ],
    rows: repeatCustomers(records).map((c) => [
      text(c.name),
      text(c.phone),
      count(c.deliveries),
      money(c.goodsTotal),
      date(c.lastAt, true),
    ]),
  };
}

/**
 * Everything the file will contain, in reading order.
 *
 * Empty sections are dropped rather than written as a lone header row: a sheet
 * of nothing but column names reads like a bug, and the caller has already
 * refused the whole export when there is no data at all.
 */
function buildSections(
  records: DeliveryWithMerchant[],
  opts: DashboardExportOptions
): Section[] {
  const now = opts.now ?? new Date();

  const sections: Section[] = [
    overviewSection(records),
    dayBySectionDays(records, opts.range, now),
    tallySection('Where deliveries sit', 'Status', statusMix(records, DELIVERY_STATUSES)),
    tallySection('The goods — how they were paid for', 'Terms', itemPaymentMix(records)),
    tallySection('The delivery fee — who pays it', 'Payer', feePayerMix(records)),
    tallySection('What is being sent', 'Item category', categoryMix(records)),
    tallySection('Busiest drop-offs', 'Drop-off', topDropoffs(records), 'The top 8 only.'),
  ];

  if (opts.includeMerchants) sections.push(merchantsSection(records));
  sections.push(ridersSection(records), repeatsSection(records));

  return sections.filter((s) => s.rows.length > 0);
}

/** The provenance block both formats open with. */
function headerLines(opts: DashboardExportOptions, now: Date): string[][] {
  const rangeLabel = RANGES.find((r) => r.value === opts.range)?.label ?? '';
  return [
    ['Scope', opts.scopeLabel],
    ['Period', rangeLabel],
    ['Generated', now.toISOString()],
    ['Amounts', 'GHS'],
  ];
}

// ---------------------------------------------------------------------------
// The .xlsx renderer
// ---------------------------------------------------------------------------

const HEADER = {
  fontWeight: 'bold',
  backgroundColor: '#f2f2f2',
  align: 'left',
} as const;

function xlsxCell(cell: Cell | undefined) {
  if (!cell) return null;
  switch (cell.kind) {
    case 'text':
      return cell.value || null;
    case 'heading':
      return { value: cell.value, fontWeight: 'bold' as const };
    case 'money':
      return { type: Number, value: cell.value, format: MONEY };
    case 'count':
      return { type: Number, value: cell.value, format: '0' };
    case 'decimal':
      return {
        type: Number,
        value: cell.value,
        format: cell.places > 0 ? `0.${'0'.repeat(cell.places)}` : '0',
      };
    case 'percent':
      // Excel's percent format multiplies by 100 on display, so the stored value
      // is the fraction. That is what makes the column averageable in a pivot.
      return { type: Number, value: cell.value / 100, format: '0%' };
    case 'date': {
      if (!cell.value) return null;
      const at = new Date(cell.value);
      if (Number.isNaN(at.getTime())) return null;
      return {
        type: Date,
        value: at,
        format: cell.time ? 'dd mmm yyyy hh:mm' : 'dd mmm yyyy',
      };
    }
  }
}

/** One section as rows, with its title, note and column header. */
function xlsxSection(section: Section, withTitle: boolean): SheetData {
  const rows: SheetData = [];

  if (withTitle) {
    rows.push([{ value: section.title, fontWeight: 'bold', fontSize: 13 }]);
  }
  if (section.note) {
    rows.push([{ value: section.note, textColor: '#6b7280', wrap: true }]);
  }
  if (section.columns.length > 0) {
    rows.push(section.columns.map((c) => ({ value: c.header, ...HEADER })));
  }
  for (const row of section.rows) {
    rows.push(row.map(xlsxCell) as Row);
  }

  return rows;
}

/** Column widths wide enough for every section stacked on a shared sheet. */
function widestColumns(sections: Section[]): { width: number }[] {
  const widths: number[] = [];
  for (const s of sections) {
    s.columns.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 0, c.width);
    });
  }
  return widths.map((width) => ({ width }));
}

export async function dashboardToXlsx(
  records: DeliveryWithMerchant[],
  opts: DashboardExportOptions
): Promise<Buffer> {
  const now = opts.now ?? new Date();
  const sections = buildSections(records, opts);
  const byTitle = (title: string) => sections.find((s) => s.title === title);

  // The dashboard's cards, one sheet each — except the seven small bar lists,
  // which share a 'Breakdowns' sheet. Seven sheets of four rows apiece would be
  // a worse document than one sheet somebody can scroll.
  const grouped = ['Overview', 'Day by day', 'Merchants', 'Riders', 'Repeat recipients'];
  const breakdowns = sections.filter((s) => !grouped.includes(s.title));

  const summary = byTitle('Overview');
  const sheets: Parameters<typeof writeXlsxFile>[0] = [];

  sheets.push({
    sheet: 'Summary',
    data: [
      [{ value: `${COMPANY} delivery dashboard`, fontWeight: 'bold', fontSize: 15 }],
      ...headerLines(opts, now).map((line): Row => [
        { value: line[0], fontWeight: 'bold' },
        line[1],
      ]),
      ...(opts.notice
        ? [[{ value: opts.notice, fontWeight: 'bold', textColor: '#9a3412', wrap: true }] as Row]
        : []),
      [],
      ...(summary ? xlsxSection(summary, false) : []),
    ],
    columns: [{ width: 46 }, { width: 20 }],
  });

  const dayBy = byTitle('Day by day');
  if (dayBy) {
    sheets.push({
      sheet: 'Day by day',
      data: xlsxSection(dayBy, false),
      columns: widestColumns([dayBy]),
      stickyRowsCount: dayBy.note ? 2 : 1,
    });
  }

  if (breakdowns.length > 0) {
    const data: SheetData = [];
    for (const [i, section] of breakdowns.entries()) {
      if (i > 0) data.push([]);
      data.push(...xlsxSection(section, true));
    }
    sheets.push({
      sheet: 'Breakdowns',
      data,
      columns: widestColumns(breakdowns),
    });
  }

  for (const title of ['Merchants', 'Riders', 'Repeat recipients']) {
    const section = byTitle(title);
    if (!section) continue;
    sheets.push({
      sheet: title,
      data: xlsxSection(section, false),
      columns: widestColumns([section]),
      stickyRowsCount: section.note ? 2 : 1,
    });
  }

  return writeXlsxFile(sheets).toBuffer();
}

// ---------------------------------------------------------------------------
// The .csv renderer
// ---------------------------------------------------------------------------

/**
 * One CSV field, quoted and escaped per RFC 4180.
 *
 * `guard` prefixes a leading '=', '+', '-', '@', tab or carriage return with a
 * single quote. Merchant names, addresses and recipient names are typed by
 * users, and a spreadsheet treats a cell that opens with one of those as a
 * formula to run when the file is opened — so the guard is applied to text
 * cells, where no legitimate value starts that way, and never to the numeric
 * ones, where a leading minus is the sign.
 */
function csvField(value: string, guard: boolean): string {
  let out = value;
  if (guard && /^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

function csvCell(cell: Cell | undefined): string {
  if (!cell) return '';
  switch (cell.kind) {
    case 'text':
      return csvField(cell.value ?? '', true);
    case 'heading':
      return csvField(cell.value, true);
    case 'money':
      return cell.value.toFixed(2);
    case 'count':
      return String(Math.round(cell.value));
    case 'decimal':
      return cell.value.toFixed(cell.places);
    // The whole number, not the fraction: a CSV has no display format to expand
    // 0.87 back into 87%, and the column header says 'share'.
    case 'percent':
      return cell.value.toFixed(1);
    case 'date': {
      if (!cell.value) return '';
      const at = new Date(cell.value);
      if (Number.isNaN(at.getTime())) return '';
      // ISO, because the consumer of a CSV is another program.
      return cell.time ? at.toISOString() : at.toISOString().slice(0, 10);
    }
  }
}

export function dashboardToCsv(
  records: DeliveryWithMerchant[],
  opts: DashboardExportOptions
): string {
  const now = opts.now ?? new Date();
  const sections = buildSections(records, opts);
  const lines: string[] = [`${csvField(`${COMPANY} delivery dashboard`, false)}`];

  for (const [label, value] of headerLines(opts, now)) {
    lines.push(`${csvField(label, false)},${csvField(value, false)}`);
  }
  if (opts.notice) lines.push(`${csvField('Notice', false)},${csvField(opts.notice, false)}`);

  for (const section of sections) {
    lines.push('');
    lines.push(csvField(section.title, false));
    if (section.note) lines.push(csvField(section.note, false));
    if (section.columns.length > 0) {
      lines.push(section.columns.map((c) => csvField(c.header, false)).join(','));
    }
    for (const row of section.rows) {
      lines.push(row.map(csvCell).join(','));
    }
  }

  // CRLF and a BOM: Excel on Windows opens a bare UTF-8 CSV in the system
  // codepage and mangles any name outside ASCII. The BOM is what makes it read
  // the file as UTF-8 without an import dialog.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------

/** e.g. somoexpress-dashboard-2026-08-28.xlsx */
export function dashboardFileName(format: ExportFormat, now: Date = new Date()): string {
  return `somoexpress-dashboard-${now.toISOString().slice(0, 10)}.${format}`;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // charset, because the file leads with a BOM and is UTF-8 throughout.
  csv: 'text/csv; charset=utf-8',
};
