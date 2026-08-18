import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getDb, updateDb } from '@/lib/db';
import type { Rider } from '@/lib/types';

export async function GET() {
  return handle(async () => {
    await requireUser('admin', 'ops');
    return NextResponse.json({ riders: Object.values(getDb().riders) });
  });
}

type CreateBody = Pick<Rider, 'name' | 'phone' | 'regNumber' | 'model'>;

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { name, phone, regNumber, model } = await readJson<CreateBody>(req);
    if (!name || !phone || !regNumber || !model) {
      badRequest('Name, phone, registration number and model are all required.');
    }

    const rider: Rider = {
      id: 'r_' + crypto.randomUUID(),
      name,
      phone,
      regNumber,
      model,
      status: 'Available',
    };
    await updateDb((d) => {
      d.riders[rider.id] = rider;
    });
    return NextResponse.json({ rider });
  });
}
