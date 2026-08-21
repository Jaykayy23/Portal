import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { listDeliveriesFor } from '@/lib/deliveries';
import { listMerchantOptions } from '@/lib/accounts';
import { LedgerPane } from '@/components/ledger/LedgerPane';
import { seesAllMerchants } from '@/lib/types';

/**
 * The ledger — every role's view of where the money is.
 *
 * Finance exists for this page; ops and admin get it beside their operational
 * tabs; a merchant gets the same page narrowed to their own company, which
 * happens in Postgres rather than here. `listDeliveriesFor` reads through the
 * caller's session, so the RLS SELECT policy decides what is in the array before
 * any of the filtering in the pane applies.
 *
 * Read-only for everybody, including admin. The money position is derived from
 * the delivery's status and payment terms, so changing it means changing the
 * delivery — which is what the log is for.
 *
 * Signed in is the only check here, on purpose. Every role the portal has may
 * read a ledger, and what a role can *see* in one is decided by the RLS SELECT
 * policy — a role with no policy on `deliveries` gets an empty page rather than
 * somebody else's figures. That also makes this the safe place for the gated
 * pages to send a role they turn away: it cannot bounce anyone back, so the pair
 * cannot form a redirect loop.
 */
export default async function LedgerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const seesAll = seesAllMerchants(user);

  const [records, merchants] = await Promise.all([
    listDeliveriesFor(user),
    // A merchant's picker would hold exactly one entry — their own name — so it
    // is not asked for, and the pane hides the control.
    seesAll ? listMerchantOptions() : Promise.resolve([]),
  ]);

  return (
    <LedgerPane
      records={records}
      merchants={merchants}
      seesAll={seesAll}
      viewerCompany={user.companyName}
    />
  );
}
