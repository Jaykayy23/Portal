# SomoExpress — Merchant Delivery Portal

A merchant delivery request & pricing tool: merchants log delivery requests with
distance-based pricing, ops/admin assign riders, and everyone gets one-tap
WhatsApp/SMS alerts. A ledger tracks where the money for each delivery physically
is, and a dashboard counts the traffic behind it.

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
│   ├── ledger.ts       whose pocket each delivery's money is in
│   ├── analytics.ts    dashboard counting
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
- **Four roles.** `merchant`, `ops`, `finance`, `admin`. Only an admin issues an
  ops, finance or admin account. A `finance` account is read-only by construction
  and lands on the ledger rather than the New delivery form — see the finance
  bullet under Security model for how that is enforced, and why it needed no
  "deny" policy.

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

| Table | anon | merchant | ops | finance | admin |
| --- | --- | --- | --- | --- | --- |
| `branding` (logo) | read | read | read | read | read + write |
| `pricing_params` | — | read | read | read | read + write |
| `delivery_options` | — | read | read | read | read + write |
| `profiles` | — | own row | own row + merchant rows | own row + merchant rows | all + write |
| `deliveries` | — | own rows, insert | all, update | **all, read-only** | all, update |
| `riders` | — | — | read + write | — | read + write |
| `app_settings` (API keys) | — | — | — | — | via server only |
| `delivery_links` | — | — | — | — | via server only |
| `rate_limits` | — | — | — | — | via server only |
| `idempotency_keys` | — | — | — | — | via server only |

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
- **Finance can read everything and write nothing.** The role was added by
  `20260821100000_finance_role.sql`, which does two things: widen the role check
  constraint, and add two SELECT policies (every delivery, and merchant profiles
  for the merchant picker). It adds no INSERT or UPDATE policy anywhere, and it
  does not need to add a "deny" policy either — every write policy in this schema
  names the roles it permits, so a new role is inert until something mentions it.
  That is the property worth keeping when the next role is added.

  Two places back it up in application code, and only one of them matters.
  `POST /api/deliveries` and `POST /api/deliveries/[id]/pickup` name their roles
  purely for a clean `403` instead of a confusing row-level failure — RLS would
  refuse them anyway. `POST /api/deliveries/[id]/links` is the real one: minting a
  link writes through the service-role client, and the only check under it is
  "can the caller read this delivery" — which finance can. So the role list on
  that handler is load-bearing, and it is commented as such.

  Riders are the one table finance might be expected to need and does not: the
  rider's name, phone and bike are snapshotted onto every delivery row, so
  "GHS 400 is with Kwame Mensah" reads correctly with no access to the roster.
- **A merchant may make exactly one edit to their own delivery.** Confirming
  pickup belongs to the merchant — they are the one handing the parcel over — but
  they must not be able to edit anything else on a request they filed. That is two
  policies working together, both in Postgres:
  `deliveries_update_merchant_pickup` decides *which rows and which transition*
  (their own, only while `Assigned`, only ending at `Picked up`), and the
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
| `GET /api/ledger/export` | user | 5 per 5 min |
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

- **Pricing is one fixed figure.** `max(minimum fare, base + rate × km + per-min
  × minutes) + surge charges`, computed server-side from the saved parameters. The
  form shows a live preview, but the stored number is the server's — and a price
  sent in the request body is ignored outright rather than validated, because
  there is nothing for a caller to propose.

  Negotiation was removed: there is no minimum-negotiable percentage, no editable
  agreed price, and no `Requires approval` status. What the rules produce is what
  the delivery is logged and charged at. Two columns survive on `deliveries` for
  the handful of rows that predate the change — `recommended` holds what was
  quoted and `minimum` the floor that applied — and the app reads neither: `agreed`
  is the single price column, surfaced as `price`. See
  `20260820100000_remove_price_negotiation.sql` for why they were kept rather than
  dropped.
