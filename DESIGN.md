---
name: SomoExpress Merchant Delivery Portal
description: A dispatch ledger for delivery work — ruled, tabular, and quiet, with one deep navy reserved for money and action.
colors:
  waybill-navy: "#26336D"
  waybill-navy-ink: "#ffffff"
  waybill-navy-hover: "#304088"
  waybill-navy-press: "#212d60"
  waybill-navy-soft: "#e8ecf8"
  outbound-ochre: "#965a00"
  outbound-ochre-soft: "#fdf3e0"
  manifest-teal: "#0e7c6b"
  manifest-teal-soft: "#e6f4f1"
  manifest-teal-line: "#c3e3dc"
  dispatch-blue: "#3b5bdb"
  dispatch-blue-soft: "#e8ecfb"
  ledger-violet: "#5f3dc4"
  ledger-violet-soft: "#efeafc"
  alert-red: "#b42318"
  alert-red-bright: "oklch(0.577 0.245 27.325)"
  alert-red-soft: "#fef2f2"
  alert-red-line: "#f3b9b4"
  ledger-white: "oklch(1 0 0)"
  ground-grey: "oklch(0.97 0 0)"
  rule-grey: "oklch(0.922 0 0)"
  ink: "oklch(0.145 0 0)"
  muted-ink: "#707070"
  scrim: "rgb(0 0 0 / 0.45)"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "0.2px"
  section:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.2px"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0.4px"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.5px"
rounded:
  bar: "2px"
  track: "3px"
  chip-cell: "6px"
  chip-inline: "7px"
  control: "8px"
  logo: "9px"
  tile: "10px"
  card: "12px"
  shell: "14px"
  page-card: "16px"
  pill: "999px"
spacing:
  gap-tight: "8px"
  gap: "12px"
  field: "14px"
  card-stack: "18px"
  card-pad: "20px"
  grid-gap: "22px"
  body-pad: "26px"
components:
  button-primary:
    backgroundColor: "{colors.waybill-navy}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.waybill-navy-hover}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-primary-active:
    backgroundColor: "{colors.waybill-navy-press}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-decline:
    backgroundColor: "transparent"
    textColor: "{colors.alert-red}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  button-small:
    backgroundColor: "{colors.waybill-navy}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-mini:
    backgroundColor: "{colors.ground-grey}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "100%"
  input:
    backgroundColor: "{colors.ground-grey}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  card:
    backgroundColor: "{colors.ledger-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  stat-tile:
    backgroundColor: "{colors.ground-grey}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 14px"
  badge-assigned:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  badge-delivered:
    backgroundColor: "{colors.manifest-teal-soft}"
    textColor: "{colors.manifest-teal}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  leg-tag-in:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  leg-tag-out:
    backgroundColor: "{colors.outbound-ochre-soft}"
    textColor: "{colors.outbound-ochre}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  role-tag:
    backgroundColor: "{colors.manifest-teal-soft}"
    textColor: "{colors.manifest-teal}"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  nav-item-active:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
---

# Design System: SomoExpress Merchant Delivery Portal

## Overview

**Creative North Star: "The Dispatch Ledger"**

This is a well-kept accounting book rendered as software. Its grammar is the
grammar of a ruled page: hairline rules instead of boxes, uppercase column labels
above tabular figures, generous white, and one deep navy that appears only
where money or the next action lives. Nothing in it is decorative. The portal is
the record of where every cedi physically is, and it looks like a record — legible
at a glance, identical row to row, boring in the way a balance sheet should be
boring.

The mood is **precise, calm, and accountable**. The interface stays quiet so the
numbers can be loud: a 24px navy price figure is the loudest thing on any screen,
and it earns that by being the number somebody is about to commit to. Colour is
signal, never atmosphere. Role hues tell you whose seat you are in before you
read a word, and every coloured thing is accompanied by words saying the same
thing, because a badge nobody can read is not an accessibility problem, it is a
money problem.

