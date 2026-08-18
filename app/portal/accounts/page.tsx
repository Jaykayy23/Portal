import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser, publicAccount, roleAllows } from '@/lib/session';
import { AccountsPane } from '@/components/accounts/AccountsPane';

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roleAllows(user, 'admin')) redirect('/portal/new');

  // publicAccount() strips the bcrypt hash before anything crosses to the client.
  const accounts = Object.values(getDb().accounts).map(publicAccount);
  return <AccountsPane accounts={accounts} currentUsername={user.username} />;
}