- **Excel export** on the deliveries tab is a real `.xlsx`, built server-side by
  [lib/deliveryExport.ts](lib/deliveryExport.ts) from whatever
  `listDeliveriesFor` returns — so RLS decides the contents and a merchant's file
  can only hold their own rows. Money and distances are written as numbers with a
  display format, not as text, so the sheet can be summed and sorted.

  The ledger has its own two-sheet export ([lib/ledgerExport.ts](lib/ledgerExport.ts)),
  separate rather than another flag on the first: one is the operational record
  (milestones, surge charges, who confirmed what) and the other is the money, and
  merged they would fight over the same column list. Its filters travel as query
  parameters so the file matches the screen it was pressed on — exporting
  "everything" from a screen showing one merchant's overdue invoices is a quiet way
  to hand somebody the wrong spreadsheet.
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
- **Payment terms** are two required answers on the New delivery form, sitting
  under the declared value: is the item **Prepaid** or **Cash on delivery**, and is
  the delivery fee paid by the **Merchant** or the **Customer**. They are
  independent — a prepaid order where the customer still pays for delivery is
  ordinary — so all four combinations are valid. Both are re-checked server-side
  against the configured values, because a crafted request that stored "free"
  would send a rider to a door expecting to collect nothing.

  They exist for the rider's alert, which now spells out what to collect *and what
  not to*: "PAYMENT: item is PREPAID, collect nothing for the goods; collect the
  delivery fee of GHS 32.00 from the customer." Saying "prepaid" explicitly is what
  stops a rider asking for money already paid — the mistake that costs a merchant a
  customer rather than costing anyone cash. The recipient's message gets the
  matching half ("please have … ready for the rider"), and the log shows a
  COD/Prepaid badge that **Compact does not hide**.

  The amounts also appear **on the link page itself** — an amber block reading
  "To pay the rider" for the customer, "Collect on delivery" for the rider, with a
  total when both the item cash and the fee apply. It repeats what the message
  said, which is the point: the message is the thing that got scrolled past, the
  page is the thing open in their hand at the door. It is absent entirely when the
  item is prepaid and the merchant pays, since "GHS 0.00 to pay" invites a second
  look at a page whose whole job is one tap. Note what is *not* there: the
  price a link holder sees is only what changes hands at the door, never the
  delivery's own figure.

  One thing to know: a cash-on-delivery message quotes the **declared value** as
  the amount, because that is the only figure the portal holds for the goods. If
  the COD amount ever needs to differ from the declared value, that wants its own
  column rather than being inferred.
- **The ledger says whose pocket the money is in.** Those same two payment terms
  are what it reads, plus one more fact — whether the handover has happened. Cash
  on delivery that has not been delivered is still in the customer's pocket; the
  same row an hour later is cash a rider is carrying, and that is the difference
  between a forecast and a float somebody has to remit. Four positions come out of
  it:

  | The money | Term | Where it is |
  | --- | --- | --- |
  | Goods | `Prepaid` | with the merchant — the customer paid them directly, and none of it passes through us |
  | Goods | `Cash on delivery` | with the **customer** until handover, then with the **rider**, owed to the merchant |
  | Fee | `Merchant` | on the merchant's account — they owe us, and it is invoiceable once the delivery completes |
  | Fee | `Customer` | with the customer until handover, then with the **rider**, owed to us |

  Nothing is stored. [lib/ledger.ts](lib/ledger.ts) derives every position from
  the delivery row on each read, because a settlement table would be a second
  source of truth to keep in step with the status — and the status is already the
  thing that moves. The cost is real and worth naming: the portal has no record of
  a rider handing their float in, so the figures say what is *owed*, not what is
  unpaid. Recording remittances wants its own table.

  The page groups by what somebody has to *do* — remit the rider float, raise the
  merchant invoices, pay merchants their COD takings, leave the in-flight rows
  alone — with a rider-float table, a per-merchant position in both directions,
  and a two-sheet Excel export whose Summary tab carries the totals. It is
  read-only for every role including admin: the money follows from the delivery,
  so changing it means changing the delivery, which is what the log is for.

  Who sees what is decided in Postgres, not here. Finance, ops and admin get every
  merchant plus a merchant picker; a merchant gets the same page, and the RLS
  SELECT policy is what makes it their own company's rows.
