import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { RiderError, setRiderStatus } from '@/lib/riders';
import { RIDER_STATUSES, type RiderStatus } from '@/lib/types';
import { logActivity } from '@/lib/activity';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops');
    const { id } = await ctx.params;
    const { status } = await readJson<{ status: RiderStatus }>(req);

    if (!status || !RIDER_STATUSES.includes(status)) {
      badRequest(`Invalid rider status. Expected one of: ${RIDER_STATUSES.join(', ')}.`);
    }
    try {
      const rider = await setRiderStatus(id, status);

      logActivity({
        actor: user,
        action: 'rider.status_changed',
        entityType: 'rider',
        entityId: rider.id,
        entityLabel: rider.name,
        details: { to: rider.status },
      });

      return NextResponse.json({ rider });
    } catch (e) {
      if (e instanceof RiderError) notFound(e.message);
      throw e;
    }
  });
}
