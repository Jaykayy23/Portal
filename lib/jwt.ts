// Session token signing/verification.
//
// Uses `jose` rather than `jsonwebtoken` because middleware.ts runs on the Edge
// runtime, where Node's crypto module isn't available. `jose` works in both, so
// middleware and Route Handlers can share this one module.

import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'somo_session';

const RAW_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

if (!process.env.JWT_SECRET) {
  console.warn(
    '[somoexpress] WARNING: JWT_SECRET is not set in .env — using an insecure ' +
      'development default. Set a real secret before deploying this anywhere ' +
      'reachable by other people.'
  );
}

const secretKey = new TextEncoder().encode(RAW_SECRET);

export interface SessionPayload {
  username: string;
}

/** Turns "30d" / "12h" / "45m" / "3600s" into seconds, for the cookie's Max-Age. */
export function expiresInSeconds(spec: string = JWT_EXPIRES_IN): number {
  const match = /^(\d+)\s*([smhdw])?$/i.exec(spec.trim());
  if (!match) return 30 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit] ?? 1;
  return n * mult;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(secretKey);
}

/** Returns the payload, or null if the token is missing, tampered with, or expired. */
export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    const username = payload.username;
    return typeof username === 'string' ? { username } : null;
  } catch {
    return null;
  }
}
