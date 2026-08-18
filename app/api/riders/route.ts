import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { RiderError, createRider, listRiders } from '@/lib/riders';

export async function GET() {
  return handle(async () => {
    await requireUser('admin', 'ops');
    return NextResponse.json({ riders: await listRiders() });
  });
}

interface CreateBody {
  name: string;
  phone: string;
  regNumber: string;
  model: string;
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { name, phone, regNumber, model } = await readJson<CreateBody>(req);
    if (!name || !phone || !regNumber || !model) {
      badRequest('Name, phone, registration number and model are all required.');
    }
    try {
      return NextResponse.json({ rider: await createRider({ name, phone, regNumber, model }) });
    } catch (e) {
      if (e instanceof RiderError) badRequest(e.message);
      throw e;
    }
  });
}
