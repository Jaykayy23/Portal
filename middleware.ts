// Route gate. Runs on the Edge runtime, so it can only verify the session
// cookie's signature (via `jose`) — it cannot read db.json to check roles or
// whether an account is still active. Those checks happen in the portal layout
// and in each Route Handler, which run on Node.
//
// The job here is just: no valid session cookie => don't render the portal.

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/jwt';

export async function middleware(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = req.nextUrl;

  const isAuthPage = pathname === '/login' || pathname === '/setup';

  if (!session && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Remember where they were headed so login can send them back.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (session && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/portal/new';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except API routes (they return 401 JSON instead of redirecting),
  // Next internals, and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
