# SomoExpress — Merchant Delivery Portal

A merchant delivery request & pricing tool: merchants log delivery requests with
distance-based pricing, ops/admin assign riders, and everyone gets one-tap
WhatsApp/SMS alerts.

**Next.js** app on **Supabase** (Postgres + Auth).

```
somoexpress-portal/
├── app/
│   ├── api/            Route Handlers (the JSON API)
│   ├── login/ setup/   Auth screens
│   └── portal/         The signed-in app, one route per tab
├── components/         React components, grouped by feature
├── lib/
│   ├── supabase/       server / browser / admin clients
│   ├── accounts.ts     account provisioning (service-role)
│   ├── deliveries.ts   delivery queries
│   ├── riders.ts       rider roster
│   ├── settings.ts     pricing, branding, API keys
│   ├── session.ts      who is signed in
│   └── identity.ts     username ↔ email mapping
├── supabase/migrations/  versioned schema + RLS
├── proxy.ts            session refresh + route gate
└── Dockerfile
```

---

## 1. Setup

**Requirements:** [Node.js](https://nodejs.org) 18.18+ and a Supabase project.

```bash
npm install
cp .env.example .env
```

Fill in `.env` from your Supabase dashboard (**Project Settings → API keys**):

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) | Safe in browsers — RLS protects the data, not this key |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`) | **Server only.** Bypasses RLS. Never rename to `NEXT_PUBLIC_*` |

### Apply the schema

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

The project ref is the subdomain of your project URL. `db push` will ask for the
database password (**Project Settings → Database**).

To confirm it worked, and to catch any security or performance advice:

```bash
npx supabase db advisors
```

### Run it

```bash
npm run dev
```

Open **http://localhost:4000**. With no accounts yet you'll get the
create-admin screen; that account then creates everyone else.

For production, `npm run build` then `npm start`.

### Regenerating database types

`lib/database.types.ts` is hand-written to match the migrations. Once linked, you
can replace it with generated output so it tracks the schema automatically:

```bash
npx supabase gen types typescript --linked > lib/database.types.ts
```

---

## 2. How auth works

Supabase Auth is email-based; this portal is username-based. So each account gets
a **synthetic email** derived from its username — `jumia.gh` becomes
`jumia.gh@portal.somoexpress.local` — and the UI never shows it. People type a
username, exactly as before.

Consequences worth knowing:

- The domain is deliberately not real. Nothing is ever delivered to these
  addresses, so email flows (reset links, magic links, confirmations) don't apply.
  Password resets stay an admin action that reveals the new password once.
- `ACCOUNT_EMAIL_DOMAIN` in [lib/identity.ts](lib/identity.ts) is effectively
  permanent. Changing it after accounts exist orphans every login.
- Accounts are created with the service-role key, so provisioning always happens
  server-side, and the plaintext password is returned exactly once to whoever
  created it.
- **Ops creates merchant accounts only.** Because the create path runs as
  service_role it bypasses RLS, so that limit lives in
  [app/api/accounts/route.ts](app/api/accounts/route.ts) — an ops caller asking
  for any role but `merchant` gets a 403. Resetting a password and
  activating/deactivating stay admin-only. Ops can read merchant profile rows
  (and only those) so the Merchants pane can list them.

Roles live in the JWT's **`app_metadata`**, never `user_metadata` — the latter is
editable by the account holder and must not be trusted for authorization.

**Deactivating an account** does two things: bans the auth user (which revokes
their token at the source) and clears `profiles.active` (which the server checks
on every request). Either alone would leave a window open.

---

## 3. Security model

Three layers, each independently sufficient for the common case:

1. **Proxy** — no valid session cookie, no portal. Refreshes the session on
   every request via `getClaims()`, which verifies the JWT against the project's
   public JWKS with no network round-trip.
2. **Route Handlers and pages** — `requireUser('admin')` / `roleAllows(...)` on
   every entry point, returning clean 401/403s.
3. **Row Level Security** — the backstop. `supabase/migrations` enforces the rules
   in Postgres, so a forgotten filter in application code cannot leak data.

The main upgrade over the previous JSON-file version: **merchant isolation is now
a database guarantee**, not an application one. A merchant's `SELECT` on
`deliveries` can only ever return rows where they are the merchant.

Who can reach what:

| Table | anon | merchant | ops | admin |
| --- | --- | --- | --- | --- |
| `branding` (logo) | read | read | read | read + write |
| `pricing_params` | — | read | read | read + write |
| `delivery_options` | — | read | read | read + write |
| `profiles` | — | own row | own row + merchant rows | all + write |
| `deliveries` | — | own rows, insert | all, update | all, update |
| `riders` | — | — | read + write | read + write |
| `app_settings` (API keys) | — | — | — | via server only |
| `delivery_links` | — | — | — | via server only |
| `rate_limits` | — | — | — | via server only |
| `idempotency_keys` | — | — | — | via server only |

`app_settings` is granted to **no** public role: the WhatsApp/SMS provider keys
are only ever read by the server's service-role client, after the caller has been
confirmed as admin. RLS is enabled on it with zero policies as a second line of
defence.

Two deliberate exceptions:

- **The logo is world-readable.** The login screen has to render it before anyone
  signs in. It lives in its own table so that "public" never overlaps with the
  secrets.
- **The Google Maps key reaches signed-in browsers.** The Maps JavaScript SDK
  runs client-side, so there's no alternative. Restrict the key by HTTP referrer
  in Google Cloud Console.
- **`/d/<token>` needs no session.** Riders and customers have no portal
  account, so each step they own is a capability URL: 256 random bits, one
  delivery, one question, expires in 72 hours. Only the sha256 of the token is
  stored, so a database dump yields nothing clickable, and the page shows no
  price, no declared value and no other order — a recipient's link does not even
  show the merchant's pickup address. A link stops working once used, once the
  delivery moves past the step it asks about, or (for rider links) the moment the
  delivery is reassigned.
- **A merchant may make exactly one edit to their own delivery.** Confirming
  pickup belongs to the merchant — they are the one handing the parcel over — but
  they must not be able to edit anything else on a request they filed. That is two
  policies working together, both in Postgres:
  `deliveries_update_merchant_pickup` decides *which rows and which transition*
  (their own, only while `Accepted`, only ending at `Picked up`), and the
  `deliveries_guard_merchant_update` trigger decides *which columns may differ*.
  The trigger is necessary because WITH CHECK only validates the resulting row —
  without it, an UPDATE that set `status` to `Picked up` **and** `agreed` to 1
  would satisfy the policy. It compares whole jsonb documents rather than a list of
  column names, so a column added by a future migration is protected the day it is
  added.

### Rate limiting

Counters live in Postgres (`rate_limits` + `public.rate_limit_hit()`), not in the
Node process: on Vercel "the server" is a pool of lambdas, so an in-memory Map
would reset on every cold start and count separately in each instance. See
[lib/rateLimit.ts](lib/rateLimit.ts).

| Endpoint | Bucket | Limit |
| --- | --- | --- |
| `POST /api/delivery-link/[token]` | IP / token | 20 / 10 per 5 min |
| `GET /d/[token]` (public link page) | IP | 60 per 5 min |
| `POST /api/auth/setup` | IP | 5 per 15 min |
| `GET /api/auth/bootstrap-status` | IP | 60 per 5 min |
| `POST /api/deliveries` | user | 30 per 5 min |
| `GET /api/deliveries/export` | user | 5 per 5 min |
| `POST /api/deliveries/[id]/links` | user / delivery | 40 / 10 per 5 min |
| `POST /api/deliveries/[id]/pickup` | user | 30 per 5 min |
| `POST /api/accounts` | user | 20 per 5 min |

Two deliberate choices:

- **It fails open.** If the database is unreachable the check logs and allows the
  request. A limiter that turns a slow database into a portal-wide outage is a
  worse problem than the one it prevents — and every endpoint behind it still has
  its own authorisation.
- **Login is not in the table.** The browser signs in against Supabase Auth
  directly, which applies its own per-IP limits. Proxying login through a Route
  Handler purely to count it would mean giving up the SDK's cookie handling.

Over-limit responses are `429` with a `Retry-After` header. Everything else —
ordinary authenticated reads — is left unlimited: it is cheap, RLS already bounds
what it returns, and a limit would cost a round trip per page load to prevent
nothing.

### Idempotency

`POST /api/deliveries` accepts an `Idempotency-Key` header. The New delivery form
generates one per submission attempt and keeps it until the request succeeds, so
a merchant on a bad signal who taps twice gets back the delivery already filed
rather than a duplicate. Successful responses are cached for 24 hours in
`idempotency_keys`; failures release the key so a corrected retry works normally,
and a second request arriving while the first is still running gets a `409`.

The other write endpoints are already idempotent by construction and take no key:
`PATCH /api/deliveries/[id]` sets the same row to the same values, link redemption
claims its row with `confirmed_at is null`, pickup confirmation filters on the
delivery still being `Accepted`, and account creation collides on the username
unique index. See [lib/idempotency.ts](lib/idempotency.ts).

---

## 4. What's real vs. what's a manual trigger

- **Pricing** is recalculated server-side from the saved parameters. The form
  shows a live preview, but the stored number is the server's, so a client can't
  submit a fabricated price — nor file a request under another merchant's name.
- **Excel export** on the deliveries tab is a real `.xlsx`, built server-side by
  [lib/deliveryExport.ts](lib/deliveryExport.ts) from whatever
  `listDeliveriesFor` returns — so RLS decides the contents and a merchant's file
  can only hold their own rows. Money and distances are written as numbers with a
  display format, not as text, so the sheet can be summed and sorted.
- **Item categories** (what is being sent — food, medication, documents…) are a
  list an admin edits under Settings, stored in `delivery_options`. The New
  delivery form requires a choice whenever the list is non-empty, and the Route
  Handler re-checks the submitted label against the configured list. The chosen
  label is copied onto the delivery row, the same way rider details are, so
  renaming or removing a category never rewrites past records.
- **The recipient** (name and phone of whoever is receiving the parcel) is its
  own required section on the New delivery form. Required in the browser and
  again in the Route Handler, which also sanity-checks the number. Note the
  naming: `deliveries.customer` is the corporate merchant who filed the request,
  `recipient_name` / `recipient_phone` is the individual at the drop-off. The
  rider's WhatsApp alert carries it so they can call ahead, the log shows it
  under the route, and the export has it as two columns. Rows filed before this
  existed show a dash rather than blocking.
- **Google Maps** (autocomplete + driving-distance lookup) works once an admin
  saves a Maps API key with Places API and Distance Matrix API enabled and billing
  on.
- **The delivery lifecycle is confirmed by the people involved, not assumed.**
  Nine statuses, and every one past `Assigned` is set by someone acting, never by
  ops guessing:

  | Step | Who moves it | How |
  | --- | --- | --- |
  | `Assigned` | ops | assigns a rider in the log |
  | `Accepted` / `Declined` | rider | taps accept or decline on their link |
  | `Picked up` | merchant | **Confirm pickup** button on their own row |
  | `Recipient confirmed` | customer | taps "I have received this" on their link |
  | `Delivered` | rider | taps "I've delivered this" on their link |

  A decline parks the delivery with the rider still named, so the log says who
  refused it; assigning someone else puts it back to `Assigned` and clears the
  previous rider's answer. Each milestone stamps its own timestamp — the log shows
  the newest under the status, the Excel export carries all five as columns, so a
  status ops set by hand is distinguishable from one the people involved
  confirmed.

  Both the log and the merchant's view grow a **Needs attention** panel listing
  the deliveries waiting on whoever is reading. It is derived from status, not
  stored, so items cannot go stale and there is nothing to mark as read — the
  state *is* the alert.

  Because riders and customers move deliveries along from their own phones, the
  log soft-refreshes itself every 25 seconds (paused in background tabs and while
  the alerts modal is open, and triggered immediately on tab focus). Without that,
  ops would sit looking at whatever was true when the page loaded. There is a
  manual **↻ Refresh** next to the export button for the impatient.

  Every message is still a human tapping a pre-filled WhatsApp/SMS link, but the
  wording and the recipient list for each step now live in one provider-agnostic
  module, [lib/deliveryMessages.ts](lib/deliveryMessages.ts). Wiring up a
  WhatsApp Business API later means writing a sender that consumes the same
  `OutboundMessage[]` — not rewriting the flow.

  Set `NEXT_PUBLIC_APP_URL` if a reverse proxy rewrites the forwarded host,
  otherwise links point at whatever host the request arrived on.
- **WhatsApp/SMS alerts** are one-tap `wa.me` / `sms:` links that pre-fill the
  message — whoever's at the keyboard taps send. The WhatsApp and SMS **API key
  fields** are stored ready for a provider integration (Twilio, Africa's Talking,
  Meta's WhatsApp Business API), but unattended sending isn't implemented. Start
  from `whatsapp_otp_key` / `sms_api_key` in [lib/settings.ts](lib/settings.ts).

---

## 5. Deployment

The app is now **stateless** — all state is in Supabase — so it scales
horizontally and can run anywhere, including serverless platforms like Vercel.
(The previous JSON-file version could not.)

### Docker

```bash
docker compose up -d --build
```

Note that `NEXT_PUBLIC_*` variables are inlined into the client bundle at **build**
time, so `docker-compose.yml` passes them as build args as well as runtime env.
`SUPABASE_SECRET_KEY` is runtime-only and never becomes an image layer.

Put a reverse proxy in front for TLS. Example with **Nginx**:

```nginx
server {
    listen 80;
    server_name portal.somoexpress.example;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Backups

Supabase takes automated backups — see **Database → Backups** in the dashboard.
For your own copy:

```bash
npx supabase db dump --linked -f backup.sql
```

---

## 6. Troubleshooting

- **"Supabase admin client needs …"** — `SUPABASE_SECRET_KEY` is missing from
  `.env`. Restart the dev server after adding it.
- **Everything 500s with "relation does not exist"** — migrations haven't been
  applied. Run `npx supabase db push`.
- **A signed-in user sees no data** — RLS is doing its job but the role claim is
  missing or stale. Roles come from `app_metadata.portal_role`, which is set at
  account creation and only refreshes when the token does; sign out and back in.
- **"Incorrect username or password"** for an account you just created — check the
  password was copied from the one-time reveal dialog. Supabase returns the same
  message for an unknown username, on purpose.
- **Everyone bounced to login after a deploy** — check the Supabase URL and
  publishable key were present at build time, not just at runtime.
- **Forgot the admin password** — reset it from the Supabase dashboard
  (**Authentication → Users**), or `psql`/SQL editor against `auth.users`.

---

## 7. Migrating from the JSON-file version

The previous release stored everything in `data/db.json`. That file and its
loader are gone. If you have a populated one from an older deploy, note that
passwords **cannot** be carried over — bcrypt hashes can't be imported into
Supabase Auth through the admin API. Recreate the accounts and hand out fresh
passwords; riders, deliveries, pricing and settings can be inserted directly.
