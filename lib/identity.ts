/**
 * Username ↔ email mapping.
 *
 * The portal is username-based: an admin issues credentials and the account
 * holder types a username, never an email. Supabase Auth is email-based. So each
 * account gets a synthetic address built from its username, and the UI never
 * shows it.
 *
 * The domain is intentionally not a real one — nothing is ever delivered to these
 * addresses. That also means email-based flows (password reset links, magic
 * links, confirmations) do not apply; password resets stay an admin action that
 * reveals the new password once, exactly as before.
 *
 * Changing ACCOUNT_EMAIL_DOMAIN after accounts exist would orphan every login,
 * so treat it as fixed once you go live.
 */
export const ACCOUNT_EMAIL_DOMAIN = 'portal.somoexpress.local';

/** Usernames are stored and compared lowercase; a DB check constraint enforces it. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${ACCOUNT_EMAIL_DOMAIN}`;
}

/** Rejects anything that wouldn't survive the round-trip into an email local-part. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/.test(normalizeUsername(username));
}

export const USERNAME_RULE =
  'Usernames may use letters, numbers, dots, hyphens and underscores, and must be 3–32 characters.';