- **The dashboard counts the same rows the log lists.** Volume and completion day
  by day, where deliveries sit in the lifecycle, the payment mix, item categories,
  busiest drop-offs, per-merchant and per-rider tables, and repeat recipients —
  matched on phone number rather than name, since the name is typed fresh every
  time and the same doorstep gets spelled two ways.

  Counted in the browser from the array the page already loaded, not aggregated in
  SQL, for the same reason the log filters client-side: a range switch should not
  cost a round trip. An install big enough for that to feel slow wants paged
  queries and materialised rollups, which is a different piece of work rather than
  a bigger version of this one. See [lib/analytics.ts](lib/analytics.ts).
- **Google Maps** (autocomplete + driving-distance lookup) works once an admin
  saves a Maps API key with Places API and Distance Matrix API enabled and billing
  on.
- **The delivery lifecycle is confirmed by the people involved, not assumed.**
  Nine statuses, and every one past `Assigned` is set by someone acting, never by
  ops guessing:

  | Step | Who moves it | How |
  | --- | --- | --- |
  | `Pending` | ops | offers the job to a rider in the log |
  | `Assigned` / `Declined` | rider | taps accept or decline on their link |
  | `Picked up` | merchant | **Confirm pickup** button on their own row |
  | `Recipient confirmed` | customer | taps "I have received this" on their link |
  | `Delivered` | rider | taps "I've delivered this" on their link |

  `Pending` and `Assigned` are the pair worth reading twice. Ops picking a name
  off a dropdown does not put a rider on the road, so that leaves the delivery
  **Pending** — only the rider's own acceptance makes it **Assigned**. A merchant
  seeing "Assigned" can take it that someone is actually coming.

  A decline parks the delivery with the rider still named, so the log says who
  refused it; offering it to someone else puts it back to `Pending` and clears the
  previous rider's answer. Each milestone stamps its own timestamp — the log shows
  the newest under the status, the Excel export carries all five as columns, so a
  status ops set by hand is distinguishable from one the people involved
  confirmed.

  Both the log and the merchant's view grow a **Needs attention** panel listing
  the deliveries waiting on whoever is reading. It is derived from status, not
  stored, so items cannot go stale and there is nothing to mark as read — the
  state *is* the alert.

  **Rider availability follows from this** rather than being remembered. Accepting
  a job sets the rider to `On delivery`; closing one out sets them back to
  `Available`, but only if they have no other delivery still in flight, and never
  if they are `Offline` — finishing the last job of the day must not quietly put
  someone back in the pool. Taking a rider off a delivery frees them the same way.
  It is recomputed from what they are actually carrying, so it comes out right
  after a reassignment or two jobs finishing seconds apart. See
  [lib/riderAvailability.ts](lib/riderAvailability.ts).

  Because riders and customers move deliveries along from their own phones, the
  log soft-refreshes itself every 25 seconds (paused in background tabs and while
  the alerts modal is open, and triggered immediately on tab focus). Without that,
  ops would sit looking at whatever was true when the page loaded. There is a
  manual **↻ Refresh** next to the export button for the impatient.

  The table itself is a bounded scroll box (60vh) with a sticky header row, so the
  horizontal scrollbar stays on screen instead of sitting at the bottom of a
  forty-row page, and column headings stay put while rows scroll under them. The
  **⤡ Compact** toggle drops the six detail columns — distance, time, type, item,
  declared value, recommended — leaving what dispatch actually works from; the
  choice is remembered per browser.

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
