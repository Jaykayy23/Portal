// Static theme reference: renders the .somo-* chrome with dummy data so the light
// theme can be reviewed without a database connection.
//
// Development only — notFound() in production, so this cannot ship even if it is
// forgotten. Safe to delete this whole directory (and the '/theme-preview' entry
// in lib/supabase/middleware.ts) once you're happy with the palette.
import { notFound } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';

export default function ThemePreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <>
      <header className="somo-header">
        <div className="somo-brand">
          <BrandMark />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Merchant delivery portal · interim</div>
          </div>
        </div>
        <div className="somo-header-right">
          <div className="somo-merchant-badge">
            <span>ops.admin</span>
            <span className="somo-role-tag admin">admin</span>
            <button>Log out</button>
          </div>
        </div>
      </header>

      <nav className="somo-tabs">
        <span className="somo-tab">New delivery</span>
        <span className="somo-tab active">My deliveries</span>
        <span className="somo-tab">Riders</span>
        <span className="somo-tab">Pricing settings</span>
      </nav>

      <div className="somo-body">
        <div className="somo-grid">
          <div className="somo-card">
            <h3><span className="n">01</span> Trip details</h3>
            <div className="somo-route">
              <div className="dot a" /><div className="line"><div className="line-fill" style={{ width: '40%' }} /></div>
              <div className="dot b" /><div className="dist">8.0 km</div>
            </div>
            <label className="somo-field"><span>Pickup location</span>
              <input className="somo-input" placeholder="e.g. Osu, Oxford Street" /></label>
            <label className="somo-field"><span>Driving distance (km)</span>
              <div className="somo-inline-btn-row">
                <input className="somo-input" defaultValue="8" />
                <button className="somo-mini-btn">Get from Maps</button>
              </div></label>
            <label className="somo-field"><span>Surcharges</span>
              <div className="somo-checks">
                <label className="somo-check checked"><input type="checkbox" defaultChecked /> Same-day rush (+GHS 15)</label>
                <label className="somo-check"><input type="checkbox" /> Fragile handling (+GHS 10)</label>
              </div></label>
            <div className="somo-note">Used for handling care and liability.</div>
          </div>

          <div className="somo-card">
            <h3><span className="n">02</span> Recommended price</h3>
            <div className="somo-price-box">
              <div className="somo-price-row main"><span className="l">Recommended</span><span className="v">GHS 67.00</span></div>
              <div className="somo-divider" />
              <div className="somo-price-row"><span className="l">Minimum negotiable</span><span className="v">GHS 56.95</span></div>
            </div>
            <div className="somo-flag show">⚠ Agreed price is below the minimum negotiable price.</div>
            <button className="somo-btn">Log delivery request</button>
          </div>
        </div>

        <div className="somo-card">
          <h3><span className="n">—</span> All deliveries<span className="tag-note">admin view</span></h3>
          <div className="somo-table-wrap">
            <table className="somo-table">
              <thead><tr><th>Date</th><th>Customer</th><th>Route</th><th>Recommended</th><th>Status</th><th>Alerts</th></tr></thead>
              <tbody>
                <tr><td>Aug 18 11:36</td><td>Jumia</td><td>Osu → East Legon</td>
                  <td className="somo-price-cell">GHS 67.00</td>
                  <td><span className="somo-badge b-requested">Requested</span></td>
                  <td><button className="somo-notify-btn">🔔 Notify</button></td></tr>
                <tr><td>Aug 18 11:31</td><td>Mr Wu</td><td>Accra Mall → Tema</td>
                  <td className="somo-price-cell">GHS 112.00</td>
                  <td><span className="somo-badge b-approval">Requires approval</span></td>
                  <td><button className="somo-notify-btn">🔔 Notify</button></td></tr>
                <tr><td>Aug 18 10:02</td><td>Jumia</td><td>Osu → Airport</td>
                  <td className="somo-price-cell">GHS 77.00</td>
                  <td><span className="somo-badge b-assigned">Assigned</span></td>
                  <td><button className="somo-notify-btn">🔔 Notify</button></td></tr>
                <tr><td>Aug 17 16:20</td><td>Mr Wu</td><td>Tema → Spintex</td>
                  <td className="somo-price-cell">GHS 54.00</td>
                  <td><span className="somo-badge b-delivered">Delivered</span></td>
                  <td><button className="somo-notify-btn">🔔 Notify</button></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="somo-card">
          <h3><span className="n">—</span> Accounts &amp; riders</h3>
          <div className="somo-account-card">
            <div><div className="name">Jumia <span className="somo-role-tag merchant" style={{ marginLeft: 6 }}>merchant</span></div>
              <div className="sub">@jumia.gh · 024 333 4444 · active</div></div>
            <div className="right">
              <button className="somo-mini-btn">Reset password</button>
              <button className="somo-mini-btn">Deactivate</button></div>
          </div>
          <div className="somo-account-card">
            <div><div className="name">ops1 <span className="somo-role-tag ops" style={{ marginLeft: 6 }}>ops</span></div>
              <div className="sub">@ops1 · 024 222 1111 · active</div></div>
            <div className="right"><button className="somo-mini-btn">Reset password</button></div>
          </div>
          <div className="somo-notify-contact" style={{ marginTop: 14 }}>
            <div className="who">Ops team</div><div className="num">024 555 0000</div>
            <div className="btns"><a className="wa" href="#">Open WhatsApp</a><a className="sms" href="#">Open SMS</a></div>
          </div>
          <div className="somo-btn-row" style={{ marginTop: 14 }}>
            <button className="somo-btn small">Add rider</button>
            <button className="somo-btn ghost small">Remove logo</button>
          </div>
        </div>
      </div>
    </>
  );
}
