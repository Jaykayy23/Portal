import { NextResponse } from 'next/server';
import { handle, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { logActivity } from '@/lib/activity';

/**
 * Records that somebody signed in.
 *
 * This endpoint exists because signing in does not otherwise touch this server.
 * The login form calls supabase.auth.signInWithPassword() from the browser so
 * the SDK owns its own session cookies (see components/auth/LoginForm.tsx), and
 * a sign-in therefore leaves no trace in any Route Handler. Without this, the
 * activity log would show everything a person did except the one line that says
 * when they arrived — which is the first line anyone looks for.
 *
 * It is not a security boundary and does not need to be. The actor is resolved
 * from the session cookie by requireUser(), never from the body, so the only
 * thing a caller can record is their own sign-in — which they have, by
 * definition, just performed. The rate limit is the whole of the abuse story: it
 * stops a bored account filling the table with its own name.
 *
 * Best-effort by nature. A client that never makes this call — a script driving
 * the Supabase SDK directly, a browser that dropped the request mid-navigation —
 * signs in without a line here. Supabase's own auth logs in the project
 * dashboard are the complete record; this is the copy that is visible inside the
 * portal, where the admin actually is.
 */
const PER_USER = { limit: 10, windowSeconds: 300 };

export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    await enforceRateLimit('auth-signin-log', user.id, PER_USER);

    logActivity({ actor: user, action: 'auth.signed_in' });

    return NextResponse.json({ ok: true });
  });
}