The accent is a single dark navy at 11.82:1 on white, which is why it needs no
variants: it writes, it fills, and it marks a hairline at the same value. Its one
counterweight is a warm ochre, and that exists for exactly one job — the ledger's
money-in / money-out pairs read as warm against cool, because two blues at the
same hue would make the product's most important distinction invisible.

Depth is almost entirely tonal. The whole product lives inside a single lifted
white card floating on a grey ground; inside that card, surfaces separate by 1px
rule and by recession — inputs and tiles drop to the grey, cards stay white. The
system is flat at rest, and shadow is available only as a response to state.

**Key Characteristics:**

- One shell, 1100px max, lifted off a grey ground; nothing else floats at rest.
- Hairline rules (1px `rule-grey`) do the work borders and shadows would do elsewhere.
- Tabular figures portal-wide (`font-variant-numeric: tabular-nums`) — columns of money never jitter.
- Uppercase micro-labels (11px, +0.5px) above every value; values themselves are never uppercase.
- One navy accent at one value (11.82:1 on white), plus a single warm counterweight for money-out.
- Section nav is a left sidebar over 900px and a horizontal strip below it.
- Light-only, deliberately. Every ratio in the palette is verified against white.

## Colors

A monochrome shadcn neutral base carrying one navy accent, one warm counterweight,
and three role hues. The palette's defining property is that its values were
chosen by contrast arithmetic rather than taste, and the ratios are written into
`app/globals.css` beside each token.

### Primary

- **Waybill Navy** (`#26336D`, `oklch(34.4% 0.102 270.7)`): the identity colour and
  the whole accent. At **11.82:1 on white** it does every job without a variant —
  the active nav row, the primary button fill, the 24px price figure, the agreed-price
  cell, the assigned badge, the mini-button label, the logo tile, the route's origin
  dot, the checkbox accent, the focus ring, the scrollbar thumb.
- **Waybill Navy Ink** (`#ffffff`): the only thing that sits on a navy fill (11.82:1).
- **Waybill Navy Hover** (`#304088`) / **Waybill Navy Press** (`#212d60`): the two ends
  of the filled button's state swap. They exist because `filter: brightness()` is
  useless on a dark fill — see the rule below.
- **Waybill Navy Soft** (`#e8ecf8`): tinted background for assigned badges, the
  attention queue, the settlement totals block, the money-in leg tag, and the active
  sidebar row. Navy on it is 10.0:1.

### Secondary

- **Manifest Teal** (`#0e7c6b`): completion and success (4.9:1 on white) — delivered
  badges, the confirmation toast fill, the route's destination dot, WhatsApp links,
  "good" stat figures, the merchant role tag.
- **Manifest Teal Soft** (`#e6f4f1`) / **Manifest Teal Line** (`#c3e3dc`): the tinted
  surface and its hairline, used together on confirmation blocks.
- **Outbound Ochre** (`#965a00`, 5.6:1 on white) with **Outbound Ochre Soft**
  (`#fdf3e0`, 5.1:1 for the ochre on it): money leaving SomoExpress. The `owed` stat
  tone, the `owed` holder cell, `net-out`, and the `out` leg tag. This was the
  product's brand colour before the navy; it survives for one reason, stated in the
  rule below.

### Tertiary

- **Dispatch Blue** (`#3b5bdb`, 5.9:1 on white) with **Dispatch Blue Soft** (`#e8ecfb`):
  the ops seat, and nothing else. It used to carry money-out as well; it no longer
  does.
- **Ledger Violet** (`#5f3dc4`, 7.1:1 on white, 6.3:1 on its own tint) with
  **Ledger Violet Soft** (`#efeafc`): the finance seat. It exists because finance
  needed a hue that could not be confused with any of the others.

### Neutral

- **Ink** (`oklch(0.145 0 0)`): all primary text.
- **Muted Ink** (`#707070`): labels, sub-lines, placeholders, inactive nav items.
  Deliberately darker than shadcn's `#737373`, which clears 4.5:1 on white but
  not on the recessed input grey where most muted labels actually sit.
