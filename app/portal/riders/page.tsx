import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { listRiders } from '@/lib/riders';
import { deliveryHistoryRange, listDeliveriesFor } from '@/lib/deliveries';
import { listSettlementMarks } from '@/lib/settlements';
import { riderFloat, toLedger } from '@/lib/ledger';
import { IncompleteHistoryNotice } from '@/components/IncompleteHistoryNotice';
import { RidersPane } from '@/components/riders/RidersPane';

export default async function RidersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Hiding the tab is presentation; this is the check that matters, and RLS is
  // the backstop under it.
  if (!roleAllows(user, 'admin', 'ops')) redirect('/portal/new');

  // The roster on its own cannot say why a rider is unassignable, because the
  // reason is money. Same three reads the ledger does, and RLS scopes them the
  // same way.
  const range = deliveryHistoryRange();

  const [riders, history, settled] = await Promise.all([
    listRiders(),
    listDeliveriesFor(user, range),
    listSettlementMarks(range),
  ]);

  return (
    <>
      {/* A float is a subtraction — deliveries carried, less money remitted — so
          a gap in either read moves it, and the number decides whether a rider
          may be given another job. */}
      <IncompleteHistoryNotice
        deliveries={history.truncated}
        marks={settled.truncated}
        loaded={history.records.length}
      />
      <RidersPane
        riders={riders}
        floats={riderFloat(toLedger(history.records, settled.marks))}
      />
    </>
  );
}
