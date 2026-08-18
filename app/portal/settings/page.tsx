import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser, roleAllows } from '@/lib/session';
import { SettingsPane } from '@/components/settings/SettingsPane';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // The provider API keys live in this payload, so the admin check is the only
  // thing keeping them off an ops or merchant browser.
  if (!roleAllows(user, 'admin')) redirect('/portal/new');

  return <SettingsPane settings={getDb().appSettings} />;
}