- **Ledger White** (`oklch(1 0 0)`): the shell, cards, the sidebar, and the sticky
  table header (opaque, because rows pass underneath it).
- **Ground Grey** (`oklch(0.97 0 0)`): the page behind the shell, and every recessed
  surface inside it — inputs, selects, stat tiles, the price box, rider and account
  cards, and the nav item's hover. One token doing both jobs is what makes recession
  read as "inside".
- **Rule Grey** (`oklch(0.922 0 0)`): every hairline, every border, every table rule,
  and the sidebar's right edge.
- **Scrim** (`rgb(0 0 0 / 0.45)`): the modal backdrop, and the only thing in the
  system that sits above the shell.

### Alert

- **Alert Red** (`#b42318`) on **Alert Red Soft** (`#fef2f2`) with **Alert Red Line**
  (`#f3b9b4`): refused submits, validation flags, "bad" figures. 6.2:1 on its tint.
- **Alert Red Bright** (`oklch(0.577 0.245 27.325)`): shadcn's `--destructive`, used
  only as a hover colour on text actions. It reaches about 5:1 on white — not enough
  for a filled surface, which is why the error toast uses Alert Red instead.

### Named Rules

**The One Navy Rule.** The accent is one value. It clears 11.82:1 on white, so there
is no small-text variant, no large-text variant, and no fill-only variant to pick
between — if the answer is "the accent", the answer is `#26336D`. The three aliases
(`--accent`, `--accent-fill`, `--accent-dim`) all resolve to it and exist only to
keep the stylesheet saying which job it is asking for.

**The Warm-Out Rule.** Money in is navy; money out is Outbound Ochre. Never draw an
in/out pair in two cool hues. `--brand-ops` sits 2.7° from the navy in hue, so an
in/out pair rendered in those two is two near-identical blues with soft tints three
values apart — and which direction the money is moving is the one thing the ledger
exists to say.

**The Dark-Fill Hover Rule.** `filter: brightness()` is not a hover on a dark
surface: 1.06 on `#26336D` is a 1.05:1 step, which is nothing. Filled controls swap
`background` to Waybill Navy Hover instead, and outlined controls move their border
or take a soft tint. Never hover a dark fill with a brightness filter.

**The Signal-Only Rule.** Colour never carries meaning alone. Every badge, tile,
and alert is accompanied by words that say the same thing — the stat tile's label
and sub-line always state which way a figure points, and a refused submit says
what is wrong in copy. Colour is what lets someone find the row on a grid of nine;
it is never what tells them what it means.

**The Seat Hue Rule.** Teal is merchant, blue is ops, violet is finance, navy is
admin. Admin and ops are now the two closest hues in the palette; they are tolerable
only because a role tag shows one seat at a time and the two are adjacent nowhere
except the accounts list. A fifth seat needs a hue that is not another blue.

## Typography

**Display Font:** Inter (with `system-ui`, `sans-serif`)
**Body Font:** Inter (with `system-ui`, `sans-serif`)
**Label/Mono Font:** Inter — see the rule below

**Character:** One variable face doing every job, which suits a document that
values sameness over expression. Inter's neutrality is the point: nothing in the
type competes with the figures, and the hierarchy is carried almost entirely by
size, weight, and tracking rather than by contrast of family.

### Hierarchy

- **Display** (600, 24px, 1.2): the computed price. The largest type in the product,
  and the loudest type in the product.
- **Headline** (600, 19px, 1.2): stat-tile figures on the dashboard and ledger.
- **Title** (600, 18px, +0.2px): the portal wordmark beside the logo mark.
- **Section** (600, 14px, +0.2px): card headings. Same weight and tracking as Title
  at a smaller size, so a card heading reads as a smaller sibling of the wordmark
  rather than as a different kind of thing.
- **Body** (400, 14px, 1.5): inputs, selects, primary prose. Table body drops to 13px;
  supporting prose to 12.5px at 1.5.
- **Label** (500, 11px, +0.5px, uppercase): table column headers, stat-tile labels,
  card sub-headings. Field labels sit at 11.5px/+0.5px.
