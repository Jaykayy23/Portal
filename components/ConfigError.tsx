import { BrandMark } from '@/components/BrandMark';

/**
 * Shown instead of the app when required Supabase environment variables are
 * missing. Names the exact variables rather than leaving a 500 in the logs as the
 * only clue.
 */
export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <div className="somo-auth-overlay">
      <div className="somo-auth-card">
        <div className="somo-auth-logo">
          <BrandMark />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Not configured</div>
          </div>
        </div>

        <h2>Supabase isn&rsquo;t configured</h2>
        <p className="sub-text">
          The portal can&rsquo;t reach its database because these environment
          variables are missing:
        </p>

        <div className="somo-price-box">
          {missing.map((name) => (
            <div className="somo-price-row" key={name}>
              <span className="v" style={{ fontSize: 13 }}>
                {name}
              </span>
            </div>
          ))}
        </div>

        <div className="somo-note">
          Copy them from your Supabase dashboard under <strong>Project Settings → API
          keys</strong> into <code>.env</code> (see <code>.env.example</code>), then restart the
          server. Note that the two <code>NEXT_PUBLIC_</code> values are read at build time, so a
          production deploy needs them present during <code>npm run build</code>.
        </div>
      </div>
    </div>
  );
}
