// Delivery history as an .xlsx workbook.
//
// Kept out of the Route Handler so the sheet can be built and inspected without
// a session: the handler's job is authentication and the download headers, this
// module's job is the columns.
//
// Money and distances are written as real numbers with a display format rather
// than as pre-formatted strings ("GHS 51.25"), so the exported file can be summed
// and sorted in Excel instead of only read.

import writeXlsxFile from 'write-excel-file/node';
import type { Column } from 'write-excel-file/node';
import { shortId } from './format';
import type { DeliveryWithMerchant, SurchargeOption } from './types';

const MONEY = '"GHS" #,##0.00';

const HEADER = {
  fontWeight: 'bold',
  backgroundColor: '#f2f2f2',
  align: 'left',
} as const;

function header(value: string) {
  return { value, ...HEADER };
}

export interface DeliveryExportOptions {
  /**
   * Ops/admin exports carry the merchant column; a merchant's own export does
   * not, because every row would repeat their own name.
   */
  includeCustomer: boolean;
  /**
   * Configured surge charges, used to turn the stored ids back into labels. An
   * id with no match is written as-is — that is a charge an admin has since
   * deleted, and the record still has to say what was applied.
   */
  surcharges: SurchargeOption[];
}

function columnsFor(opts: DeliveryExportOptions): Column<DeliveryWithMerchant>[] {
  const labelById = new Map(opts.surcharges.map((s) => [s.id, s.label]));

  const columns: Column<DeliveryWithMerchant>[] = [
    {
      header: header('Date'),
      width: 20,
      cell: (r) => {
        const d = new Date(r.date);
        return Number.isNaN(d.getTime())
          ? null
          : { type: Date, value: d, format: 'dd mmm yyyy hh:mm' };
      },
    },
    { header: header('Order #'), width: 10, cell: (r) => shortId(r.id) },
  ];

  if (opts.includeCustomer) {
    columns.push({ header: header('Merchant'), width: 22, cell: (r) => r.customer });
  }

  columns.push(
    { header: header('Pickup'), width: 30, cell: (r) => r.pickup },
    { header: header('Drop-off'), width: 30, cell: (r) => r.dropoff },
    {
      header: header('Distance (km)'),
      width: 14,
      cell: (r) => ({ type: Number, value: r.distance, format: '0.0' }),
    },
    {
      header: header('Time (min)'),
      width: 12,
      // 0 means "no time component was quoted", which is not the same as a
      // zero-minute trip, so it is left blank rather than written as 0.
      cell: (r) =>
        r.durationMin > 0 ? { type: Number, value: r.durationMin, format: '0' } : null,
    },
    { header: header('Delivery type'), width: 14, cell: (r) => r.type },
    { header: header('Item'), width: 20, cell: (r) => r.itemCategory || null },
    {
      header: header('Surge charges'),
      width: 26,
      cell: (r) =>
        r.surcharges.length > 0
          ? r.surcharges.map((id) => labelById.get(id) ?? id).join(', ')
          : null,
    },
    {
      header: header('Declared value'),
      width: 16,
      cell: (r) => ({ type: Number, value: r.declaredValue, format: MONEY }),
    },
    {
      header: header('Recommended'),
      width: 16,
      cell: (r) => ({ type: Number, value: r.recommended, format: MONEY }),
    },
    {
      header: header('Minimum'),
      width: 16,
      cell: (r) => ({ type: Number, value: r.minimum, format: MONEY }),
    },
    {
      header: header('Agreed'),
      width: 16,
      cell: (r) => ({ type: Number, value: r.agreed, format: MONEY }),
    },
    { header: header('Status'), width: 18, cell: (r) => r.status },
    { header: header('Rider'), width: 18, cell: (r) => r.riderName || null },
    { header: header('Rider phone'), width: 16, cell: (r) => r.riderPhone || null },
    {
      header: header('Bike'),
      width: 22,
      cell: (r) => [r.riderModel, r.riderReg].filter(Boolean).join(' · ') || null,
    }
  );

  return columns;
}

export async function deliveriesToXlsx(
  records: DeliveryWithMerchant[],
  opts: DeliveryExportOptions
): Promise<Buffer> {
  return writeXlsxFile(records, {
    columns: columnsFor(opts),
    sheet: 'Deliveries',
    // The header stays put while scrolling a long history.
    stickyRowsCount: 1,
  }).toBuffer();
}

/** e.g. somoexpress-deliveries-2026-08-19.xlsx */
export function exportFileName(now: Date = new Date()): string {
  return `somoexpress-deliveries-${now.toISOString().slice(0, 10)}.xlsx`;
}