- **Meta** (11.5px, +0.4px, uppercase, muted): the strip under the wordmark and
  similar standing captions.

### Named Rules

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set once on the shell
and inherited everywhere. Inter's proportional digits would make prices, distances,
and IDs jitter between rows, and a column of money that shifts as it scrolls is
harder to audit. Never override it.

**The Mono-Intent Rule.** `--font-mono` resolves to Inter, not to a monospace face.
The three type tokens (`--font-display`, `--font-body`, `--font-mono`) survive as
separate names so the stylesheet keeps expressing intent — display / body / numeric —
even though all three resolve to one family. Applying `--font-mono` marks a value as
numeric or machine-ish; it does not request a different typeface, and it must not be
"fixed" by pointing it at one.

**The Micro-Label Rule.** Every label above a value is 11–11.5px, uppercase, +0.4
to +0.5px tracked, and muted. Values are never uppercase and never tracked. The
label/value pair is the atom this whole system is built from.

## Layout

The entire product is one shell: a `1100px` max-width card, `min-height 640px`,
centred on the grey ground with `24px 12px` of breathing room, `border-radius 14px`.
The auth overlay narrows the same shell to `520px` rather than introducing a second
container.

Inside, the shell is a header band (`20px 26px`) above a row: a `200px` nav sidebar
beside the content body (`26px`), separated by hairlines. The body carries
`min-width: 0` so the delivery log's `700px`-min-width table shrinks inside the flex
row instead of pushing the shell past its frame. Below **900px** that row collapses
to a stacked block and the nav returns to a horizontal strip above the content, so
the layout is three bands again at the sizes where content width matters more than
persistent navigation.

Content grids are explicit and few:

- **Primary split** `1.15fr 0.85fr` at `22px` gap — the form-plus-summary pattern.
  Collapses to one column at **760px**.
- **Even split** `1fr 1fr` at `18px` gap — two peer cards. Collapses at **900px**.
- **Field pair** `1fr 1fr` at `14px` gap inside a form.
- **Auto-fit tiles** `repeat(auto-fit, minmax(190px, 1fr))` at `10px` gap — stat rows
  reflow without a breakpoint.
- **Settings and rider grids** collapse at **900px** and **700px** respectively.
- **Nav sidebar** `200px` fixed beside a `min-width: 0` body. Collapses to the
  horizontal strip at **900px**.

Vertical rhythm: cards stack at `18px`, fields at `14px`, inline groups at `8–12px`.
Card padding is `20px`; tile padding `12px 14px`.

**Responsive behaviour.** Breakpoints are `640px`, `700px`, `760px`, `900px`, plus a
capability query. At **640px** the header wraps to two rows and the account badge
becomes a full-width block with a `10px` radius instead of a pill. Under
`(pointer: coarse)` every tab, mini-button, small button, input, and select is
raised to a `44px` minimum height — a capability query rather than a width
breakpoint, so a touch laptop gets the same treatment as a phone. The `/d/<token>`
link page is the one surface that goes edge-to-edge below 640px: border and radius
are removed and the card becomes the page, because it is held at a roadside and
the frame is wasted space.

Tables are the exception to the responsive story. `table.somo-table` holds a
`min-width: 700px` and scrolls horizontally inside a wrapper capped at `60vh` with
a sticky opaque header. The cap is deliberate: with `overflow-x` alone, the
horizontal scrollbar sits at the bottom of a forty-row table, so reaching it meant
scrolling to the bottom, dragging sideways, and scrolling back up to read what you
uncovered. `60vh` and not `75vh` because the attention queue and toolbar sit above
the box, and a taller cap pushes its own scrollbar back below the fold.

### Named Rules

**The One Shell Rule.** There is exactly one container in this product. Content never
touches the viewport edge, and nothing is ever presented outside the shell — the one
exception is the public link page under 640px, which becomes the page on purpose.

## Elevation & Depth

Depth is tonal first. The only standing shadow in the system belongs to the shell:

```css
box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 28px rgb(0 0 0 / 0.06);
```

