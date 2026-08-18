import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { hasAnyAccount } from '@/lib/session';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';

// Reads db.json on every request, so the portal's logo shows up as soon as an
// admin uploads one rather than being baked in at build time.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!hasAnyAccount()) redirect('/setup');

  const { next } = await searchParams;
  // Only accept same-site paths, so ?next= can't be used to bounce someone to
  // another host after they log in.
  const nextPath = next && next.startsWith('/') && !next.startsWith('//') ? next : '/portal/new';

  return (
    <AuthShell logoDataUrl={getDb().appSettings.logoDataUrl}>
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
