import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { listRiders } from '@/lib/riders';
import { RidersPane } from '@/components/riders/RidersPane';

export default async function RidersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Hiding the tab is presentation; this is the check that matters, and RLS is
  // the backstop under it.
  if (!roleAllows(user, 'admin', 'ops')) redirect('/portal/new');

  return <RidersPane riders={await listRiders()} />;
}
