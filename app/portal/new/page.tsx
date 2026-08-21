import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { getDeliveryOptions, getPricingParams } from '@/lib/settings';
import { NewDeliveryForm } from '@/components/delivery/NewDeliveryForm';

export default async function NewDeliveryPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Finance is read-only: no INSERT policy on deliveries names the role, so the
  // form would fill in and then fail at submit. Sent to the page they came for
  // instead. RLS is the guarantee; this is what makes it not look like a bug.
  if (!roleAllows(user, 'admin', 'ops', 'merchant')) redirect('/portal/ledger');

  // Pricing and the item category list come from the server, so the preview
  // starts correct instead of flashing defaults while a fetch resolves.
  const [params, options] = await Promise.all([getPricingParams(), getDeliveryOptions()]);

  return <NewDeliveryForm user={user} params={params} options={options} />;
}
