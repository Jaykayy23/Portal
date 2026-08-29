import { redirect } from 'next/navigation';
import { missingEnv } from '@/lib/config';
import { ConfigError } from '@/components/ConfigError';
import { getSessionUser } from '@/lib/session';
import { getLogoDataUrl, getMapsApiKeyForSignedInUser, getPricingParams } from '@/lib/settings';
import { listAlertDeliveriesFor } from '@/lib/deliveries';
import { readPortalPulse } from '@/lib/portalPulse';
import { alertFeed, seatHasAlerts } from '@/lib/alerts';
import { BrandMark } from '@/components/BrandMark';
import { LogoutButton } from '@/components/LogoutButton';
import { PortalTabs } from '@/components/PortalTabs';
import { MapsProvider } from '@/components/MapsProvider';
import { PortalRefresh } from '@/components/PortalRefresh';
import { AlertBell, AlertsProvider } from '@/components/AlertBell';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // The proxy refreshes and validates the session cookie; this is the check that
  // reads the profile row, so a banned or deactivated account is locked out on its
  // very next request rather than whenever its token expires.
  const missing = missingEnv();
  if (missing.length) return <ConfigError missing={missing} />;

  const user = await getSessionUser();
  if (!user) redirect('/login');

  // The revision this render is a picture of, read before anything it describes
  // and deliberately not inside the Promise.all below.
  //
  // The poll compares this against a fresh reading and refreshes when they
  // differ, so being too low costs one unnecessary refresh — which is what used
  // to happen on every tick anyway — while being too high pins a stale screen
  // until something else happens to move the number. Reading it first is what
  // makes it too low rather than too high: any write that lands from here on has
  // already moved the counter past what the browser was handed, whether or not
  // the reads below picked that write up.
  //
  // One small read for that guarantee, on renders that this whole mechanism
  // exists to make rare. See lib/portalPulse.ts.
  const pulse = await readPortalPulse();

  // The Maps key legitimately reaches signed-in browsers (Maps JS runs
  // client-side). The provider secrets in app_settings never leave the server.
  //
  // The bell gets its own status-bounded read rather than loading the full
  // delivery-history window on every tab. A read-only seat (finance) has no
  // alerts of its own, so it pays for neither the delivery nor pricing query.
  const wantsAlerts = seatHasAlerts(user.role);
  const [logoDataUrl, mapsApiKey, records, params] = await Promise.all([
    getLogoDataUrl(),
    getMapsApiKeyForSignedInUser(),
    wantsAlerts ? listAlertDeliveriesFor(user) : Promise.resolve([]),
    wantsAlerts ? getPricingParams() : Promise.resolve(null),
  ]);

  const feed = alertFeed(user, records);

  return (
    <MapsProvider mapsApiKey={mapsApiKey}>
      <PortalRefresh pulse={pulse}>
        <AlertsProvider feed={feed} opsPhone={params?.opsPhone ?? ''}>
          <a className="somo-skip-link" href="#main-content">
            Skip to content
          </a>

          {/* Edge to edge and pinned to the top: it carries the two things that are
              true on every tab — who is signed in, and what is waiting on them. */}
          <header className="somo-header">
            <div className="somo-brand">
              <BrandMark logoDataUrl={logoDataUrl} />
              <div className="somo-brand-name">
                <div className="somo-title">SomoExpress</div>
                <div className="somo-sub">Merchant delivery portal</div>
              </div>
            </div>
            <div className="somo-header-right">
              <AlertBell />
              <div className="somo-merchant-badge">
                <span>{user.companyName}</span>
                <span className={`somo-role-tag ${user.role}`}>{user.role}</span>
                <LogoutButton />
              </div>
            </div>
          </header>

          {/* The nav is the far-left column of the window rather than a panel
              inside a centred frame, and it holds still under the topbar while the
              content scrolls. Below 900px it collapses back to a strip above the
              content, where a pinned sidebar would cost more width than it gives. */}
          <div className="somo-shell">
            <PortalTabs role={user.role} />

            <main className="somo-body" id="main-content" tabIndex={-1}>
              <div className="somo-pane">{children}</div>
            </main>
          </div>
        </AlertsProvider>
      </PortalRefresh>
    </MapsProvider>
  );
}
