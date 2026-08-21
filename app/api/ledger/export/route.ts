import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { listDeliveriesFor } from '@/lib/deliveries';
import { filterByRange, RANGES, type RangeKey } from '@/lib/analytics';
import { LEDGER_FOCUSES, matchesFocus, toLedger, type LedgerFocus } from '@/lib/ledger';
import { ledgerFileName, ledgerToXlsx } from '@/lib/ledgerExport';
import { seesAllMerchants } from '@/lib/types';

// write-excel-file/node reads and zips buffers, which needs the Node runtime.
export const runtime = 'nodejs';

// The same ceiling as the delivery export, and for the same reason: this reads
// the caller's whole history and zips a two-sheet workbook out of it.
const PER_USER = { limit: 5, windowSeconds: 300 };

/**
 * The ledger as an .xlsx download, filtered the way the screen is.
 *
 * The filters arrive as query parameters so the file matches what the person was
 * looking at when they pressed the button — exporting "everything" from a screen
 * showing one merchant's overdue invoices would be a quiet way to hand someone
 * the wrong spreadsheet.
 *
 * None of those parameters is authorisation. `listDeliveriesFor` reads through
 * the caller's own session, so the RLS SELECT policy decides which rows exist at
 * all: a merchant passing another merchant's id gets an empty file, not somebody
 * else's ledger. Finance is read-only here as everywhere — this is a GET, and no
 * UPDATE policy in the schema names the role.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops', 'finance', 'merchant');
    await enforceRateLimit('ledger-export', user.id, PER_USER);

    const params = new URL(req.url).searchParams;
    const merchantId = params.get('merchant') ?? '';
    const rangeParam = params.get('range') ?? 'all';
    const focusParam = params.get('focus') ?? 'all';

    const range = RANGES.find((r) => r.value === rangeParam)?.value;
    if (!range) badRequest('Unknown date range.');
    const focus = LEDGER_FOCUSES.find((f) => f.value === focusParam)?.value;
    if (!focus) badRequest('Unknown ledger filter.');

    const all = await listDeliveriesFor(user);
    const inRange = filterByRange(all, range as RangeKey);
    const scoped = merchantId ? inRange.filter((r) => r.merchantId === merchantId) : inRange;
    const entries = toLedger(scoped).filter((e) => matchesFocus(e, focus as LedgerFocus));

    // The button is hidden when the table is empty; this covers someone reaching
    // the URL directly, where a workbook of headers would only be puzzling.
    if (entries.length === 0) {
      badRequest('There is nothing to export with those filters.');
    }

    const rangeLabel = RANGES.find((r) => r.value === range)!.label;
    const focusLabel = LEDGER_FOCUSES.find((f) => f.value === focus)!.label;
    const merchantLabel = merchantId
      ? entries[0].delivery.customer
      : seesAllMerchants(user)
        ? 'All merchants'
        : user.companyName;

    const file = await ledgerToXlsx(entries, {
      includeMerchant: seesAllMerchants(user) && !merchantId,
      scopeLabel: `${merchantLabel} · ${rangeLabel} · ${focusLabel}`,
    });
    const filename = ledgerFileName();

    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.length),
        // Per-user data behind a session cookie: never let a shared cache hold it.
        'Cache-Control': 'no-store',
      },
    });
  });
}
