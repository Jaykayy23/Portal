// Temporary passwords for admin-provisioned accounts.
//
// bcrypt is gone: Supabase Auth stores and verifies password hashes now. All that
// remains is generating the one-time password an admin hands to a new account
// holder.

import crypto from 'node:crypto';

/**
 * Uses crypto.randomBytes rather than Math.random, so a temp password can't be
 * guessed from the time the account was created. The alphabet omits look-alike
 * characters (l/1, o/0) because these get read aloud and written down.
 */
export function genTempPassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
