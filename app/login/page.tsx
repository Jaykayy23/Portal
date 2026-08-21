import { redirect } from 'next/navigation';
import { missingEnv } from '@/lib/config';
import { ConfigError } from '@/components/ConfigError';
import { getLogoDataUrl } from '@/lib/settings';
import { hasAnyAccount } from '@/lib/session';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';

// Reads the database on every request, so the logo appears as soon as an admin
// uploads one rather than being baked in at build time.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const missing = missingEnv();
  if (missing.length) return <ConfigError missing={missing} />;

  if (!(await hasAnyAccount())) redirect('/setup');

  const { next } = await searchParams;
  // Only same-site paths, so ?next= can't bounce someone to another host.
  // '/portal' rather than a named tab: the index routes by role, and finance has
  // no business on the New delivery form.
  const nextPath = next && next.startsWith('/') && !next.startsWith('//') ? next : '/portal';

  return (
    <AuthShell logoDataUrl={await getLogoDataUrl()}>
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
