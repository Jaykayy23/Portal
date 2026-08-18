import { NextResponse } from 'next/server';
import { HttpError, badRequest, handle, readJson } from '@/lib/http';
import { getDb } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { publicAccount, setSessionCookie } from '@/lib/session';

interface LoginBody {
  username: string;
  password: string;
}

export async function POST(req: Request) {
  return handle(async () => {
    const { username, password } = await readJson<LoginBody>(req);
    if (!username || !password) badRequest('Enter your username and password.');

    const account = getDb().accounts[username.toLowerCase()];
    if (!account || account.active === false) {
      throw new HttpError(401, 'No active account with that username.');
    }
    if (!(await verifyPassword(password, account.passwordHash))) {
      throw new HttpError(401, 'Incorrect password.');
    }

    await setSessionCookie(account.username);
    return NextResponse.json({ user: publicAccount(account) });
  });
}
