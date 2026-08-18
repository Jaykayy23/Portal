import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { getLogoDataUrl } from '@/lib/settings';

/**
 * Branding only. The login screen renders the portal's logo before anyone is
 * signed in, so this stays unauthenticated — and nothing else lives here. The
 * Maps key is handed to signed-in clients by the portal layout instead.
 */
export async function GET() {
  return handle(async () => NextResponse.json({ logoDataUrl: await getLogoDataUrl() }));
}
