import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { AccountError, createAccount, listAccounts } from '@/lib/accounts';
import { isValidUsername, USERNAME_RULE } from '@/lib/identity';
import { ROLES, type Role } from '@/lib/types';

export async function GET() {
  return handle(async () => {
    await requireUser('admin');
    return NextResponse.json({ accounts: await listAccounts() });
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
    await requireUser('admin');
    const { username, phone, password, role, companyName } = await readJson<CreateBody>(req);

    if (!username || !phone) badRequest('Username and phone number are required.');
    if (!isValidUsername(username)) badRequest(USERNAME_RULE);
    if (!role || !ROLES.includes(role)) badRequest('Invalid role.');
    if (role === 'merchant' && !companyName) {
      badRequest('Merchant accounts need a company name.');
    }
    if (password && password.length < 8) {
      badRequest('Choose a password of at least 8 characters, or leave it blank to generate one.');
    }

    try {
      // The plaintext password comes back exactly once, to the admin who set it,
      // so it can be handed to the account holder.
      const created = await createAccount({ username, phone, password, role, companyName });
      return NextResponse.json(created);
    } catch (e) {
      if (e instanceof AccountError) badRequest(e.message);
      throw e;
    }
  });
}
