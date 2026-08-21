import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { listDeliveriesFor } from '@/lib/deliveries';
import { listMerchantOptions } from '@/lib/accounts';
import { CrmDashboard } from '@/components/dashboard/CrmDashboard';
import { seesAllMerchants } from '@/lib/types';

/**
 * The dashboard — the same delivery rows as the log, counted rather than listed.
 *
 * Available to every role for the same reason the ledger is: what it can say is
 * decided by which rows the caller can read, and that is decided in Postgres. A
 * merchant's dashboard describes a merchant's own traffic; finance, ops and admin
 * see the business, with a merchant picker to narrow it.
 *
 * Signed in is the only check, for the same reason as the ledger beside it: the
 * page describes whatever rows the caller can read, and RLS is what decides
 * those.
 *
 * Nothing here is aggregated in SQL. See lib/analytics.ts for why, and for what
 * would have to change if an install ever grows past it.
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const seesAll = seesAllMerchants(user);

  const [records, merchants] = await Promise.all([
    listDeliveriesFor(user),
    seesAll ? listMerchantOptions() : Promise.resolve([]),
  ]);

  return (
    <CrmDashboard
      records={records}
      merchants={merchants}
      seesAll={seesAll}
      viewerCompany={user.companyName}
    />
  );
}