A tight contact shadow plus a wide soft one, both very low opacity — enough to
separate the card from the grey ground without reading as a floating panel.
Inside the shell, everything is flat: cards are white with a 1px rule, inputs and
tiles recede to the grey, and the sticky table header is opaque white rather than
elevated. Layering, not lifting.

Shadow is nonetheless **available as a response to state**. Nothing currently uses
it — the table's row hover is a `rgb(0 0 0 / 0.02)` background tint, and buttons
brighten rather than lift — but a hover or focus elevation on a row, card, or
draggable is sanctioned where it communicates interactivity. What is not sanctioned
is a shadow that is simply there at rest.

### Shadow Vocabulary

- **Shell lift** (`0 1px 2px rgb(0 0 0 / 0.04), 0 8px 28px rgb(0 0 0 / 0.06)`): the
  one standing elevation. Reserved for the shell; do not reuse it on a card.
- **State lift** (new work): keep it under the shell's total weight and pair it with
  a colour or border change, so it reads as a response rather than as decoration.

### Named Rules

**The Flat-At-Rest Rule.** Surfaces are flat at rest. Depth at rest is carried by
tone (white card, grey recess) and by 1px rules. A shadow that appears without a
state change behind it is a mistake.

## Shapes

A radius ladder in three tiers, where the number tracks what kind of thing is
being drawn rather than a free choice of softness.

**Marks** — drawn geometry, not containers:

- **2px** — the completed cap on a dashboard chart bar.
- **3px** — the route track, chart bar tops, the chart legend swatch.

**Controls and inline chips:**

- **6px** — a control inside a table cell (the status select).
- **7px** — small inline actions and cells that are chips rather than controls:
  the notify modal's channel links, the ledger's holder cell, the settlement row's
  short marker.
- **8px** — every standard control: inputs, selects, buttons, checkbox chips,
  validation flags, the notify-link block.

**Containers:**

- **9px** — the 34px logo mark.
- **10px** — recessed tiles: stat tiles, the price box, rider and account cards,
  the confirm summary, and the account badge in its collapsed mobile form.
- **12px** — cards.
- **14px** — the shell.
- **16px** — the public link card, the one container that is a whole page rather
  than a card inside one.
- **999px** — pills: status badges, role tags, the account badge, its inner button.

Borders are uniformly `1px solid` in Rule Grey, or in a tint's own line colour
(`manifest-teal-line`, `alert-red-line`) when the surface is tinted. Dashed borders
carry a specific meaning: the price box's internal divider and the rider's
completion-link block are dashed, marking a thing that is torn off or copied out.
The route indicator uses two `10px` dots joined by a `3px` track — the one place
geometry is drawn rather than composed.

**The unauthenticated ground.** The two surfaces that exist without a session — the
auth overlay and the public link page — replace the flat grey ground with a barely
perceptible radial wash, `radial-gradient(circle at 30% 20%, var(--card) 0%, var(--muted) 75%)`.
It is the system's only atmospheric effect, and it is confined to the screens that
have no navigation to give them structure.

### Named Rules

**The Radius Ladder Rule.** Every radius in the product is one of 2, 3, 6, 7, 8, 9,
10, 12, 14, 16, or 999, and the tier matters more than the number: marks get 2–3,
controls and inline chips get 6–8, containers get 9–16, pills get 999. A new value
needs a new tier to justify it; otherwise pick the rung that already describes what
is being drawn.

**The Dashed-Means-Detachable Rule.** A dashed rule marks something that leaves the
page — a copyable link, a tear-off total. Solid everywhere else.

## Components

### Buttons

- **Shape:** consistently rounded (`8px`), never pill, never square.
- **Primary:** Waybill Navy fill with white text, `12px` padding,
  600/14px, full width. Hover is `filter: brightness(1.06)` — no transition, no
  lift, no colour swap. Disabled drops to `opacity: 0.5` with `not-allowed`.
- **Ghost:** transparent with a Rule Grey border and Ink text at 500 weight. The
  quieter peer of a primary, used when both actions are ordinary.
