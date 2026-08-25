import { redirect } from 'next/navigation';
import { missingEnv } from '@/lib/config';
import { ConfigError } from '@/components/ConfigError';
import { getSessionUser } from '@/lib/session';
import { getLogoDataUrl, getMapsApiKeyForSignedInUser } from '@/lib/settings';
import { BrandMark } from '@/components/BrandMark';
import { LogoutButton } from '@/components/LogoutButton';
import { PortalTabs } from '@/components/PortalTabs';
import { MapsProvider } from '@/components/MapsProvider';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // The proxy refreshes and validates the session cookie; this is the check that
  // reads the profile row, so a banned or deactivated account is locked out on its
  // very next request rather than whenever its token expires.
  const missing = missingEnv();
  if (missing.length) return <ConfigError missing={missing} />;

  const user = await getSessionUser();
  if (!user) redirect('/login');

  // The Maps key legitimately reaches signed-in browsers (Maps JS runs
  // client-side). The provider secrets in app_settings never leave the server.
  const [logoDataUrl, mapsApiKey] = await Promise.all([
    getLogoDataUrl(),
    getMapsApiKeyForSignedInUser(),
  ]);

  return (
    <MapsProvider mapsApiKey={mapsApiKey}>
      <a className="somo-skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="somo-header">
        <div className="somo-brand">
          <BrandMark logoDataUrl={logoDataUrl} />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Merchant delivery portal</div>
          </div>
        </div>
        <div className="somo-header-right">
          <div className="somo-merchant-badge">
            <span>{user.companyName}</span>
            <span className={`somo-role-tag ${user.role}`}>{user.role}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Nav beside the content, not above it. The row collapses back to a
          stacked block under 900px, where the strip is the better layout. */}
      <div className="somo-shell">
        <PortalTabs role={user.role} />

        <main className="somo-body" id="main-content" tabIndex={-1}>
          <div className="somo-pane">{children}</div>
        </main>
      </div>
    </MapsProvider>
  );
}
