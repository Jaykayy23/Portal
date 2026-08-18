import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import { genTempPassword, hashPassword } from '@/lib/password';
import { publicAccount } from '@/lib/session';
import { ROLES, type Account, type Role } from '@/lib/types';

export async function GET() {
  return handle(async () => {
    await requireUser('admin');
    const accounts = Object.values(getDb().accounts).map(publicAccount);
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
    await requireUser('admin');
    const { username, phone, password, role, companyName } = await readJson<CreateBody>(req);

    if (!username || !phone) badRequest('Username and phone number are required.');
    if (!role || !ROLES.includes(role)) badRequest('Invalid role.');
    if (role === 'merchant' && !companyName) {
      badRequest('Merchant accounts need a company name.');
    }

    const finalPassword = password || genTempPassword();
    const passwordHash = await hashPassword(finalPassword);
    const account: Account = {
      username,
      phone,
      passwordHash,
      role,
      companyName: role === 'merchant' ? companyName! : username,
      active: true,
      createdAt: new Date().toISOString(),
    };

    // Uniqueness is checked inside the serialized write so two simultaneous
    // creates for the same username can't both succeed.
    const taken = await updateDb((d) => {
      if (d.accounts[username.toLowerCase()]) return true;
      d.accounts[username.toLowerCase()] = account;
      return false;
    });
    if (taken) badRequest('That username already exists.');

    // The plaintext password is returned exactly once, to the admin who set it,
    // so it can be handed to the account holder.
    return NextResponse.json({ account: publicAccount(account), password: finalPassword });
  });
}
