import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getPricingParams } from '@/lib/settings';
import { listDeliveriesFor } from '@/lib/deliveries';
import { listRiders } from '@/lib/riders';
import { DeliveryLog } from '@/components/delivery/DeliveryLog';
import { isOpsOrAdmin } from '@/lib/types';

export default async function DeliveryLogPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const canManage = isOpsOrAdmin(user);
  // Scoping is enforced by the RLS SELECT policy, so a merchant's browser never
  // receives another merchant's deliveries at all.
  const [records, riders, params] = await Promise.all([
    listDeliveriesFor(user),
    canManage ? listRiders() : Promise.resolve([]),
    getPricingParams(),
  ]);

  return (
    <div className="somo-card" style={{ marginTop: 0 }}>
      <h3>
        <span className="n">—</span> {canManage ? 'All deliveries' : 'My delivery log'}
        <span className="tag-note">
          {canManage ? `${user.role} view — every merchant` : 'visible only to you'}
        </span>
      </h3>
      <DeliveryLog
        records={records}
        riders={riders}
        opsPhone={params.opsPhone}
        canManage={canManage}
      />
    </div>
  );
}
