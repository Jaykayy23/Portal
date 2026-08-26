import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { deliveryHistoryRange, listDeliveriesFor } from '@/lib/deliveries';
import { listMerchantOptions } from '@/lib/accounts';
import { listSettlementMarks, listSettlements } from '@/lib/settlements';
import { IncompleteHistoryNotice } from '@/components/IncompleteHistoryNotice';
import { LedgerPane } from '@/components/ledger/LedgerPane';
import { canRecordSettlements, seesAllMerchants } from '@/lib/types';

/**
 * The ledger — every role's view of where the money is.
 *
 * Finance exists for this page; ops and admin get it beside their operational
 * tabs; a merchant gets the same page narrowed to their own company, which
 * happens in Postgres rather than here. Every query below reads through the
 * caller's session, so the RLS SELECT policies decide what is in the arrays
 * before any of the filtering in the pane applies.
 *
 * Signed in is the only check here, on purpose. Every role the portal has may
 * read a ledger, and what a role can *see* in one is decided by those policies —
 * a role with no policy on `deliveries` gets an empty page rather than somebody
 * else's figures. That also makes this the safe place for the gated pages to send
 * a role they turn away: it cannot bounce anyone back, so the pair cannot form a
 * redirect loop.
 *
 * The one thing this page writes is settlements, and only for the roles that may:
 * see `canRecordSettlements`, and the two database functions behind it, which are
 * the only path to those tables and re-check the role themselves.
 */
export default async function LedgerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const seesAll = seesAllMerchants(user);

  // Computed once and shared. Both reads take the same window, and asking for it
  // twice could straddle UTC midnight and give the marks a different start date
  // from the deliveries they belong to — as well as missing React's cache.
  const range = deliveryHistoryRange();

  const [history, settled, settlements, merchants] = await Promise.all([
    listDeliveriesFor(user, range),
    listSettlementMarks(range),
    listSettlements(),
    // A merchant's picker would hold exactly one entry — their own name — so it
    // is not asked for, and the pane hides the control.
    seesAll ? listMerchantOptions() : Promise.resolve([]),
  ]);

  return (
    <>
      <IncompleteHistoryNotice
        deliveries={history.truncated}
        marks={settled.truncated}
        loaded={history.records.length}
      />
      <LedgerPane
        records={history.records}
        // A plain object rather than the Map, so what crosses into the client
        // component does not depend on the framework's serialiser handling Maps.
        marks={Object.fromEntries(settled.marks)}
        settlements={settlements}
        merchants={merchants}
        seesAll={seesAll}
        canRecord={canRecordSettlements(user)}
        viewerCompany={user.companyName}
      />
    </>
  );
}
