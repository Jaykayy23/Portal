import { redirect } from 'next/navigation';
import { missingEnv } from '@/lib/config';
import { ConfigError } from '@/components/ConfigError';
import { getLogoDataUrl } from '@/lib/settings';
import { hasAnyAccount } from '@/lib/session';
import { AuthShell } from '@/components/auth/AuthShell';
import { SetupForm } from '@/components/auth/SetupForm';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const missing = missingEnv();
  if (missing.length) return <ConfigError missing={missing} />;

  // Setup is a one-time door: once any account exists, this route is closed.
  if (await hasAnyAccount()) redirect('/login');

  return (
    <AuthShell logoDataUrl={await getLogoDataUrl()}>
      <SetupForm />
    </AuthShell>
  );
}
