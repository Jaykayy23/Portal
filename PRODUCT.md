# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three portal seats carry roughly equal weight — none is a visitor:

- **Merchants** file delivery requests and follow their own rows. They work from
  **phone, tablet, or laptop**, often between other work, so merchant-facing
  surfaces have to be genuinely good at phone width, not merely survivable.
- **Ops** triage the incoming queue, assign riders, and fire the WhatsApp/SMS
  alerts. **At a desk.**
- **Finance** work the ledger: rider floats, merchant invoices, COD payouts, and
  recording settlements. **At a desk.** Read-only by construction everywhere
  except the settlement they record.

A fourth seat, **admin**, provisions accounts and owns pricing, branding, item
categories, and provider keys.

Two populations use the product without ever holding an account:

- **Riders** — reached by WhatsApp/SMS, acting through a one-question capability
  link on a phone, frequently one-handed at a gate.
- **Recipients** — the individual at the drop-off, same mechanism.

## Product Purpose

Merchants log delivery requests and get one fixed distance-based price. Ops
assign a rider. Everyone involved gets an alert — sent from the portal over SMS
once Twilio is configured, or as a one-tap WhatsApp/SMS link either way. A ledger
tracks where the money for each delivery physically is, settlements record it
moving, and a rider sitting on undeposited cash is blocked from taking new work.
A dashboard counts the traffic behind all of it.

Success is that a delivery's money is never in an unknown place, and that nobody
outside the portal has to be trained or onboarded to complete their part.

## Positioning

Two claims a neighbouring Accra courier could not truthfully copy — confirmed as
the durable ones, and the two that future work must protect:

1. **Every cedi has a named holder.** The ledger derives, per delivery, whether
   the money sits with the customer, in a rider's float, on a merchant's account,
   or with us — and settlements close each leg exactly once. Cash accountability
   is the product, not a report bolted onto it.
2. **Nobody outside the portal installs anything.** Riders and recipients need no
   account, no app, and no training: WhatsApp/SMS plus an expiring
   single-question link.

Fixed server-computed pricing and stating the exact cash total before anyone
reaches a door are real properties of the product (see Capabilities), but were
**not** confirmed as differentiators. Do not present them as positioning.

## Operating Context

- Ghana; all money is **GHS**, formatted through `lib/format.ts`.
- The handover chain is: merchant files → ops assigns a rider → rider confirms
  pickup (or the merchant does, their one permitted edit) → rider delivers →
  finance settles the legs.
- WhatsApp/SMS is the notification channel, not email. There is no email in this
  product at all (see the synthetic-email constraint below).
- Rider and recipient steps happen at `/d/<token>` — one delivery, one question,
  no session.
- Excel is a real output surface: two separate exports (operational deliveries,
  and a two-sheet ledger), whose filters travel as query parameters so the file
  matches the screen it was pressed on.
- Runnable locally with `npm run dev` on port **4000**. Also containerised
  (`Dockerfile`, `docker-compose.yml`).

### Terminology (load-bearing — do not drift)

- **Customer** = the corporate merchant who filed the request
  (`deliveries.customer`). **Recipient** = the individual at the drop-off
  (`recipient_name` / `recipient_phone`). These are not synonyms.
- **Float** = cash a rider is carrying that is owed onward.
- **Leg** = one movement of money, `in` (reaching SomoExpress) or `out` (leaving
  it). Goods-COD has two legs; a fee has one; a fee never goes out.
- **Settlement** = the event that money changed hands; **settlement line** = one
  leg travelled.
- **Surge charges** are additions on top of the computed fare.

## Capabilities and Constraints

**Auth and roles**

- Username-based login over Supabase Auth's email requirement, via a synthetic
  address (`jumia.gh` → `jumia.gh@portal.somoexpress.local`). The UI never shows
  it.
- `ACCOUNT_EMAIL_DOMAIN` in `lib/identity.ts` is **effectively permanent** —
  changing it after accounts exist orphans every login.
- Because the domain is deliberately unreachable, **no email flow exists or can
  exist**: no reset links, no magic links, no confirmations. Password reset is an
  admin action that reveals the new password exactly once.
- Signup is closed; accounts are provisioned server-side with the service-role
  key. Ops may create **merchant** accounts only; admin issues ops, finance, and
  admin accounts.
- Roles live in the JWT's `app_metadata`, never `user_metadata`.
- Deactivating an account both bans the auth user and clears `profiles.active`.
  Either alone would leave a window open.

**Enforcement**

- Three independent layers: proxy session gate, per-handler `requireUser` /
  `roleAllows`, and Row Level Security as the backstop. Merchant isolation is a
  **database** guarantee, not an application one.
- Every write policy names the roles it permits, so a newly added role is inert
  until something mentions it. Preserve that property when the next role lands.
- Rate limits live in Postgres (not process memory, because the server is a pool
  of lambdas) and **fail open** — an unreachable database allows the request
  rather than taking the portal down.

**Pricing**

- `max(minimum fare, base + rate × km + per-minute × minutes) + surge`, computed
  server-side. A price in the request body is **ignored outright**, not
  validated.
- Negotiation was removed deliberately and permanently: no negotiable
  percentage, no editable agreed price, no `Requires approval` status.
  `deliveries.recommended` and `.minimum` survive only for pre-change rows and
  are read by nothing; `agreed` is the single price column, surfaced as `price`.

