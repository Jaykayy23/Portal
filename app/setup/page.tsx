import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { hasAnyAccount } from '@/lib/session';
import { AuthShell } from '@/components/auth/AuthShell';
import { SetupForm } from '@/components/auth/SetupForm';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  // Setup is a one-time door: once any account exists, this route is closed.
  if (hasAnyAccount()) redirect('/login');

  return (
    <AuthShell logoDataUrl={getDb().appSettings.logoDataUrl}>
      <SetupForm />
    </AuthShell>
  );
}
