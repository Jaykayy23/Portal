import { BrandMark } from '@/components/BrandMark';

/**
 * Shown instead of the app when required Supabase environment variables are
 * missing.
 *
 * Two audiences, and only one of them is ever on this screen in production. The
 * person who can fix this is running the deploy and has the server log, which is
 * where the variable names go. The person who actually sees it is a merchant, a
 * rider or a customer opening a delivery link — `app/d/[token]` renders this too
 * — and to them a list of NEXT_PUBLIC_* names is not a diagnosis, it is a
 * description of the inside of a system they have no way to act on.
 *
 * So the names are shown in development, where the reader is by definition the
 * one holding the keyboard, and logged everywhere.
 */
export function ConfigError({ missing }: { missing: string[] }) {
  const showDetail = process.env.NODE_ENV !== 'production';

  // Server component, so this runs once per render on the server and never in
  // the browser.
  console.error(
    `[somoexpress] Not configured: missing ${missing.join(', ')}. See .env.example.`
  );

  return (
    <div className="somo-auth-overlay">
      <div className="somo-auth-card">
        <div className="somo-auth-logo">
          <BrandMark />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Unavailable</div>
          </div>
        </div>

        <h2>The portal is unavailable</h2>
        <p className="sub-text">
          {showDetail
            ? 'The portal can’t reach its database because these environment variables are missing:'
            : 'Something is wrong with this portal’s setup, so it can’t load right now. Please try again shortly, or contact whoever administers it.'}
        </p>

        {showDetail ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  );
}
