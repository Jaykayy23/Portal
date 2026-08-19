import { NextResponse } from 'next/server';
import { badRequest, handle, readJson } from '@/lib/http';
import { enforceIpRateLimit } from '@/lib/rateLimit';
import { hasAnyAccount } from '@/lib/session';
import { createAccount, AccountError } from '@/lib/accounts';
import { isValidUsername, USERNAME_RULE } from '@/lib/identity';

interface SetupBody {
  username: string;
  phone: string;
  password: string;
}

// Unauthenticated by necessity — there is no account to authenticate as yet.
// hasAnyAccount() closes it the moment the first admin exists, so the limit only
// has to cover the window before that, plus the endless probing every public URL
// attracts afterwards.
const PER_IP = { limit: 5, windowSeconds: 900 };

// First-run only: creates the one and only way in when no accounts exist yet.
export async function POST(req: Request) {
  return handle(async () => {
    await enforceIpRateLimit('setup', req, PER_IP);
    const { username, phone, password } = await readJson<SetupBody>(req);
    if (!username || !phone || !password) {
      badRequest('Username, phone number and password are all required.');
    }
    if (!isValidUsername(username)) badRequest(USERNAME_RULE);

    // Supabase Auth's own floor is 6 characters; state it rather than surfacing
    // a raw provider error.
    if (password.length < 8) {
      badRequest('Choose a password of at least 8 characters.');
    }
    if (await hasAnyAccount()) {
      badRequest('Setup has already been completed. Please log in.');
    }

    try {
      const { account } = await createAccount({
        username,
        phone,
        role: 'admin',
        password,
      });
      // The client signs in straight after, which is what mints the session
      // cookie — createUser on the server does not establish one.
      return NextResponse.json({ user: account });
    } catch (e) {
      if (e instanceof AccountError) badRequest(e.message);
      throw e;
    }
  });
}