- **Decline:** transparent with an Alert Red Line border and Alert Red text. Used
  for the rider refusing a job — refusing is a normal answer, not a destructive one,
  so it is outlined rather than red-filled. This distinction is load-bearing: reserve
  a red *fill* for genuinely destructive confirmation.
- **Small:** `9px 16px`, 12.5px, auto width.
- **Mini:** the inline button beside an input — Ground Grey fill, Waybill Navy
  label at 600/12px, border moves to navy on hover.
- **Focus (all):** the global ring, below.

### Inputs / Fields

- **Style:** recessed — Ground Grey fill, Rule Grey border, `8px` radius,
  `10px 12px` padding, 14px body text.
- **Label:** above the field, 11.5px uppercase +0.5px muted, `6px` gap.
- **Focus:** border switches to Waybill Navy, native outline removed, and the
  global focus ring takes over.
- **Disabled:** `opacity: 0.6`. Placeholder is Muted Ink.
- **Checkbox chip:** a bordered `8px` chip that swaps its border to navy and its
  text to Ink when checked; the native input keeps `accent-color`.

### Cards / Containers

- **Corner:** `12px`.
- **Background:** Ledger White on the shell's white — separation comes from the
  `1px` Rule Grey border, not from tone.
- **Shadow:** none. See Elevation.
- **Padding:** `20px`. Sibling cards stack at `18px`.
- **Heading:** 600/14px +0.2px, `16px` bottom margin, with an optional navy ordinal
  (`.n`, 12px) and a right-aligned muted note (`.tag-note`, 11.5px/400).
- **Cards do not nest.** A card contains recessed tiles and boxes; it never contains
  another card.

### Navigation

The section nav has two forms, and the same markup produces both. Every item is a
real route link either way, so panes are never hidden — the `somoFade` animation
just softens the change.

**Sidebar (over 900px).** A `200px` column on the left of the shell, white with a
`1px` Rule Grey right edge, `14px 12px` of padding and `2px` between items. Each
item is `9px 12px` at 13.5px/500 with an `8px` radius. Inactive is Muted Ink; hover
takes Ink text on Ground Grey; active is Waybill Navy text on Waybill Navy Soft at
600 weight.

**Strip (900px and under).** The same nav becomes the horizontally scrolling row
above the content it shipped with: `4px` gaps, `13px 16px` per item, no radius, no
fill, and a `2px` navy bottom border marking the active one. The sidebar's `200px`
is worth more as content width at that size, which is also where the two-column
content grids collapse.

**Order.** Dashboard, New delivery, Deliveries, Ledger, Riders, Pricing, Users,
Settings. Dashboard leads because it answers "where do things stand"; the next two
carry the day's work; the rest is reference and setup. Role filtering removes items
without reordering them, and two labels narrow per role — a merchant sees "My
ledger", ops sees "Merchants" for Users.

- **Touch:** `44px` minimum height under `(pointer: coarse)`.

### Named Rules

**The Selected-Surface Rule.** A selected nav item is a tinted surface, not an
underline — the same soft-tint-plus-accent pairing the status badges and ledger
holder cells use. The `2px` underline is a horizontal-strip idiom and means nothing
in a column, so it exists only in the strip form.

### Badges and Tags

- **Status badge:** `999px` pill, `3px 9px`, 11px/600, `white-space: nowrap`.
  Requested is neutral grey, assigned is navy-soft, delivered is teal-soft,
  and the legacy approval state is red-soft.
- **Role tag:** `999px` pill, `2px 7px`, 10px +0.4px uppercase, in the seat's soft/hue
  pair.

### Stat Tile

The signature component, shared by the dashboard and the ledger so the same kind of
figure never looks like two unrelated numbers. A recessed `10px` tile holding three
stacked lines: an 11px uppercase muted label, a 19px/600 figure, and an optional
11px/1.45 muted sub-line. Six tones (`due` navy, `owed` outbound-ochre,
`good` teal, `bad` alert-red, `flight` muted, `info` inherit) colour **only the
figure** — state is carried by the labelled value, not by a decorative edge, and
never by colour alone.

