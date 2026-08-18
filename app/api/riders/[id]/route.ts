import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { RiderError, setRiderStatus } from '@/lib/riders';
import { RIDER_STATUSES, type RiderStatus } from '@/lib/types';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status } = await readJson<{ status: RiderStatus }>(req);

    if (!status || !RIDER_STATUSES.includes(status)) {
      badRequest(`Invalid rider status. Expected one of: ${RIDER_STATUSES.join(', ')}.`);
    }
    try {
      return NextResponse.json({ rider: await setRiderStatus(id, status) });
    } catch (e) {
      if (e instanceof RiderError) notFound(e.message);
      throw e;
    }
  });
}
