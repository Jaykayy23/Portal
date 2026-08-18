import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { listAccounts } from '@/lib/accounts';
import { AccountsPane } from '@/components/accounts/AccountsPane';

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roleAllows(user, 'admin')) redirect('/portal/new');

  // listAccounts returns PublicAccount rows only — no password material exists
  // outside Supabase Auth to leak in the first place.
  return <AccountsPane accounts={await listAccounts()} currentUsername={user.username} />;
}
