// Server-side session helpers. Node runtime only (reads the database).
//
// The JWT lives in an httpOnly cookie, so page-level JavaScript can never read
// it and an XSS can't exfiltrate a session. Every call re-reads the account
// from the database, which means deactivating an account takes effect on the
// account holder's very next request rather than whenever their token expires.

import { cookies } from 'next/headers';
import type { Account, PublicAccount, Role, SessionUser } from './types';
import { getDb } from './db';
import {
  SESSION_COOKIE,
  expiresInSeconds,
  signSessionToken,
  verifySessionToken,
} from './jwt';

export { SESSION_COOKIE };

export function publicAccount(acc: Account): PublicAccount {
  return {
    username: acc.username,
    role: acc.role,
    companyName: acc.companyName,
    phone: acc.phone,
    active: acc.active !== false,
    createdAt: acc.createdAt,
  };
}

export function toSessionUser(acc: Account): SessionUser {
  return {
    username: acc.username,
    role: acc.role,
    companyName: acc.companyName || acc.username,
    phone: acc.phone,
  };
}

/** The signed-in user, or null. Safe to call from pages, layouts and handlers. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const account = getDb().accounts[payload.username.toLowerCase()];
  if (!account || account.active === false) return null;
  return toSessionUser(account);
}

/** Issues the session cookie after a successful login or first-run setup. */
export async function setSessionCookie(username: string): Promise<void> {
  const token = await signSessionToken({ username });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresInSeconds(),
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function hasAnyAccount(): boolean {
  return Object.keys(getDb().accounts).length > 0;
}

export function roleAllows(user: SessionUser | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}