**Money and messaging**

- Payment terms are two independent required answers — item **Prepaid** or **Cash
  on delivery**, and fee paid by **Merchant** or **Customer**. All four
  combinations are valid and re-checked server-side.
- Rider messages state what to collect *and what not to*, and always state the
  total — including the zero case ("TOTAL CASH TO COLLECT: nothing") — so the
  wording never varies by situation. The recipient message leads with the same
  figure. The amounts also appear on the link page, because the message is what
  got scrolled past and the page is what is open at the door.
- **One arithmetic source: `lib/amounts.ts`.** The message composer, the link
  page, and the log all call it. Three copies of `declared value + fee` is how
  they come to disagree.
- A link holder sees only what changes hands at the door — never the delivery's
  own figure.
- COD amount is currently *inferred* from declared value, because that is the
  only figure held. **Open decision:** if COD must ever differ from declared
  value, it needs its own column rather than continuing to be inferred.

**Ledger and settlements**

- The ledger stores **nothing** — every position is derived from the delivery row
  on each read, and it is **read-only for every role including admin**. Changing
  the money means changing the delivery.
- A partial unique index on `(delivery_id, stream, leg) where not voided` is what
  makes a leg travel exactly once. There is no `kind` column, because one
  merchant settlement can run both directions at once.
- `authenticated` holds no write grant on the settlement tables; the only path in
  is a SECURITY DEFINER function that checks the role itself.
- Settlements are locked once recorded; voiding is the only reversal.

**Capability links (`/d/<token>`)**

- 256 random bits, one delivery, one question, 72-hour expiry. Only the sha256 is
  stored, so a database dump yields nothing clickable.
- Shows no price, no declared value, and no other order; a recipient's link does
  not even show the merchant's pickup address.
- Dies on use, on the delivery moving past that step, or (rider links) the moment
  the delivery is reassigned.

**History integrity**

- Rider name, phone, and bike, and the item-category label, are **snapshotted**
  onto the delivery row. Renaming or removing a rider or a category never
  rewrites past records. Finance therefore needs no access to the rider roster.
- Rows filed before a field existed render a dash rather than blocking.

**Build**

- Fonts must be **vendored locally** (`app/fonts/*.woff2`). The network cannot
  reach `fonts.gstatic.com`, so `next/font/google` fails the build outright and
  would fail the same way inside the Docker image. Any future typeface has to
  arrive as a local file — never a CDN link or a build-time fetch.
- Google Maps runs client-side, so its key necessarily reaches signed-in
  browsers; it is restricted by HTTP referrer instead.

## Brand Commitments

- Name: **SomoExpress**; this surface is the **Merchant Delivery Portal**.
- Logo assets: `public/logo.png`, `public/logo-mark.png`. The active logo lives in
  a world-readable `branding` table so the login screen can render it before
  anyone signs in — deliberately its own table so "public" never overlaps with
  the secrets. Admin-editable.
- **Confirmed voice (functional, not decorative):** say the thing explicitly,
  including the negative case. "Prepaid — collect nothing" exists because a rider
  asking for money already paid costs a merchant a customer. Stated amounts are
  identical everywhere they appear.
- No visual world is committed here. The incumbent implementation is design
  authority for refinement; `/impeccable document` records it, `new-work` decides
  whether to preserve or replace it.

## Evidence on Hand

Real and citable:

- The running portal itself, and `README.md` as the maintained system of record
  for why each decision was made.
- `supabase/migrations/` as dated schema history (the finance role, settlements,
  and the removal of price negotiation each have a migration).
- Logo assets in `public/`.

Explicitly absent — **future work must not fabricate these**:

- No testimonials, customer quotes, case studies, press, or awards.
- No customer logos or named merchant references. `jumia.gh` appears in the
  README only as an illustration of the username→email mapping; it is **not** a
  confirmed customer.
- No volume, revenue, delivery-count, uptime, or benchmark figures.
- No published pricing tiers, licensing, or SLA.

## Product Principles

1. **Every cedi has a named holder.** If a change makes it possible for money to
   sit in an unknown place, the change is wrong.
2. **Nobody outside the portal installs anything.** Rider and recipient steps
   stay account-free, app-free, and single-question.
3. **Three equal seats.** Merchant, ops, and finance each own their tabs; no seat
   gets a degraded version of the portal. Merchant surfaces additionally have to
   hold up on a phone.
4. **The database is the last word.** Constraints and RLS enforce; application
   code exists to make the failure legible, not to be the guarantee.
5. **One number, one source.** A figure that appears twice and disagrees costs
   more trust than it saves effort.

## Accessibility & Inclusion

- **Merchant-facing surfaces must work at phone and tablet width**, not just
  desktop; ops and finance surfaces are desk-first. `/d/<token>` is phone-only in
  practice, frequently one-handed, sometimes on patchy data.
- The codebase already treats WCAG AA contrast as a working floor — `globals.css`
  cites verified ratios (4.5:1 for text, 6.7:1 for the filled danger surface) and
  honours `prefers-reduced-motion`.
- **Not user-confirmed:** no external accessibility standard or audit has been
  committed to. Treat AA as the inherited floor, not a signed requirement, and
  ask before claiming compliance anywhere user-visible.
