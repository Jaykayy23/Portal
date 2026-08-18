import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { updateDb } from '@/lib/db';
import { RIDER_STATUSES, type RiderStatus } from '@/lib/types';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status } = await readJson<{ status: RiderStatus }>(req);

    if (status !== undefined && !RIDER_STATUSES.includes(status)) {
      badRequest(`Invalid rider status. Expected one of: ${RIDER_STATUSES.join(', ')}.`);
    }

    const rider = await updateDb((d) => {
      const existing = d.riders[id];
      if (!existing) return null;
      if (status) existing.status = status;
      return existing;
    });
    if (!rider) notFound('Rider not found.');

    return NextResponse.json({ rider });
  });
}
