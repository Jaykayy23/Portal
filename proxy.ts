// Session refresh + route gate. Runs on every non-static request.
//
// This only establishes *whether* there is a valid session. Role checks happen
// in the portal layout and in each Route Handler, and the RLS policies in
// supabase/migrations are the final backstop.
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except API routes (they return 401 JSON rather than redirecting),
  // Next internals, and static assets. Image files must stay open: the login
  // page renders the brand mark and favicon before anyone has a session, and
  // gating them redirects the <img> to /login instead of serving the bytes.
  matcher: ['/((?!api|_next/static|_next/image|.*\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)'],
};
