// Pricing parameters, branding and API keys.
//
// Three different audiences, so three different access paths:
//
//   pricing_params  every signed-in role reads it (the quote preview needs it),
//                   admin writes it — both via the user's session, under RLS.
//   branding        world-readable, because the login screen renders the logo
//                   before anyone signs in.
//   app_settings    granted to no public role at all. Only the service-role
//                   client touches it, after the caller has been checked as admin.

import { createSupabaseServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import type { AppSettings, OtherKey, PricingParams } from './types';
import type { Database } from './database.types';

export class SettingsError extends Error {}

// --- pricing -----------------------------------------------------------------

export async function getPricingParams(): Promise<PricingParams> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('pricing_params').select('*').eq('id', 1).single();

  if (error) throw new SettingsError(error.message);
  return {
    base: Number(data.base),
    rate: Number(data.rate),
    // `|| 0` so the portal keeps quoting on distance alone if the app is
    // deployed before the per_min migration lands, rather than NaN-ing every price.
    perMin: Number(data.per_min) || 0,
    minFare: Number(data.min_fare),
    minPct: Number(data.min_pct),
    opsPhone: data.ops_phone,
  };
}

export async function savePricingParams(params: PricingParams): Promise<PricingParams> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('pricing_params')
    .update({
      base: params.base,
      rate: params.rate,
      per_min: params.perMin,
      min_fare: params.minFare,
      min_pct: params.minPct,
      ops_phone: params.opsPhone,
    })
    .eq('id', 1)
    .select('*')
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  // RLS blocks the write for non-admins, which shows up as zero rows updated.
  if (!data) throw new SettingsError('You do not have access to change pricing.');

  return {
    base: Number(data.base),
    rate: Number(data.rate),
    // `|| 0` so the portal keeps quoting on distance alone if the app is
    // deployed before the per_min migration lands, rather than NaN-ing every price.
    perMin: Number(data.per_min) || 0,
    minFare: Number(data.min_fare),
    minPct: Number(data.min_pct),
    opsPhone: data.ops_phone,
  };
}

// --- branding ----------------------------------------------------------------

/**
 * The logo. Read with the admin client because the login and setup screens call
 * this with no session at all, and it must not fail there.
 */
export async function getLogoDataUrl(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('branding')
    .select('logo_data_url')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  return data?.logo_data_url ?? '';
}

export async function saveLogoDataUrl(logoDataUrl: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('branding')
    .update({ logo_data_url: logoDataUrl })
    .eq('id', 1)
    .select('logo_data_url')
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  if (!data) throw new SettingsError('You do not have access to change branding.');
  return data.logo_data_url;
}

// --- API keys ----------------------------------------------------------------

/**
 * Full settings including the WhatsApp/SMS provider keys.
 *
 * Callers MUST have already confirmed the session is an admin — the service-role
 * client bypasses RLS, so this function is not self-protecting.
 */
export async function getAppSettingsAsAdmin(): Promise<AppSettings> {
  const admin = createAdminClient();
  const [{ data: settings, error }, logoDataUrl] = await Promise.all([
    admin.from('app_settings').select('*').eq('id', 1).single(),
    getLogoDataUrl(),
  ]);

  if (error) throw new SettingsError(error.message);
  return {
    mapsApiKey: settings.maps_api_key,
    whatsappOtpKey: settings.whatsapp_otp_key,
    smsApiKey: settings.sms_api_key,
    otherKeys: settings.other_keys ?? [],
    logoDataUrl,
  };
}

/**
 * Just the Maps key, for the portal layout to hand to the browser.
 *
 * This is the one key that legitimately reaches a signed-in client, because the
 * Maps JavaScript SDK runs there. Restrict it by HTTP referrer in Google Cloud
 * Console. Callers must have confirmed a session first.
 */
export async function getMapsApiKeyForSignedInUser(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('maps_api_key')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  return data?.maps_api_key ?? '';
}

export interface SaveApiKeysInput {
  mapsApiKey?: string;
  whatsappOtpKey?: string;
  smsApiKey?: string;
  otherKeys?: OtherKey[];
}

/** Callers MUST have already confirmed the session is an admin. */
export async function saveApiKeysAsAdmin(patch: SaveApiKeysInput): Promise<AppSettings> {
  const admin = createAdminClient();
  const update: Database['public']['Tables']['app_settings']['Update'] = {};
  if (patch.mapsApiKey !== undefined) update.maps_api_key = patch.mapsApiKey;
  if (patch.whatsappOtpKey !== undefined) update.whatsapp_otp_key = patch.whatsappOtpKey;
  if (patch.smsApiKey !== undefined) update.sms_api_key = patch.smsApiKey;
  if (patch.otherKeys !== undefined) update.other_keys = patch.otherKeys;

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('app_settings').update(update).eq('id', 1);
    if (error) throw new SettingsError(error.message);
  }
  return getAppSettingsAsAdmin();
}
