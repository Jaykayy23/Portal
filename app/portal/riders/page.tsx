import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser, roleAllows } from '@/lib/session';
import { RidersPane } from '@/components/riders/RidersPane';

export default async function RidersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Hiding the tab is presentation; this is the check that actually matters.
  if (!roleAllows(user, 'admin', 'ops')) redirect('/portal/new');

  return <RidersPane riders={Object.values(getDb().riders)} />;
}
