import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { listDeliveriesFor } from '@/lib/deliveries';
import { DeliveryLog } from '@/components/delivery/DeliveryLog';
import { isOpsOrAdmin } from '@/lib/types';

export default async function DeliveryLogPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const canManage = isOpsOrAdmin(user);
  const db = getDb();
  // The scoping (merchants see only their own rows) happens server-side, so a
  // merchant's browser never receives another merchant's deliveries at all.
  const records = listDeliveriesFor(user);
  const riders = canManage ? Object.values(db.riders) : [];

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
        opsPhone={db.pricingParams.opsPhone}
        canManage={canManage}
      />
    </div>
  );
}
