import { redirect } from 'next/navigation';
import { getSessionUser, roleAllows } from '@/lib/session';
import { getPricingParams } from '@/lib/settings';
import { PricingForm } from '@/components/pricing/PricingForm';

export default async function PricingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roleAllows(user, 'admin')) redirect('/portal/new');

  return <PricingForm params={await getPricingParams()} />;
}
