import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { NewDeliveryForm } from '@/components/delivery/NewDeliveryForm';

export default async function NewDeliveryPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Pricing parameters come from the server, so the preview starts correct
  // instead of flashing the defaults while a fetch resolves.
  return <NewDeliveryForm user={user} params={getDb().pricingParams} />;
}
