import { BrandMark } from '@/components/BrandMark';

/** The centred card used by both the login and first-run setup screens. */
export function AuthShell({
  logoDataUrl,
  children,
}: {
  logoDataUrl: string;
  children: React.ReactNode;
}) {
  return (
    <main className="somo-auth-overlay" id="main-content">
      <div className="somo-auth-card">
        <div className="somo-auth-logo">
          <BrandMark logoDataUrl={logoDataUrl} />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Merchant delivery portal</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
