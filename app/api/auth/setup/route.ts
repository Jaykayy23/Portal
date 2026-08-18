import { NextResponse } from 'next/server';
import { badRequest, handle, readJson } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { publicAccount, setSessionCookie } from '@/lib/session';
import type { Account } from '@/lib/types';

interface SetupBody {
  username: string;
  phone: string;
  password: string;
}

// First-run only: creates the one and only way in when no accounts exist yet.
export async function POST(req: Request) {
  return handle(async () => {
    const { username, phone, password } = await readJson<SetupBody>(req);
    if (!username || !phone || !password) {
      badRequest('Username, phone number and password are all required.');
    }

    if (Object.keys(getDb().accounts).length > 0) {
      badRequest('Setup has already been completed. Please log in.');
    }

    const passwordHash = await hashPassword(password);
    const account: Account = {
      username,
      phone,
      passwordHash,
      role: 'admin',
      companyName: username,
      active: true,
      createdAt: new Date().toISOString(),
    };

    // The emptiness check is repeated inside the serialized write so two
    // simultaneous setup requests can't both create an admin.
    const created = await updateDb((d) => {
      if (Object.keys(d.accounts).length > 0) return false;
      d.accounts[username.toLowerCase()] = account;
      return true;
    });
    if (!created) badRequest('Setup has already been completed. Please log in.');

    await setSessionCookie(account.username);
    return NextResponse.json({ user: publicAccount(account) });
  });
}
