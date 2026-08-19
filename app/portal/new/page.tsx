import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { getDeliveryOptions, getPricingParams } from '@/lib/settings';
import { NewDeliveryForm } from '@/components/delivery/NewDeliveryForm';

export default async function NewDeliveryPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Pricing and the item category list come from the server, so the preview
  // starts correct instead of flashing defaults while a fetch resolves.
  const [params, options] = await Promise.all([getPricingParams(), getDeliveryOptions()]);

  return <NewDeliveryForm user={user} params={params} options={options} />;
}
