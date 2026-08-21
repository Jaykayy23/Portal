// Account provisioning.
//
// Admin creates any account; ops creates merchants only (enforced in the Route
// Handler, since the create path below bypasses RLS). Either way this runs
// through the service-role client: creating an auth user is a privileged
// operation, and the portal role has to land in app_metadata (never
// user_metadata, which the account holder could edit and which RLS therefore
// must not trust).

import { createAdminClient } from './supabase/admin';
import { createSupabaseServerClient } from './supabase/server';
import { publicAccount } from './session';
import { genTempPassword } from './password';
import { normalizeUsername, usernameToEmail } from './identity';
import type { PublicAccount, Role } from './types';

export interface CreateAccountInput {
  username: string;
  phone: string;
  role: Role;
  companyName?: string;
  /** Omit to auto-generate a temporary password. */
  password?: string;
}

export interface CreatedAccount {
  account: PublicAccount;
  /** Plaintext, returned exactly once so the admin can hand it over. */
  password: string;
}

export class AccountError extends Error {}

/**
 * Creates the auth user and its profile row.
 *
 * `portal_role` in app_metadata is what the RLS policies read. `email_confirm`
 * is set because the synthetic addresses are undeliverable — without it the
 * account could never sign in.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreatedAccount> {
  const admin = createAdminClient();
  const username = normalizeUsername(input.username);
  const companyName = input.role === 'merchant' ? input.companyName!.trim() : username;
  const password = input.password || genTempPassword();

  // Checked up front for a clear error message; the unique index on
  // profiles.username is what actually guarantees it.
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existing) throw new AccountError('That username already exists.');

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    app_metadata: { portal_role: input.role },
  });

  if (authError || !created.user) {
    throw new AccountError(authError?.message || 'Could not create that account.');
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      id: created.user.id,
      username,
      role: input.role,
      company_name: companyName,
      phone: input.phone.trim(),
      active: true,
    })
    .select('*')
    .single();

  if (profileError || !profile) {
    // Don't leave an auth user with no profile — it could sign in and resolve to
    // no identity at all.
    await admin.auth.admin.deleteUser(created.user.id);
    throw new AccountError(profileError?.message || 'Could not create that account.');
  }

  return { account: publicAccount(profile), password };
}

/**
 * The account list. Reads through the caller's session so RLS applies: admin
 * sees every account, ops sees merchants only.
 *
 * `role` narrows it further for callers that want one kind of account — the ops
 * Merchants pane passes 'merchant' so the query says what it means rather than
 * relying on the policy to silently drop the rest.
 */
export async function listAccounts(opts: { role?: Role } = {}): Promise<PublicAccount[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('profiles').select('*');
  if (opts.role) query = query.eq('role', opts.role);

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) throw new AccountError(error.message);
  return (data ?? []).map(publicAccount);
}

/**
 * Resets a password and/or flips the active flag.
 *
 * Deactivating also bans the auth user. That matters because clearing the profile
 * flag alone would not stop an already-issued access token from being accepted by
 * Supabase until it expired — the ban revokes it at the source, and the profile
 * flag is what the app checks on every request.
 */
export async function updateAccount(
  targetUsername: string,
  opts: { active?: boolean; resetPassword?: boolean }
): Promise<{ account: PublicAccount; password?: string }> {
  const admin = createAdminClient();
  const username = normalizeUsername(targetUsername);

  const { data: profile, error: findError } = await admin
    .from('profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (findError) throw new AccountError(findError.message);
  if (!profile) throw new AccountError('Account not found.');

  let newPassword: string | undefined;

  if (opts.resetPassword) {
    newPassword = genTempPassword();
    const { error } = await admin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });
    if (error) throw new AccountError(error.message);
  }

  if (typeof opts.active === 'boolean') {
    const { error: banError } = await admin.auth.admin.updateUserById(profile.id, {
      // 'none' lifts an existing ban. A long duration is Supabase's way of
      // expressing an indefinite one.
      ban_duration: opts.active ? 'none' : '876000h',
    });
    if (banError) throw new AccountError(banError.message);

    const { error: flagError } = await admin
      .from('profiles')
      .update({ active: opts.active })
      .eq('id', profile.id);
    if (flagError) throw new AccountError(flagError.message);
  }

  const { data: updated, error: reloadError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', profile.id)
    .single();

  if (reloadError || !updated) throw new AccountError('Could not read the account back.');
  return { account: publicAccount(updated), password: newPassword };
}

/** Just enough of a merchant account to put it in a picker. */
export interface MerchantOption {
  /** The profile id, which is what deliveries.merchant_id holds. */
  id: string;
  name: string;
  active: boolean;
}

/**
 * Every merchant, for the ledger and dashboard merchant pickers.
 *
 * Reads through the caller's session, so RLS decides who gets a list at all:
 * admin, ops and finance each have a SELECT policy covering merchant profiles,
 * and a merchant viewing their own ledger sees only themselves — which is why
 * the pages only ask for this when the viewer sees every merchant.
 *
 * Deactivated merchants are included on purpose. An account being closed does
 * not settle what it owes, and a ledger that quietly dropped them would hide
 * exactly the balance somebody needs to chase.
 *
 * The id is the auth user's uuid. It already reaches these roles on every
 * delivery row they can read (`merchant_id`), so this adds no exposure — and it
 * is the only key that survives a merchant being renamed, which the snapshotted
 * company name on a delivery does not.
 */
export async function listMerchantOptions(): Promise<MerchantOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, company_name, active')
    .eq('role', 'merchant')
    .order('company_name', { ascending: true });

  if (error) throw new AccountError(error.message);
  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.company_name || m.username,
    active: m.active,
  }));
}

/** Used by the merchant-phone lookup for notification messages. */
export async function findMerchantPhoneByCompany(companyName: string): Promise<string> {
  if (!companyName) return '';
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('profiles')
    .select('phone')
    .eq('role', 'merchant')
    .ilike('company_name', companyName.trim())
    .maybeSingle();
  return data?.phone ?? '';
}
