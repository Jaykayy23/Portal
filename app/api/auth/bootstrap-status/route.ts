import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { enforceIpRateLimit } from '@/lib/rateLimit';
import { hasAnyAccount } from '@/lib/session';

// Public and backed by a count over profiles. Generous, because a browser hits
// it on every visit to the login screen — this is only here to stop it being
// used as a free database query in a loop.
const PER_IP = { limit: 60, windowSeconds: 300 };

// Tells the client whether to show "create admin account" or "log in".
export async function GET(req: Request) {
  return handle(async () => {
    await enforceIpRateLimit('bootstrap-status', req, PER_IP);
    return NextResponse.json({ hasAccounts: await hasAnyAccount() });
  });
}
