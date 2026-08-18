import { NextResponse } from 'next/server';
import { handle, readJson, requireUser } from '@/lib/http';
import { getPricingParams, savePricingParams } from '@/lib/settings';
import type { PricingParams } from '@/lib/types';

// Every signed-in role reads pricing — merchants need it for the live preview.
export async function GET() {
  return handle(async () => {
    await requireUser();
    return NextResponse.json({ params: await getPricingParams() });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<PricingParams>(req);
    const params = await savePricingParams({
      base: Number(body.base) || 0,
      rate: Number(body.rate) || 0,
      minFare: Number(body.minFare) || 0,
      minPct: Number(body.minPct) || 0,
      opsPhone: body.opsPhone || '',
    });
    return NextResponse.json({ params });
  });
}
