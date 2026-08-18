// bcrypt lives in its own module (separate from lib/jwt.ts) because it is
// Node-only — importing it from anything the Edge middleware touches would
// break the build.

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Temporary password handed to a new account holder by the admin who created it.
 * Uses crypto.randomBytes rather than Math.random so a temp password can't be
 * guessed from the timing of the account's creation.
 */
export function genTempPassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
