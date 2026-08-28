import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { getSessionUser, signOut } from '@/lib/session';
import { logActivity } from '@/lib/activity';

export async function POST() {
  return handle(async () => {
    // Read before the sign-out, obviously — afterwards there is no session to
    // name. Not requireUser(): signing out is allowed to succeed for a session
    // that has already expired, and a 401 on the way out would strand the
    // cookie in the browser.
    const user = await getSessionUser();
    await signOut();

    if (user) {
      logActivity({ actor: user, action: 'auth.signed_out' });
    }

    return NextResponse.json({ ok: true });
  });
}
