import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import {
  SettingsError,
  getAppSettingsAsAdmin,
  saveApiKeysAsAdmin,
  saveLogoDataUrl,
  saveTwilioSettingsAsAdmin,
  type SaveTwilioInput,
} from '@/lib/settings';
import type { OtherKey } from '@/lib/types';

/**
 * The request body, which is not the same shape as the response.
 *
 * Keys arrive as real values and leave as masks, so this cannot be typed as
 * AppSettings — that type carries MaskedSecret and deliberately has no way to
 * express a real key travelling outward.
 *
 * A secret field may be a string (replace), '' or absent (leave alone), or null
 * (clear). The three-way distinction is why these are read off the raw body
 * rather than coerced with String().
 */
interface SettingsBody {
  logoDataUrl?: string;
  mapsApiKey?: string | null;
  whatsappOtpKey?: string | null;
  smsApiKey?: string | null;
  otherKeys?: OtherKey[];
  /**
   * The Twilio SMS configuration, as its own object because it is saved by its
   * own form. `authSecret` follows the three-way secret convention above;
   * the identifiers alongside it do not — see SaveTwilioInput for why.
   */
  twilio?: {
    enabled?: boolean;
    accountSid?: string;
    apiKeySid?: string;
    authSecret?: string | null;
    fromNumber?: string;
    messagingServiceSid?: string;
  };
}

/** Preserves null-versus-absent, which String() would flatten to "null". */
function secretField(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return String(value);
}

// Full settings, including the WhatsApp/SMS provider keys. Admin only — and this
// requireUser call is the only thing standing between those keys and the caller,
// because app_settings is read with the service-role client.
export async function GET() {
  return handle(async () => {
    await requireUser('admin');
    return NextResponse.json({ settings: await getAppSettingsAsAdmin() });
  });
}

// Logos arrive as base64 data URLs. Cap the payload so a large upload can't bloat
// the row to the point where every read pays to transfer it.
const MAX_LOGO_CHARS = 1_400_000; // ~1MB of image once base64-decoded

// The extra keys are free-form, so they get the same treatment as the logo: a cap,
// so a paste cannot bloat a singleton row that every settings read pays to
// transfer. Generous enough that no real integration hits them.
const MAX_OTHER_KEYS = 40;
const MAX_KEY_NAME_CHARS = 120;
const MAX_KEY_VALUE_CHARS = 4_000;

// The Twilio fields have known shapes, so these are not really limits — they are
// a floor under the length checks, so a megabyte pasted into the Account SID box
// is rejected before a regex runs over it. lib/twilioConfig.ts is what actually
// decides whether the contents are valid, and says so in a usable sentence.
const MAX_TWILIO_FIELD_CHARS = 200;

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<SettingsBody>(req);

    if (body.logoDataUrl !== undefined) {
      const logo = String(body.logoDataUrl);
      if (logo && !logo.startsWith('data:image/')) {
        badRequest('The logo must be an image data URL.');
      }
      if (logo.length > MAX_LOGO_CHARS) {
        badRequest('That logo is too large — please use an image under about 1MB.');
      }
      await saveLogoDataUrl(logo);
    }

    const keyPatch: Parameters<typeof saveApiKeysAsAdmin>[0] = {};
    if ('mapsApiKey' in body) keyPatch.mapsApiKey = secretField(body.mapsApiKey);
    if ('whatsappOtpKey' in body) keyPatch.whatsappOtpKey = secretField(body.whatsappOtpKey);
    if ('smsApiKey' in body) keyPatch.smsApiKey = secretField(body.smsApiKey);

    if (Array.isArray(body.otherKeys)) {
      const named = body.otherKeys
        .filter((k): k is OtherKey => !!k && typeof k === 'object')
        .map((k) => ({ name: String(k.name ?? '').trim(), value: String(k.value ?? '') }))
        // A row with no name is one the admin added and never filled in.
        .filter((k) => k.name !== '');

      if (named.length > MAX_OTHER_KEYS) {
        badRequest(`That is more than ${MAX_OTHER_KEYS} extra keys — remove a few.`);
      }
      for (const k of named) {
        if (k.name.length > MAX_KEY_NAME_CHARS || k.value.length > MAX_KEY_VALUE_CHARS) {
          badRequest(`"${k.name.slice(0, 40)}" is too long to be a key name or value.`);
        }
      }
      // Two rows under one name would make "keep the stored value" ambiguous.
      const names = new Set(named.map((k) => k.name.toLowerCase()));
      if (names.size !== named.length) badRequest('Two extra keys share the same name.');

      keyPatch.otherKeys = named;
    }

    // Saved through its own function rather than folded into the key patch,
    // because it is the one group of settings with rules that span its fields —
    // "on" is only allowed over a complete configuration. Its own form on the
    // page, its own save, its own validation.
    let twilioPatch: SaveTwilioInput | null = null;
    if (body.twilio) {
      const t = body.twilio;
      twilioPatch = {};
      if ('enabled' in t) twilioPatch.enabled = !!t.enabled;

      if ('authSecret' in t) {
        const secret = secretField(t.authSecret);
        if (typeof secret === 'string' && secret.length > MAX_TWILIO_FIELD_CHARS) {
          badRequest('That is too long to be a Twilio Auth Token or API Key Secret.');
        }
        twilioPatch.authSecret = secret;
      }

      // Identifiers, where '' is a deliberate "clear this" rather than silence —
      // the opposite of the secret above, and for the reason set out on
      // SaveTwilioInput.
      for (const field of ['accountSid', 'apiKeySid', 'fromNumber', 'messagingServiceSid'] as const) {
        if (!(field in t)) continue;
        const value = String(t[field] ?? '');
        if (value.length > MAX_TWILIO_FIELD_CHARS) {
          badRequest('That is too long to be a Twilio SID, number or sender name.');
        }
        twilioPatch[field] = value;
      }
    }

    try {
      // Both are applied when a request carries both. The page posts one form at
      // a time, so in practice only one runs — but silently dropping half of a
      // request that mentioned both would be the worse kind of surprise. Keys
      // first, so a Twilio refusal cannot strand an unrelated Maps key.
      let settings = Object.keys(keyPatch).length ? await saveApiKeysAsAdmin(keyPatch) : null;
      if (twilioPatch) settings = await saveTwilioSettingsAsAdmin(twilioPatch);

      // A logo-only save mentions neither, and still owes the page fresh masks.
      return NextResponse.json({ settings: settings ?? (await getAppSettingsAsAdmin()) });
    } catch (e) {
      // "Enter a value for X" is the caller's mistake, not a server fault. So is
      // every sentence twilioConfigProblem() produces.
      if (e instanceof SettingsError) badRequest(e.message);
      throw e;
    }
  });
}
