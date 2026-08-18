import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import type { AppSettings, OtherKey } from '@/lib/types';

// Full settings, including the WhatsApp/SMS provider keys. Admin only.
export async function GET() {
  return handle(async () => {
    await requireUser('admin');
    return NextResponse.json({ settings: getDb().appSettings });
  });
}

// Logos arrive as base64 data URLs. Cap the whole payload so a large upload
// can't bloat db.json to the point where every request pays to parse it.
const MAX_LOGO_CHARS = 1_400_000; // ~1MB of image once base64-decoded

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<AppSettings>(req);
    const patch: Partial<AppSettings> = {};

    if (body.mapsApiKey !== undefined) patch.mapsApiKey = String(body.mapsApiKey);
    if (body.whatsappOtpKey !== undefined) patch.whatsappOtpKey = String(body.whatsappOtpKey);
    if (body.smsApiKey !== undefined) patch.smsApiKey = String(body.smsApiKey);

    if (Array.isArray(body.otherKeys)) {
      patch.otherKeys = body.otherKeys
        .filter((k): k is OtherKey => !!k && typeof k === 'object')
        .map((k) => ({ name: String(k.name ?? ''), value: String(k.value ?? '') }));
    }

    if (body.logoDataUrl !== undefined) {
      const logo = String(body.logoDataUrl);
      if (logo && !logo.startsWith('data:image/')) {
        badRequest('The logo must be an image data URL.');
      }
      if (logo.length > MAX_LOGO_CHARS) {
        badRequest('That logo is too large — please use an image under about 1MB.');
      }
      patch.logoDataUrl = logo;
    }

    const settings = await updateDb((d) => {
      d.appSettings = { ...d.appSettings, ...patch };
      return d.appSettings;
    });
    return NextResponse.json({ settings });
  });
}
