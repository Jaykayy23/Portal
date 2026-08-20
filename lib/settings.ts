// Pricing parameters, branding and API keys.
//
// Three different audiences, so three different access paths:
//
//   pricing_params    every signed-in role reads it (the quote preview and the
//                     surge charge options need it), admin writes it — both via
//                     the user's session, under RLS.
//   delivery_options  same shape: everyone reads the item category list to pick
//                     from it, admin writes it.
//   branding          world-readable, because the login screen renders the logo
//                     before anyone signs in.
//   app_settings      granted to no public role at all. Only the service-role
//                     client touches it, after the caller has been checked as
//                     admin.

import { createSupabaseServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { DEFAULT_SURCHARGES } from './pricing';
import type {
  AppSettings,
  DeliveryOptions,
  MaskedSecret,
  OtherKey,
  PricingParams,
} from './types';
import type { Database } from './database.types';

export class SettingsError extends Error {}

// --- pricing -----------------------------------------------------------------

function toPricingParams(row: Database['public']['Tables']['pricing_params']['Row']): PricingParams {
  return {
    base: Number(row.base),
    rate: Number(row.rate),
    // `|| 0` so the portal keeps quoting on distance alone if the app is
    // deployed before the per_min migration lands, rather than NaN-ing every price.
    perMin: Number(row.per_min) || 0,
    minFare: Number(row.min_fare),
    opsPhone: row.ops_phone,
    // Same reasoning as per_min: an app deployed ahead of the surcharges
    // migration falls back to the built-in list rather than losing the field.
    surcharges: Array.isArray(row.surcharges)
      ? row.surcharges.map((s) => ({ id: s.id, label: s.label, amount: Number(s.amount) || 0 }))
      : DEFAULT_SURCHARGES,
  };
}

export async function getPricingParams(): Promise<PricingParams> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('pricing_params').select('*').eq('id', 1).single();

  if (error) throw new SettingsError(error.message);
  return toPricingParams(data);
}

/**
 * Writes only the fields present in `patch`, because the Pricing tab has two
 * separate forms — the fares and the surge charge list — and neither should
 * clobber the other's fields.
 *
 * Admin-only, enforced by RLS rather than here: the session client is used
 * deliberately so a non-admin write updates zero rows.
 */
export async function savePricingParams(patch: Partial<PricingParams>): Promise<PricingParams> {
  const supabase = await createSupabaseServerClient();
  const update: Database['public']['Tables']['pricing_params']['Update'] = {};
  if (patch.base !== undefined) update.base = patch.base;
  if (patch.rate !== undefined) update.rate = patch.rate;
  if (patch.perMin !== undefined) update.per_min = patch.perMin;
  if (patch.minFare !== undefined) update.min_fare = patch.minFare;
  if (patch.opsPhone !== undefined) update.ops_phone = patch.opsPhone;
  if (patch.surcharges !== undefined) update.surcharges = patch.surcharges;

  if (Object.keys(update).length === 0) return getPricingParams();

  const { data, error } = await supabase
    .from('pricing_params')
    .update(update)
    .eq('id', 1)
    .select('*')
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  // RLS blocks the write for non-admins, which shows up as zero rows updated.
  if (!data) throw new SettingsError('You do not have access to change pricing.');

  return toPricingParams(data);
}

// --- delivery options --------------------------------------------------------

/** Blank labels are dropped here as well as on save, so one bad row can't leave
 *  an empty option sitting in the form's dropdown. */
function toDeliveryOptions(
  row: Database['public']['Tables']['delivery_options']['Row']
): DeliveryOptions {
  return {
    itemCategories: Array.isArray(row.item_categories)
      ? row.item_categories.map((c) => String(c).trim()).filter(Boolean)
      : [],
  };
}

export async function getDeliveryOptions(): Promise<DeliveryOptions> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('delivery_options').select('*').eq('id', 1).single();

  if (error) throw new SettingsError(error.message);
  return toDeliveryOptions(data);
}

/**
 * Admin-only, enforced by RLS rather than here: the session client is used
 * deliberately so a non-admin write updates zero rows.
 */
