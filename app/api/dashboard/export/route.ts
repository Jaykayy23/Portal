import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import {
  DELIVERY_HISTORY_DAYS,
  deliveryHistoryRange,
  listDeliveriesFor,
} from '@/lib/deliveries';
import { RANGES, filterByRange, rangeDays, type RangeKey } from '@/lib/analytics';
import {
  CONTENT_TYPES,
  EXPORT_FORMATS,
  dashboardFileName,
  dashboardToCsv,
  dashboardToXlsx,
  type ExportFormat,
} from '@/lib/dashboardExport';
import { seesAllMerchants } from '@/lib/types';
import { logActivity } from '@/lib/activity';

// write-excel-file/node reads and zips buffers, which needs the Node runtime.
// The CSV path would run anywhere, but one runtime for one route is simpler than
// two routes for one button.
export const runtime = 'nodejs';

// The same ceiling as the other two exports, and for the same reason: this reads
// the caller's bounded history and builds a six-sheet workbook out of it.
const PER_USER = { limit: 5, windowSeconds: 300 };

/**
 * The dashboard as an .xlsx or .csv download, filtered the way the screen is.
 *
 * The period and merchant arrive as query parameters so the file matches what the
 * person was looking at when they pressed the button — exporting "everything"
 * from a screen showing one merchant's last week would be a quiet way to hand
 * somebody the wrong figures.
 *
 * Neither parameter is authorisation. `listDeliveriesFor` reads through the
 * caller's own session, so the RLS SELECT policy decides which rows exist at all:
 * a merchant passing another merchant's id gets an empty file, not somebody
 * else's numbers. Every signed-in role may export, for the same reason every role
 * may see the dashboard — what it can say is decided in Postgres.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    await enforceRateLimit('dashboard-export', user.id, PER_USER);

    const params = new URL(req.url).searchParams;
    const merchantId = params.get('merchant') ?? '';
    const rangeParam = params.get('range') ?? '30d';
    const formatParam = params.get('format') ?? 'xlsx';

    const range = RANGES.find((r) => r.value === rangeParam)?.value;
    if (!range) badRequest('Unknown date range.');
    const format = EXPORT_FORMATS.find((f) => f === formatParam);
    if (!format) badRequest('Unknown file format — expected xlsx or csv.');

    const selectedRange = range as RangeKey;

    // "all" means the full approved reporting horizon; the shorter UI periods
    // narrow the read at the database boundary rather than in memory.
    const history = await listDeliveriesFor(
      user,
      deliveryHistoryRange(rangeDays(selectedRange) || DELIVERY_HISTORY_DAYS)
    );

    // Narrowed again in memory, because the database range is whole UTC days
    // while the dashboard counts whole local ones. Without this the file could
    // hold a row the screen excluded, and the totals would not tie.
    const inPeriod = filterByRange(history.records, selectedRange);
    const scoped = merchantId ? inPeriod.filter((r) => r.merchantId === merchantId) : inPeriod;

    // The buttons are hidden when the dashboard has nothing in it; this covers
    // someone reaching the URL directly, where a file of headings and zeroes
    // would only be puzzling.
    if (scoped.length === 0) {
      badRequest('There is nothing to export for that period.');
    }

    const seesAll = seesAllMerchants(user);
    const rangeLabel = RANGES.find((r) => r.value === range)!.label;
    const merchantLabel = merchantId
      ? scoped[0].customer
      : seesAll
        ? 'All merchants'
        : user.companyName;

    // Fixed once, so the header block, the daily buckets and the file name all
    // describe the same instant.
    const now = new Date();

    const opts = {
      range: selectedRange,
      // A merchant's own file would be one row of themselves; and a file scoped
      // to one merchant already says whose it is in the header block.
      includeMerchants: seesAll && !merchantId,
      scopeLabel: `${merchantLabel} · ${rangeLabel}`,
      notice: history.truncated
        ? `INCOMPLETE — only the newest ${history.records.length.toLocaleString()} deliveries of ` +
          `${rangeLabel.toLowerCase()} could be loaded. Older ones are missing entirely, so every ` +
          'count and total below is a minimum rather than the real figure. Export a narrower ' +
          'period for exact numbers.'
        : undefined,
      now,
    };

    const filename = dashboardFileName(format as ExportFormat, now);
    const body =
      format === 'csv'
        ? Buffer.from(dashboardToCsv(scoped, opts), 'utf8')
        : await dashboardToXlsx(scoped, opts);

    // An export is a copy of the business leaving the portal, so it is recorded
    // even though it changed nothing. The filters are the interesting part:
    // "one merchant's last week" is a different event from "the whole year", and
    // the file name says neither.
    logActivity({
      actor: user,
      action: 'dashboard.exported',
      entityType: 'dashboard',
      entityLabel: filename,
      details: {
        format,
        deliveries: scoped.length,
        merchant: merchantLabel,
        range: rangeLabel,
      },
    });

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': CONTENT_TYPES[format as ExportFormat],
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(body.length),
        // Per-user data behind a session cookie: never let a shared cache hold it.
        'Cache-Control': 'no-store',
      },
    });
  });
}
