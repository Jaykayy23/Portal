import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';

/**
 * Routes reachable without a session.
 *
 * '/d' is the rider's delivery-confirmation page. Riders have no portal account,
 * so the token in the URL is the entire credential — gating it behind a login
 * would redirect them to a screen they can never get past. What the token is
 * worth is decided in lib/deliveryConfirmation.ts, not here.
 */
const PUBLIC_PATHS = ['/login', '/setup', '/auth', '/d'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Refreshes the Supabase session cookie on every request and gates the portal.
 *
 * Adapted from the @supabase/ssr template, with the redirect pointed at this
 * app's actual login route (/login, not /auth/login) and the ?next= round-trip
 * kept from the previous middleware.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Per-request client, never a module-level one: on Fluid compute a shared
  // client would leak one visitor's session into another's request.
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not insert code between createServerClient and getClaims(). Anything that
  // defers this call can leave the session cookie unrefreshed, which shows up as
  // users being logged out at random.
  //
  // getClaims() verifies the JWT locally against the project's public JWKS
  // (projects created after 2025-05-01 use asymmetric keys), so this costs no
  // network round-trip in the common case.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { pathname, search } = request.nextUrl;

  if (!claims && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (claims && (pathname === '/login' || pathname === '/setup')) {
    const url = request.nextUrl.clone();
    // The portal index, not a named tab: it reads the role and forwards. This
    // proxy has the role in `claims` and could decide here, but then two places
    // would own "where does this role belong", and only one of them would get
    // updated the next time that changes.
    url.pathname = '/portal';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Must be returned as-is. Building a fresh response here without copying these
  // cookies over desynchronises the browser and the server and ends the session
  // early.
  return supabaseResponse;
}
