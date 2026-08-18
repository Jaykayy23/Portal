import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { BrandMark } from '@/components/BrandMark';
import { LogoutButton } from '@/components/LogoutButton';
import { PortalTabs } from '@/components/PortalTabs';
import { MapsProvider } from '@/components/MapsProvider';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // middleware.ts checks the cookie's signature; this is the check that reads the
  // database, so a deactivated or deleted account is locked out immediately
  // rather than whenever its token happens to expire.
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { logoDataUrl, mapsApiKey } = getDb().appSettings;

  return (
    <MapsProvider mapsApiKey={mapsApiKey}>
      <header className="somo-header">
        <div className="somo-brand">
          <BrandMark logoDataUrl={logoDataUrl} />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Merchant delivery portal · interim</div>
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

      <PortalTabs role={user.role} />

      <div className="somo-body">
        <div className="somo-pane">{children}</div>
      </div>
    </MapsProvider>
  );
}
