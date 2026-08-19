import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { listDeliveriesFor } from '@/lib/deliveries';
import { getPricingParams } from '@/lib/settings';
import { deliveriesToXlsx, exportFileName } from '@/lib/deliveryExport';
import { isOpsOrAdmin } from '@/lib/types';

// write-excel-file/node needs the Node runtime — it reads and zips buffers.
export const runtime = 'nodejs';

/**
 * The signed-in user's delivery history as an .xlsx download.
 *
 * There is no scoping code here on purpose: listDeliveriesFor reads through the
 * caller's session, so the RLS SELECT policy decides what lands in the file — a
 * merchant's export can only ever contain their own rows.
 */
// The most expensive endpoint in the app: it reads the caller's entire delivery
// history and zips a workbook out of it, in the Node runtime. Nobody legitimately
// needs more than a handful of these in a few minutes.
const PER_USER = { limit: 5, windowSeconds: 300 };

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    await enforceRateLimit('delivery-export', user.id, PER_USER);

    const [records, params] = await Promise.all([
      listDeliveriesFor(user),
      getPricingParams(),
    ]);

    // The button is hidden when there is nothing to export; this covers someone
    // reaching the URL directly, where an empty workbook would just be puzzling.
    if (records.length === 0) badRequest('There are no deliveries to export yet.');

    const file = await deliveriesToXlsx(records, {
      includeCustomer: isOpsOrAdmin(user),
      // Deliveries store surge charge ids; the sheet shows the labels.
      surcharges: params.surcharges,
    });
    const filename = exportFileName();

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
