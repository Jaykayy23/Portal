import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import {
  SettingsError,
  getAppSettingsAsAdmin,
  saveApiKeysAsAdmin,
  saveLogoDataUrl,
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

    try {
      const settings = await saveApiKeysAsAdmin(keyPatch);
      return NextResponse.json({ settings });
    } catch (e) {
      // "Enter a value for X" is the caller's mistake, not a server fault.
      if (e instanceof SettingsError) badRequest(e.message);
      throw e;
    }
  });
}
