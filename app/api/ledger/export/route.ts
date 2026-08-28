import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import {
  DELIVERY_HISTORY_DAYS,
  deliveryHistoryRange,
  listDeliveriesFor,
} from '@/lib/deliveries';
import { listSettlementMarks, listSettlements } from '@/lib/settlements';
import { rangeDays, RANGES, type RangeKey } from '@/lib/analytics';
import { LEDGER_FOCUSES, matchesFocus, toLedger, type LedgerFocus } from '@/lib/ledger';
import { ledgerFileName, ledgerToXlsx } from '@/lib/ledgerExport';
import { seesAllMerchants } from '@/lib/types';
import { logActivity } from '@/lib/activity';

// write-excel-file/node reads and zips buffers, which needs the Node runtime.
export const runtime = 'nodejs';

// The same ceiling as the delivery export, and for the same reason: this reads
// the caller's bounded one-year history and zips a two-sheet workbook out of it.
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

    // "all" means the full approved reporting horizon, while the shorter UI
    // ranges narrow both workbook sheets at the database boundary.
    const selectedRange = range as RangeKey;
    const readRange = deliveryHistoryRange(
      rangeDays(selectedRange) || DELIVERY_HISTORY_DAYS
    );

    const [history, settled, settlements] = await Promise.all([
      listDeliveriesFor(user, readRange),
      // The same window the deliveries came from. A settlement cannot predate
      // the delivery it settles, so this keeps every mark that could belong to a
      // row in this file — and stops the read being dominated by marks against
      // deliveries the file does not contain.
      listSettlementMarks(readRange),
      listSettlements(100, readRange),
    ]);
    const all = history.records;
    const scoped = merchantId ? all.filter((r) => r.merchantId === merchantId) : all;
    const entries = toLedger(scoped, settled.marks).filter((e) =>
      matchesFocus(e, focus as LedgerFocus)
    );

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

    // Two different distortions, and they point opposite ways: missing
    // deliveries understate what is owed, missing marks overstate it. Whoever
    // reconciles from this file needs to know which way to lean.
    const caveats = [
      history.truncated &&
        `Only the newest ${all.length.toLocaleString()} deliveries of ${rangeLabel.toLowerCase()} ` +
          'could be loaded — older ones are missing, so every total below is a minimum.',
      settled.truncated &&
        'Some settlement records could not be loaded, so rows already paid may appear ' +
          'outstanding. Check the Settlements sheet before chasing anyone.',
    ].filter(Boolean);

    const file = await ledgerToXlsx(entries, {
      includeMerchant: seesAllMerchants(user) && !merchantId,
      scopeLabel: `${merchantLabel} · ${rangeLabel} · ${focusLabel}`,
      notice:
        caveats.length > 0
          ? `INCOMPLETE — ${caveats.join(' ')} Export a narrower date range for exact figures.`
          : undefined,
      // Scoped to the merchant when one is selected, so the sheet matches the
      // rows beside it. A rider's remittance that happens to cover this
      // merchant's orders counts as theirs.
      settlements: merchantId
        ? settlements.filter(
            (s) =>
              s.merchantId === merchantId ||
              s.lines.some((l) => scoped.some((d) => d.id === l.deliveryId))
          )
        : settlements,
    });
    const filename = ledgerFileName();

    logActivity({
      actor: user,
      action: 'ledger.exported',
      entityType: 'ledger',
      entityLabel: filename,
      // The filters are the interesting part: "finance exported one merchant's
      // outstanding balances" is a different event from "finance exported the
      // year", and the file name says neither.
      details: {
        rows: entries.length,
        merchant: merchantLabel,
        range: rangeLabel,
        focus: focusLabel,
      },
    });

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
