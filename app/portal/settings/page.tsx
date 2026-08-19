import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { getAppSettingsAsAdmin, getDeliveryOptions } from '@/lib/settings';
import { SettingsPane } from '@/components/settings/SettingsPane';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // The provider API keys are in this payload, and it is fetched with the
  // service-role client, so this admin check is the only thing keeping them off
  // an ops or merchant browser.
  if (!roleAllows(user, 'admin')) redirect('/portal/new');

  const [settings, options] = await Promise.all([getAppSettingsAsAdmin(), getDeliveryOptions()]);
  return <SettingsPane settings={settings} options={options} />;
}