### Route Indicator

Two `10px` dots — navy for origin, teal for destination — joined by a `3px` Rule Grey
track that fills with a `navy → teal` gradient as the distance resolves, scaled in
on the X axis over `0.25s` expo-out. This is the only gradient in the system and it
encodes direction of travel.

### Focus Ring

One treatment for everything focusable:

```css
outline: 3px solid color-mix(in srgb, var(--accent) 58%, transparent);
outline-offset: 2px;
```

The scrollable table wrapper uses 55% at `3px` offset. Never remove a focus ring
without replacing it with something at least as visible.

### Motion

- **Pane enter:** `somoFade`, `0.25s ease` — opacity 0→1 with a `4px` rise.
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) for transforms — the route
  fill at `0.25s`, the toast at `0.2s`.
- **Opacity:** `0.2s ease`.
- **Reduced motion:** `prefers-reduced-motion: reduce` removes the pane animation
  and the route transition outright, and collapses the toast to `opacity 0.1s linear`
  with no transform. Any new motion must have an entry here.

## Do's and Don'ts

### Do:

- **Do** extend the `.somo-*` layer in `app/globals.css`. That hand-written layer *is*
  the design system; the shadcn install underneath it supplies neutral tokens only.
- **Do** reach for `#26336D` whenever the answer is "the accent". There is no
  size-dependent or fill-only variant to choose between any more.
- **Do** verify any new colour against the surface it actually sits on and record the
  ratio in a comment, the way the existing palette does.
- **Do** pair every colour cue with words that say the same thing.
- **Do** keep new radii on the ladder (2/3/6/7/8/9/10/12/14/16/999), matching the tier
  to what is being drawn.
- **Do** keep `44px` minimum control heights under `(pointer: coarse)`.
- **Do** add a `prefers-reduced-motion` case for any new animation or transition.
- **Do** vendor any new typeface as a local `.woff2` under `app/fonts/`.

### Don't:

- **Don't** add shadcn components. `components/ui/button.tsx` is scaffolding imported
  nowhere; introducing it would give the portal two button languages at once.
- **Don't** design, verify, or screenshot against `.dark`. The dark token block in
  `globals.css` is inherited shadcn scaffolding that nothing applies — the portal is
  light-only on purpose and every documented ratio is against white.
- **Don't** hover a dark fill with `filter: brightness()`. On `#26336D` a 1.06 filter
  is a 1.05:1 step — no hover at all. Swap `background` to `#304088` instead.
- **Don't** draw an in/out or due/owed pair in two cool hues. `--brand-ops` is 2.7°
  from the navy; money out is Outbound Ochre for that reason.
- **Don't** reintroduce `--brand-amber`, `--amber`, or a size-dependent accent variant.
  The accent is one navy and the aliases (`--accent`, `--accent-fill`, `--accent-dim`)
  all resolve to it.
- **Don't** override `font-variant-numeric: tabular-nums`.
- **Don't** point `--font-mono` at a real monospace face, or add a second typeface.
  Never load a font from a CDN — the build cannot reach `fonts.gstatic.com` and will
  fail, in Docker too.
- **Don't** add a gradient. This system has exactly two, and both are structural:
  the route line's `navy → teal` fill encodes direction of travel, and the radial
  wash grounds the two session-less screens. A third gradient is decoration.
- **Don't** put a shadow on anything at rest. Depth at rest is tone and hairlines.
- **Don't** nest a card inside a card.
- **Don't** use bounce or elastic easing. The system's motion is expo-out
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Don't** reach for the purple-to-blue-gradient dashboard look — glassmorphism,
  nested cards, an icon tile above every heading. Confirmed anti-reference.
- **Don't** reach for the dark fintech terminal look — near-black surfaces, neon
  accents, monospace everything. Confirmed anti-reference, and it hurts on an all-day
  operations screen.
- **Don't** red-fill an action that is merely a "no". Outline it, the way the rider's
  decline button does.
