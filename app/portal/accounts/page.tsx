import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { listAccounts } from '@/lib/accounts';
import { AccountsPane } from '@/components/accounts/AccountsPane';

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roleAllows(user, 'admin', 'ops')) redirect('/portal/new');

  // Ops sees merchants only, and can do nothing to them but create new ones. The
  // pane hides what ops can't do; the Route Handlers and RLS are what enforce it.
  const merchantsOnly = user.role === 'ops';

  // listAccounts returns PublicAccount rows only — no password material exists
  // outside Supabase Auth to leak in the first place.
  return (
    <AccountsPane
      accounts={await listAccounts(merchantsOnly ? { role: 'merchant' } : {})}
      currentUsername={user.username}
      viewerRole={user.role}
    />
  );
}
