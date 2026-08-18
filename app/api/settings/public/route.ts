import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { getDb } from '@/lib/db';

/**
 * Branding only. The login screen has to render the portal's logo before anyone
 * is signed in, so this stays unauthenticated — but nothing else lives here.
 *
 * Note this is narrower than the original Express route, which also returned
 * `mapsApiKey` to anonymous callers despite the docs saying it went only to
 * logged-in browsers. The Maps key is now handed to the client by the
 * authenticated portal layout instead. See app/portal/layout.tsx.
 */
export async function GET() {
  return handle(async () => {
    const { logoDataUrl } = getDb().appSettings;
    return NextResponse.json({ logoDataUrl: logoDataUrl || '' });
  });
}
