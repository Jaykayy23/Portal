import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle, readJson, requireUser } from '@/lib/http';
import { AccountError, createAccount, listAccounts } from '@/lib/accounts';
import { isValidUsername, USERNAME_RULE } from '@/lib/identity';
import { ROLES, type Role } from '@/lib/types';

/**
 * Admin gets every account; ops gets merchants only.
 *
 * The filter here and the RLS policy say the same thing on purpose — RLS is the
 * guarantee, this is what makes the intent readable at the call site.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser('admin', 'ops');
    const accounts = await listAccounts(user.role === 'ops' ? { role: 'merchant' } : {});
    return NextResponse.json({ accounts });
  });
}

interface CreateBody {
  username: string;
  phone: string;
  password?: string;
  role: Role;
  companyName?: string;
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops');
    const { username, phone, password, role, companyName } = await readJson<CreateBody>(req);

    if (!username || !phone) badRequest('Username and phone number are required.');
    if (!isValidUsername(username)) badRequest(USERNAME_RULE);
    if (!role || !ROLES.includes(role)) badRequest('Invalid role.');
    // The one thing standing between ops and an ops/admin account: createAccount
    // runs as service_role, so RLS cannot make this check for us.
    if (user.role === 'ops' && role !== 'merchant') {
      throw new HttpError(403, 'Ops accounts can only create merchant accounts.');
    }
    if (role === 'merchant' && !companyName) {
      badRequest('Merchant accounts need a company name.');
    }
    if (password && password.length < 8) {
      badRequest('Choose a password of at least 8 characters, or leave it blank to generate one.');
    }

    try {
      // The plaintext password comes back exactly once, to the person who set it,
      // so it can be handed to the account holder.
      const created = await createAccount({ username, phone, password, role, companyName });
      return NextResponse.json(created);
    } catch (e) {
      if (e instanceof AccountError) badRequest(e.message);
      throw e;
    }
  });
}
