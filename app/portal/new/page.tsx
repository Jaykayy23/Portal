import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getPricingParams } from '@/lib/settings';
import { NewDeliveryForm } from '@/components/delivery/NewDeliveryForm';

export default async function NewDeliveryPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Pricing comes from the server, so the preview starts correct instead of
  // flashing defaults while a fetch resolves.
  return <NewDeliveryForm user={user} params={await getPricingParams()} />;
}
