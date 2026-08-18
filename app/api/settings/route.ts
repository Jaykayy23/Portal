import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getAppSettingsAsAdmin, saveApiKeysAsAdmin, saveLogoDataUrl } from '@/lib/settings';
import type { AppSettings, OtherKey } from '@/lib/types';

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

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<AppSettings>(req);

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
    if (body.mapsApiKey !== undefined) keyPatch.mapsApiKey = String(body.mapsApiKey);
    if (body.whatsappOtpKey !== undefined) keyPatch.whatsappOtpKey = String(body.whatsappOtpKey);
    if (body.smsApiKey !== undefined) keyPatch.smsApiKey = String(body.smsApiKey);
    if (Array.isArray(body.otherKeys)) {
      keyPatch.otherKeys = body.otherKeys
        .filter((k): k is OtherKey => !!k && typeof k === 'object')
        .map((k) => ({ name: String(k.name ?? ''), value: String(k.value ?? '') }));
    }

    const settings = await saveApiKeysAsAdmin(keyPatch);
    return NextResponse.json({ settings });
  });
}
