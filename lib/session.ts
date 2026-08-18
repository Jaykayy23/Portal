// Server-side session helpers, backed by Supabase Auth.
//
// Replaces the previous bcrypt + hand-rolled JWT cookie scheme. Supabase issues
// and refreshes the session cookie; the proxy keeps it fresh.
//
// Every call re-reads the profile row, so deactivating an account takes effect on
// that person's very next request rather than whenever their token expires — the
// same guarantee the old implementation had.

import type { PublicAccount, Role, SessionUser } from './types';
import type { Database } from './database.types';
import { createSupabaseServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function publicAccount(p: ProfileRow): PublicAccount {
  return {
    username: p.username,
    role: p.role,
    companyName: p.company_name,
    phone: p.phone,
    active: p.active,
    createdAt: p.created_at,
  };
}

export function toSessionUser(p: ProfileRow): SessionUser {
  return {
    id: p.id,
    username: p.username,
    role: p.role,
    companyName: p.company_name || p.username,
    phone: p.phone,
  };
}

/**
 * The signed-in user, or null. Safe from pages, layouts and Route Handlers.
 *
 * getClaims() verifies the JWT against the project's public JWKS without a
 * network call. The profile lookup that follows is the authoritative check —
 * a banned or deactivated account resolves to null here.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile || !profile.active) return null;
  return toSessionUser(profile);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

/**
 * True once any account exists — drives the setup-vs-login decision.
 *
 * Uses the admin client because at this point there is no session, and profiles
 * is not readable by `anon`.
 */
export async function hasAnyAccount(): Promise<boolean> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error(`Could not reach the database: ${error.message}`);
  return (count ?? 0) > 0;
}

export function roleAllows(user: SessionUser | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}
