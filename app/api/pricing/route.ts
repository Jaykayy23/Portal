import { NextResponse } from 'next/server';
import { handle, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import type { PricingParams } from '@/lib/types';

// Every signed-in role reads pricing — merchants need it for the live preview.
export async function GET() {
  return handle(async () => {
    await requireUser();
    return NextResponse.json({ params: getDb().pricingParams });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<PricingParams>(req);
    const params: PricingParams = {
      base: Number(body.base) || 0,
      rate: Number(body.rate) || 0,
      minFare: Number(body.minFare) || 0,
      minPct: Number(body.minPct) || 0,
      opsPhone: body.opsPhone || '',
    };
    await updateDb((d) => {
      d.pricingParams = params;
    });
    return NextResponse.json({ params });
  });
}
