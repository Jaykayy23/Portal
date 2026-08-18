import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import { calcPrice } from '@/lib/pricing';
import { listDeliveriesFor } from '@/lib/deliveries';
import { DELIVERY_TYPES, type Delivery, type DeliveryType } from '@/lib/types';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return NextResponse.json({ deliveries: listDeliveriesFor(user) });
  });
}

interface CreateBody {
  pickup: string;
  dropoff: string;
  distance: number | string;
  type?: DeliveryType;
  surcharges?: string[];
  declaredValue: number | string;
  agreed?: number | string;
  customer?: string;
}

// Price is recalculated here from the saved pricing parameters, so whatever
// recommended/minimum the browser displayed is irrelevant — a merchant cannot
// submit a fabricated price.
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson<CreateBody>(req);
    const { pickup, dropoff, distance, type, surcharges, declaredValue, agreed, customer } = body;

    if (!pickup || !dropoff || !distance) {
      badRequest('Pickup, drop-off and distance are required.');
    }
    if (!declaredValue || Number(declaredValue) <= 0) {
      badRequest('Declared value of the item is required.');
    }
    if (type !== undefined && !DELIVERY_TYPES.some((t) => t.value === type)) {
      badRequest('Invalid delivery type.');
    }

    const db = getDb();
    const { recommended, minimum } = calcPrice(
      db.pricingParams,
      distance,
      Array.isArray(surcharges) ? surcharges : []
    );

    // A merchant always files under their own company name; ops/admin may file
    // on behalf of a merchant.
    const finalCustomer =
      user.role === 'merchant' ? user.companyName : customer || user.companyName;
    const hasAgreed = agreed !== undefined && agreed !== null && agreed !== '';
    const finalAgreed = hasAgreed ? Number(agreed) : recommended;

    const record: Delivery = {
      id: 'd_' + crypto.randomUUID(),
      date: new Date().toISOString(),
      customer: finalCustomer,
      submittedBy: user.username,
      pickup,
      dropoff,
      distance: Number(distance),
      type: type || 'Standard',
      surcharges: Array.isArray(surcharges) ? surcharges : [],
      declaredValue: Number(declaredValue),
      recommended,
      minimum,
      agreed: finalAgreed,
      status: finalAgreed < minimum ? 'Requires approval' : 'Requested',
      riderId: '',
      riderName: '',
      riderPhone: '',
      riderReg: '',
      riderModel: '',
    };

    await updateDb((d) => {
      d.deliveries[record.id] = record;
    });
    return NextResponse.json({ delivery: record });
  });
}