export async function saveDeliveryOptions(
  patch: Partial<DeliveryOptions>
): Promise<DeliveryOptions> {
  if (patch.itemCategories === undefined) return getDeliveryOptions();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('delivery_options')
    .update({ item_categories: patch.itemCategories })
    .eq('id', 1)
    .select('*')
    .maybeSingle();

  if (error) throw new SettingsError(error.message);
  // RLS blocks the write for non-admins, which shows up as zero rows updated.
  if (!data) throw new SettingsError('You do not have access to change delivery options.');

  return toDeliveryOptions(data);
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
 * Describes a stored secret without disclosing it.
 *
 * The tail is only revealed on a key long enough that four characters leave it
 * unguessable — which is every real provider key, and not the short strings
 * people paste in by mistake. A blank value is reported as unset rather than as
 * an empty mask, so the page can say "not configured" outright.
 */
export function maskSecret(value: string | null | undefined): MaskedSecret {
  const v = (value ?? '').trim();
  if (!v) return { masked: '', set: false };
  return { masked: '••••••••' + (v.length >= 12 ? v.slice(-4) : ''), set: true };
}

/**
 * Settings for the admin Settings page — masked, never the real keys.
 *
 * Callers MUST have already confirmed the session is an admin. Not because the
 * masks are sensitive, but because knowing which integrations a portal has
 * configured is still not ops' or a merchant's business.
 */
export async function getAppSettingsAsAdmin(): Promise<AppSettings> {
  const admin = createAdminClient();
  const [{ data: settings, error }, logoDataUrl] = await Promise.all([
    admin.from('app_settings').select('*').eq('id', 1).single(),
    getLogoDataUrl(),
  ]);

  if (error) throw new SettingsError(error.message);
  return {
    mapsApiKey: maskSecret(settings.maps_api_key),
    whatsappOtpKey: maskSecret(settings.whatsapp_otp_key),
    smsApiKey: maskSecret(settings.sms_api_key),
    otherKeys: (settings.other_keys ?? []).map((k) => ({
      name: k.name,
      ...maskSecret(k.value),
    })),
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

/**
 * A write to one secret field.
 *
 *   a string   replace the stored value with this
 *   ''         leave whatever is stored alone — the browser never had it to
 *              send back, so a blank field means "unchanged", not "erase"
 *   null       clear it deliberately
 *   undefined  same as '': not mentioned, not touched
 */
export type SecretPatch = string | null | undefined;

export interface SaveApiKeysInput {
  mapsApiKey?: SecretPatch;
  whatsappOtpKey?: SecretPatch;
  smsApiKey?: SecretPatch;
  /**
   * The full list of named keys to keep, in order. A blank value means "keep the
   * one already stored under this name"; omitting a name deletes it.
   */
  otherKeys?: OtherKey[];
}

/** Resolves one field against what is already stored. */
function resolveSecret(next: SecretPatch): string | undefined {
  if (next === null) return '';
  if (next === undefined) return undefined;
  const trimmed = next.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Writes only what was actually supplied. Callers MUST have confirmed admin.
 *
 * The asymmetry with getAppSettingsAsAdmin() is the whole point: values come in,
 * masks go out, and nothing round-trips. That is what makes a blank field safe to
 * mean "unchanged" — the browser was never given the value it would otherwise be
 * echoing back.
 */
export async function saveApiKeysAsAdmin(patch: SaveApiKeysInput): Promise<AppSettings> {
  const admin = createAdminClient();
  const update: Database['public']['Tables']['app_settings']['Update'] = {};

  const maps = resolveSecret(patch.mapsApiKey);
  if (maps !== undefined) update.maps_api_key = maps;
  const whatsapp = resolveSecret(patch.whatsappOtpKey);
  if (whatsapp !== undefined) update.whatsapp_otp_key = whatsapp;
  const sms = resolveSecret(patch.smsApiKey);
  if (sms !== undefined) update.sms_api_key = sms;

  if (patch.otherKeys !== undefined) {
    // The stored values are needed to honour "keep this one": the browser sent a
    // name and a blank, and only this side knows what the blank stands for.
    const { data: current, error: readError } = await admin
      .from('app_settings')
      .select('other_keys')
      .eq('id', 1)
      .single();
    if (readError) throw new SettingsError(readError.message);

    const storedByName = new Map((current.other_keys ?? []).map((k) => [k.name, k.value]));

    update.other_keys = patch.otherKeys.map((k) => {
      const name = k.name.trim();
      const typed = k.value.trim();
      if (typed) return { name, value: typed };

      const stored = storedByName.get(name);
      // Renaming a key while leaving its value blank would otherwise silently
      // save an empty secret — the integration would just stop working, with
      // nothing in the UI to say why. Refusing is the kinder failure.
      if (stored === undefined) {
        throw new SettingsError(
          `Enter a value for "${name}" — a new or renamed key needs its value typed in.`
        );
      }
      return { name, value: stored };
    });
  }

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('app_settings').update(update).eq('id', 1);
    if (error) throw new SettingsError(error.message);
  }
  return getAppSettingsAsAdmin();
}
