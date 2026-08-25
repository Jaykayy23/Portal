// Static theme reference: renders the .somo-* chrome with dummy data so the light
// theme can be reviewed without a database connection.
//
// Development only — notFound() in production, so this cannot ship even if it is
// forgotten. Safe to delete this whole directory (and the '/theme-preview' entry
// in lib/supabase/middleware.ts) once you're happy with the palette.
import { notFound } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { ScrollableTable } from '@/components/ScrollableTable';
import { Bell, Download, Minimize2, RefreshCw } from 'lucide-react';

export default function ThemePreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <>
      {/* Chrome the portal layout ships and this page did not cover. It is fixed
          rather than absolute: the frame stopped clipping anything when the
          header, nav and content became separate cards, so it parks above the
          viewport instead of behind the shell. Tab to it. */}
      <a className="somo-skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="somo-header">
        <div className="somo-brand">
          <BrandMark />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Merchant delivery portal</div>
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

      {/* The admin's full nav, in shipping order. A sidebar over 900px, the
          horizontal strip below it — narrow the window to review both. */}
      <div className="somo-shell">
      <nav className="somo-tabs">
        <span className="somo-tab">Dashboard</span>
        <span className="somo-tab">New delivery</span>
        <span className="somo-tab active">Deliveries</span>
        <span className="somo-tab">Ledger</span>
        <span className="somo-tab">Riders</span>
        <span className="somo-tab">Pricing</span>
        <span className="somo-tab">Users</span>
        <span className="somo-tab">Settings</span>
      </nav>

      <main className="somo-body" id="main-content" tabIndex={-1}>
        <div className="somo-grid">
          <div className="somo-card">
            <h3><span className="n">01</span> Trip details</h3>
            <div className="somo-route">
              <div className="dot a" /><div className="line"><div className="line-fill" style={{ transform: 'scaleX(0.4)' }} /></div>
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
            </div>
            <button className="somo-btn">Log delivery request</button>
          </div>
        </div>

        <div className="somo-card">
          <h3><span className="n">—</span> All deliveries<span className="tag-note">admin view</span></h3>
          {/* The log's attention panel and toolbar, which both stack under 640px:
              the queue row puts its button under the sentence instead of beside
              it, and the search takes a row of its own with the three actions
              sharing the next. */}
          <div className="somo-queue">
            <div className="somo-queue-head">
              Needs attention <span className="count">2</span>
            </div>
            <div className="somo-queue-row">
              <div className="what">
                <span className="act">Assign a rider</span>
                <span className="sub">Jumia · Osu, Oxford Street → East Legon, Boundary Road</span>
              </div>
              <button className="somo-notify-btn">Open alerts</button>
            </div>
            <div className="somo-queue-row">
              <div className="what">
                <span className="act">Send the rider their completion link</span>
                <span className="sub">Mr Wu · Accra Mall → Tema Community 1</span>
              </div>
              <button className="somo-notify-btn">Open alerts</button>
            </div>
          </div>

          <div className="somo-table-actions">
            <div className="somo-table-search">
              <input
                className="somo-input"
                type="search"
                placeholder="Search order #, customer, address, rider…"
                aria-label="Search deliveries"
              />
            </div>
            <button className="somo-btn ghost small">
              <Minimize2 aria-hidden="true" size={13} />
              <span>Compact</span>
            </button>
            <button className="somo-btn ghost small">
              <RefreshCw aria-hidden="true" size={13} />
              <span>Refresh</span>
            </button>
            <button className="somo-btn ghost small">
              <Download aria-hidden="true" size={13} />
              <span>Export to Excel</span>
            </button>
          </div>

          {/* Mirrors the real log's cell structure — `stacks` plus a data-label on
              every <td> — so this page also reviews the phone treatment, where the
              table becomes one card per delivery. Narrow the window past 640px to
              see it. */}
          <ScrollableTable label="Delivery preview" stacks>
            <table className="somo-table">
              <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Route</th><th>Price</th><th>Payment</th><th>Status</th><th>Rider</th><th>Alerts</th></tr></thead>
              <tbody>
                <tr>
                  <td className="somo-date-cell" data-label="Date">Aug 18 11:36</td>
                  <td className="somo-order-cell" data-label="Order">#4F2A9C</td>
                  <td data-label="Customer">Jumia</td>
                  <td data-label="Route">Osu → East Legon<br />
                    <span className="somo-rider-sub">Ama Serwaa · 024 111 2222</span></td>
                  <td className="somo-agreed-cell" data-label="Price">GHS 67.00</td>
                  <td className="somo-payment-cell" data-label="Payment">
                    <span className="somo-badge b-approval">COD</span><br />
                    <span className="somo-rider-sub">customer pays fee</span><br />
                    <span className="somo-collect-note">collect GHS 217.00</span></td>
                  <td data-label="Status"><span className="somo-badge b-requested">Requested</span></td>
                  <td data-label="Rider"><span className="somo-unassigned">Not yet assigned</span></td>
                  <td className="somo-action-cell" data-label="Alerts">
                    <button className="somo-notify-btn"><Bell aria-hidden="true" size={14} /><span>Notify</span></button></td></tr>
                <tr>
                  <td className="somo-date-cell" data-label="Date">Aug 18 11:31</td>
                  <td className="somo-order-cell" data-label="Order">#B7E014</td>
                  <td data-label="Customer">Mr Wu</td>
                  <td data-label="Route">Accra Mall → Tema</td>
                  <td className="somo-agreed-cell" data-label="Price">GHS 112.00</td>
                  <td className="somo-payment-cell" data-label="Payment">
                    <span className="somo-badge b-delivered">Prepaid</span><br />
                    <span className="somo-rider-sub">merchant pays fee</span></td>
                  <td data-label="Status"><span className="somo-badge b-approval">Declined</span></td>
                  <td data-label="Rider">Kwame Mensah<br />
                    <span className="somo-rider-sub">024 777 8888 · Boxer GR 4821</span></td>
                  <td className="somo-action-cell" data-label="Alerts">
                    <button className="somo-notify-btn"><Bell aria-hidden="true" size={14} /><span>Notify</span></button></td></tr>
                <tr>
                  <td className="somo-date-cell" data-label="Date">Aug 17 16:20</td>
                  <td className="somo-order-cell" data-label="Order">#19D5F0</td>
                  <td data-label="Customer">Mr Wu</td>
                  <td data-label="Route">Tema → Spintex</td>
                  <td className="somo-agreed-cell" data-label="Price">GHS 54.00</td>
                  <td className="somo-payment-cell" data-label="Payment">
                    <span className="somo-badge b-delivered">Prepaid</span><br />
                    <span className="somo-rider-sub">merchant pays fee</span></td>
                  <td data-label="Status"><span className="somo-badge b-delivered">Delivered</span>
                    <div className="somo-confirmed-note">✓ delivered — customer confirmed Aug 17 17:04</div></td>
                  <td data-label="Rider">Kwame Mensah<br />
                    <span className="somo-rider-sub">024 777 8888 · Boxer GR 4821</span></td>
                  {/* Nothing left to do on this one: the stacked layout drops the
                      cell rather than showing an em dash where a button would be. */}
                  <td className="somo-action-cell" data-label="Alerts">
                    <span className="somo-unassigned">—</span></td></tr>
              </tbody>
            </table>
          </ScrollableTable>
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

          {/* The rider's link page, which nothing else here covers: it is the one
              screen a rider actually reads, and the amber-to-teal switch between
              "collect this much" and "collect nothing" is the whole point of the
              block. Both states side by side so neither can drift. */}
          <div className="somo-confirm-due">
            <div className="due-head">Collect on delivery</div>
            <div className="due-row"><span className="k">For the item</span>
              <span className="v">GHS 150.00</span></div>
            <div className="due-row"><span className="k">Delivery fee</span>
              <span className="v">GHS 31.00</span></div>
            <div className="due-row total grand"><span className="k">Total cash to collect</span>
              <span className="v">GHS 181.00</span></div>
          </div>
          <div className="somo-confirm-due clear">
            <div className="due-head">Nothing to collect</div>
            <div className="due-row"><span className="k">For the item</span>
              <span className="v note">Prepaid — collect nothing</span></div>
            <div className="due-row"><span className="k">Delivery fee</span>
              <span className="v note">On the merchant — do not collect</span></div>
          </div>
        </div>
      </main>
      </div>
    </>
  );
}
