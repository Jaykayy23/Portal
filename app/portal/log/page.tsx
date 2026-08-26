import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { getPricingParams } from '@/lib/settings';
import { deliveryHistoryRange, listDeliveriesFor } from '@/lib/deliveries';
import { listRiders } from '@/lib/riders';
import { listSettlementMarks } from '@/lib/settlements';
import { riderFloat, toLedger } from '@/lib/ledger';
import { IncompleteHistoryNotice } from '@/components/IncompleteHistoryNotice';
import { DeliveryLog } from '@/components/delivery/DeliveryLog';
import { isOpsOrAdmin } from '@/lib/types';

export default async function DeliveryLogPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // The log is the operational screen — assigning riders, sending alerts,
  // confirming pickups. Finance watches the money on the ledger instead.
  if (!roleAllows(user, 'admin', 'ops', 'merchant')) redirect('/portal/ledger');

  const canManage = isOpsOrAdmin(user);
  // Scoping is enforced by the RLS SELECT policy, so a merchant's browser never
  // receives another merchant's deliveries at all.
  // One window for both reads: a mark belongs to a delivery, so they have to be
  // asked the same question about the same period.
  const range = deliveryHistoryRange();

  const [history, riders, settled, params] = await Promise.all([
    listDeliveriesFor(user, range),
    canManage ? listRiders() : Promise.resolve([]),
    // Only for the rider dropdown's float check, so a merchant — who assigns
    // nobody — does not pay for the query.
    canManage
      ? listSettlementMarks(range)
      : Promise.resolve({ marks: new Map(), truncated: false }),
    getPricingParams(),
  ]);

  // Which riders are past the 48-hour float deadline. The database refuses the
  // assignment either way; this is so the dropdown says why.
  const floats = canManage ? riderFloat(toLedger(history.records, settled.marks)) : [];

  return (
    <>
      <IncompleteHistoryNotice
        deliveries={history.truncated}
        marks={settled.truncated}
        loaded={history.records.length}
      />
      <div className="somo-card" style={{ marginTop: 0 }}>
        <h3>
          {canManage ? 'All deliveries' : 'My delivery log'}
          <span className="tag-note">
            {canManage ? `${user.role} view — every merchant` : 'visible only to you'}
          </span>
        </h3>
        <DeliveryLog
          records={history.records}
          riders={riders}
          floats={floats}
          opsPhone={params.opsPhone}
          canManage={canManage}
        />
      </div>
    </>
  );
}
