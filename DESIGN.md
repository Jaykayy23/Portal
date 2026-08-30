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
  cool-ground: "oklch(0.973 0.007 255)"
  rule-grey: "oklch(0.922 0 0)"
  ink: "oklch(0.145 0 0)"
  muted-ink: "#707070"
  scrim: "rgb(0 0 0 / 0.45)"
typography:
  display:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "0.2px"
  dialog:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "0.2px"
  section:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.2px"
  body:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  nav:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
  table:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  support:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0.4px"
  label:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.5px"
  tag:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.4px"
  # The enumerated ramp. The roles above name the steps that carry hierarchy;
  # this is every step the stylesheet actually uses, including the ones that are
  # a size rather than a role — the 16px iOS zoom floor on mobile inputs, the
  # 10.5px mono sub-value, the 30px confirmation glyph.
  scale:
    tick: "30px"
    price: "24px"
    link-total: "20px"
    figure: "19px"
    wordmark: "18px"
    dialog: "17px"
    touch-input: "16px"
    lede: "15px"
    link-body: "14.5px"
    body: "14px"
    nav: "13.5px"
    table: "13px"
    support: "12.5px"
    compact: "12px"
    field-label: "11.5px"
    micro-label: "11px"
    sub-value: "10.5px"
    tag: "10px"
    leg-tag: "9.5px"
rounded:
  bar: "2px"
  track: "3px"
  chip-cell: "6px"
  chip-inline: "7px"
  control: "8px"
  logo: "9px"
  tile: "10px"
  card: "12px"
  overlay: "14px"
  page-card: "16px"
  pill: "999px"
spacing:
  gap-tight: "8px"
  gap: "12px"
  field: "14px"
  card-stack: "18px"
  card-pad: "20px"
  grid-gap: "22px"
  body-pad: "28px"
  body-pad-bottom: "44px"
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
    backgroundColor: "{colors.cool-ground}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "100%"
  input:
    backgroundColor: "{colors.cool-ground}"
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
    backgroundColor: "{colors.cool-ground}"
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
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  bell:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    size: "38px"
  bell-hover:
    backgroundColor: "{colors.cool-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "38px"
  bell-open:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    size: "38px"
  bell-count:
    backgroundColor: "{colors.waybill-navy}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.pill}"
    padding: "0 4px"
    height: "18px"
  bell-panel:
    backgroundColor: "{colors.ledger-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    width: "392px"
  alert-new-tag:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
  attention-strip:
    backgroundColor: "{colors.waybill-navy-soft}"
    textColor: "{colors.waybill-navy}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    width: "100%"
  toast-confirm:
    backgroundColor: "{colors.manifest-teal}"
    textColor: "{colors.ledger-white}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  toast-alert:
    backgroundColor: "{colors.waybill-navy}"
    textColor: "{colors.waybill-navy-ink}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  toast-error:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.ledger-white}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
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

The product is a **window, not a page floating on a desk**. A pinned topbar and a
full-height left column of destinations frame a content field that runs to the
edge of the useful width; the chrome is separated from the work by the same 1px
rules the tables use, not by lift. Depth is almost entirely tonal — white
surfaces on a cool off-white ground, with inputs and tiles dropping to the ground
colour while cards stay white. The system is flat at rest, and shadow belongs to
things that genuinely float over what they cover.

**Key Characteristics:**

- A window shell: edge-to-edge pinned topbar, a 248px nav column at the far left, and a card-less content field.
- Hairline rules (1px `rule-grey`) do the work borders and shadows would do elsewhere.
- Tabular figures portal-wide (`font-variant-numeric: tabular-nums`) — columns of money never jitter.
- Uppercase micro-labels (11px, +0.5px) above every value; values themselves are never uppercase.
- One navy accent at one value (11.82:1 on white), plus a single warm counterweight for money-out.
- The content field fills the window to 1600px; forms take a measure instead.
- What needs attention lives in the topbar, on every tab, behind one glyph.
- Light-only, deliberately. Every ratio in the palette is verified against white.

## Colors

A monochrome shadcn neutral base, cooled one step, carrying one navy accent, one
warm counterweight, and three role hues. The palette's defining property is that
its values were chosen by contrast arithmetic rather than taste, and the ratios
are written into `app/globals.css` beside each token.

### Primary

- **Waybill Navy** (`#26336D`, `oklch(34.4% 0.102 270.7)`): the identity colour and
  the whole accent. At **11.82:1 on white** it does every job without a variant —
  the active nav row, the primary button fill, the 24px price figure, the agreed-price
  cell, the assigned badge, the alert bell's unread count, the mini-button label,
  the logo tile, the route's origin dot, the checkbox accent, the focus ring, the
  scrollbar thumb.
- **Waybill Navy Ink** (`#ffffff`): the only thing that sits on a navy fill (11.82:1).
- **Waybill Navy Hover** (`#304088`) / **Waybill Navy Press** (`#212d60`): the two ends
  of the filled button's state swap. They exist because `filter: brightness()` is
  useless on a dark fill — see the rule below.
- **Waybill Navy Soft** (`#e8ecf8`): tinted background for assigned badges, the
  settlement totals block, the money-in leg tag, the active sidebar row, the open
  bell, the `new` alert tag, and the delivery log's attention strip. Navy on it is
  10.0:1.

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
  not on the recessed ground where most muted labels actually sit. Verified 4.58:1
  on Cool Ground.
- **Ledger White** (`oklch(1 0 0)`): the topbar, the nav column, every card, and the
  sticky table header (opaque, because rows pass underneath it).
- **Cool Ground** (`oklch(0.973 0.007 255)`, `#f3f6fb`): the window behind the work,
  and every recessed surface inside it — inputs, selects, stat tiles, the price box,
  rider and account cards, the nav item's hover, the bell's hover. One token doing
  both jobs is what makes recession read as "inside". Cool rather than neutral: it
  is the whole window now rather than a margin around a card, and a dead-neutral
  grey at that size reads as unpainted rather than as a decision. It sits 1.08:1 off
  white — enough for the white surfaces on it to still read as surfaces.
- **Rule Grey** (`oklch(0.922 0 0)`): every hairline, every border, every table rule,
  the topbar's bottom edge, and the nav column's right edge.
- **Scrim** (`rgb(0 0 0 / 0.45)`): the modal backdrop, and the only thing in the
  system that sits above the chrome.

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
or take a soft tint. A control that is *already* tinted deepens its tint —
`color-mix(in srgb, var(--accent) 15%, var(--panel))` — because a brightness filter
on a tint that pale is no hover either.

**The Signal-Only Rule.** Colour never carries meaning alone. Every badge, tile,
tag, and alert is accompanied by words that say the same thing — the stat tile's
label and sub-line always state which way a figure points, a refused submit says
what is wrong in copy, and the bell's unread count is spelled out in its own
accessible name. Colour is what lets someone find the row on a grid of nine; it is
never what tells them what it means.

**The Seat Hue Rule.** Teal is merchant, blue is ops, violet is finance, navy is
admin. Admin and ops are now the two closest hues in the palette; they are tolerable
only because a role tag shows one seat at a time and the two are adjacent nowhere
except the accounts list. A fifth seat needs a hue that is not another blue.

**The Not-An-Error Rule.** An alert is work waiting, not a failure. Anything
announcing that something needs attention — the bell, its count, the `new` tag, the
attention strip, the alert toast — takes the navy, never the red. Red is reserved
for a thing that went wrong, and a notification badge in red teaches people that
ordinary work looks like breakage.

## Typography

**Display Font:** Roboto (with `system-ui`, `sans-serif`)
**Body Font:** Roboto (with `system-ui`, `sans-serif`)
**Label/Mono Font:** Roboto — see the rule below

**Character:** One variable face doing every job, which suits a document that
values sameness over expression. Roboto's neutrality is the point: nothing in the
type competes with the figures, and the hierarchy is carried almost entirely by
size, weight, and tracking rather than by contrast of family.

### Hierarchy

The roles that carry hierarchy:

- **Display** (600, 24px, 1.2): the computed price. The largest type in the product,
  and the loudest type in the product.
- **Headline** (600, 19px, 1.2): stat-tile figures on the dashboard and ledger.
- **Title** (600, 18px, +0.2px): the portal wordmark beside the logo mark.
- **Dialog** (600, 17px, +0.2px): a modal's own heading. One step above a card
  heading because a dialog has no card around it to say where it begins.
- **Section** (600, 14px, +0.2px): card headings. Same weight and tracking as Title
  at a smaller size, so a card heading reads as a smaller sibling of the wordmark
  rather than as a different kind of thing.
- **Body** (400, 14px, 1.5): inputs, selects, primary prose.
- **Nav** (500, 13.5px): sidebar and strip items — one step under body, because a
  destination is not content.
- **Table** (400, 13px): table body rows.
- **Support** (400, 12.5px, 1.5): supporting prose, small buttons, the bell's action
  lines, the attention strip.
- **Meta** (11.5px, +0.4px, uppercase, muted): field labels and standing captions.
- **Label** (500, 11px, +0.5px, uppercase): table column headers, stat-tile labels,
  card sub-headings, the bell panel's own heading.
- **Tag** (600, 10px, +0.4px, uppercase): role tags, the bell's unread count, the
  `new` alert tag.

The full enumerated ramp is in the frontmatter's `typography.scale`. Four of its
steps are a size rather than a role and are documented there rather than above:
**16px** on mobile inputs (below it, iOS Safari zooms the page on focus), **15px**
for a price row's secondary value, **10.5px** for a mono sub-value under a money
cell, and **30px** for the confirmation tick — a drawn glyph, not type.
**9.5px** appears exactly once, on the ledger's leg tag.

**The link page runs a fluid ramp, and it is the only surface that does.** The
portal's type is fixed at every width because a desk screen and a laptop screen
want the same table; `/d/<token>` is held at arm's length at a gate, on an unknown
phone, by somebody who did not choose to be there, so its type scales with the
viewport instead: `clamp(19px, 5vw, 24px)` for the page heading, `clamp(17px,
4.6vw, 20px)` for the total the rider is accountable for, then `clamp(15px, 4vw,
17px)`, `clamp(13px, 3.6vw, 15px)`, `clamp(13px, 3.4vw, 14.5px)` and
`clamp(12px, 3.2vw, 13px)` down the summary. The two endpoints that exist nowhere
else — **20px** and **14.5px** — belong to that ramp and should not be borrowed
into the portal.

### Named Rules

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set once on the frame
and inherited everywhere. Roboto's proportional digits would make prices, distances,
and IDs jitter between rows, and a column of money that shifts as it scrolls is
harder to audit. Never override it.

**The Mono-Intent Rule.** `--font-mono` resolves to Roboto, not to a monospace face.
The three type tokens (`--font-display`, `--font-body`, `--font-mono`) survive as
separate names so the stylesheet keeps expressing intent — display / body / numeric —
even though all three resolve to one family. Applying `--font-mono` marks a value as
numeric or machine-ish; it does not request a different typeface, and it must not be
"fixed" by pointing it at one.

**The Vendored-Face Rule.** The portal's face is **Roboto**, vendored as
`app/fonts/Roboto-Variable.woff2` — the SIL OFL latin weight axis, taken from
`@fontsource-variable/roboto` and copied in rather than depended on, so the build
never reaches the network for type. It replaced Inter, which had held the same
single-family job. Roboto is also the system face on Android, which is what most
merchants file requests from, so on a phone the portal very often renders a face
the device already holds. Never load a face from a CDN and never add a second
family; `next/font/local` folds the metric-matched fallback into `--font-sans`,
so the three type tokens carry only a last-resort generic after it.

**The Micro-Label Rule.** Every label above a value is 11–11.5px, uppercase, +0.4
to +0.5px tracked, and muted. Values are never uppercase and never tracked. The
label/value pair is the atom this whole system is built from.

**The Documented-Step Rule.** The ramp is enumerated, not open. A new size needs a
new entry in `typography.scale` and a reason, or it needs to be one of the steps
already there — and a `clamp()` has to have *both* endpoints on the ramp, not just
its floor. Two of the existing steps, 9.5px and 30px, are single-use and should be
absorbed rather than joined by a third.

**The Fixed-Portal Rule.** Type inside the portal is fixed. Fluid sizing belongs
to `/d/<token>` alone, because that is the only surface whose reading distance is
unknown. A `clamp()` on a portal screen makes the same table render at two
different sizes on two desks, which is the opposite of what a ledger wants.

## Layout

The product is a **window**. Three regions fill the viewport with no frame around
them and no gaps between them: a pinned topbar across the top, a nav column at the
far left, and the content field beside it. `body` carries no padding on the portal;
the shell reaches every edge.

**The topbar** is `64px` tall (`70px` under a coarse pointer, where every control in
it is raised to a 44px target), `0 22px` of padding, `position: sticky; top: 0`, at
`z-index: 50` — under the modal backdrop (60) and the toast (90). It is opaque
Ledger White with a 1px Rule Grey bottom edge and no shadow. Its height is named
once as `--somo-topbar`, because the nav column sticks directly beneath it and the
two have to agree to the pixel or a hairline of scrolled content shows through the
join.

**The nav column** is `248px`, its own Ledger White surface with a 1px right edge,
`16px 14px` of padding and `3px` between items. It is `position: sticky` at
`top: var(--somo-topbar)` with `height: calc(100dvh - var(--somo-topbar))` and
`overflow-y: auto`, so it holds still while the content scrolls and scrolls inside
itself on a short viewport rather than running off the bottom of the screen.

**The content field** carries `28px 28px 44px` of padding — more below than above, so
the last card in a pane does not sit on the window's bottom edge — plus
`min-width: 0` so the delivery log's `700px`-min-width table shrinks inside the flex
row instead of pushing the shell wider than the window, and
`scroll-margin-top: calc(var(--somo-topbar) + 12px)` so the skip link and any in-page
anchor do not land underneath the pinned bar. The pane inside it is capped at
`1600px` and centred.

Forms do not take that width. The pane's cap exists so the delivery log can use the
window; applied to a form it makes a single-line address input 865px wide. The
composed containers carry their own measure: the form-plus-summary split and the
settings grid cap at `1180px`, a field pair (`.somo-row2`) and a form-only card
(`.somo-card.narrow`) at `720px`.

The auth overlay and the public link page are the two surfaces outside this shell.
The auth overlay keeps the old centred frame, narrowed to `520px`, and is the one
place the frame is itself a card. The link page fills the viewport with a
`100dvh` column.

Content grids are explicit and few:

- **Primary split** `1.15fr 0.85fr` at `22px` gap, capped at `1180px` — the
  form-plus-summary pattern. Collapses to one column at **760px**.
- **Even split** `1fr 1fr` at `18px` gap — two peer cards. Collapses at **900px**.
- **Field pair** `1fr 1fr` at `14px` gap, capped at `720px`.
- **Auto-fit tiles** `repeat(auto-fit, minmax(190px, 1fr))` at `10px` gap — stat rows
  reflow without a breakpoint.
- **Settings grid** two columns capped at `1180px`, collapsing at **900px**; the
  riders grid collapses at **700px**.

Vertical rhythm: cards stack at `18px`, fields at `14px`, inline groups at `8–12px`.
Card padding is `20px`; tile padding `12px 14px`.

**Responsive behaviour.** Breakpoints are `640px`, `700px`, `760px`, `900px`, plus a
capability query.

Below **900px** the nav column becomes a horizontal strip above the content — its
right edge moves to its bottom edge, its height goes to `auto`, and nothing sticks
but the topbar. A `248px` column is worth more as content width at that size, which
is also where the two-column content grids collapse.

Below **760px** the bell's panel stops being a popover anchored to the bell and
becomes a sheet under the bar, `12px` inset on both sides. Anchoring a `392px` panel
to the bell's right edge only works while the bell is at least `392px` from the left
of the window, and the overflow is in the offset rather than the width, so no
`max-width` can rescue it. 760 rather than 700 for the margin: the account badge's
width follows the company name, so the bell's position is not fixed at any given
viewport.

At **640px** the topbar stays one row — it is pinned, and a bar that wraps to two
owns a sixth of a phone screen for the whole session. It pays for that by dropping
the standing caption under the wordmark and the company name out of the account
badge, leaving the mark, the wordmark, the bell, the seat tag and the way out. The
brand's priority inverts here: above 640px the brand gives way first and the
wordmark truncates; below it the wordmark is the half worth keeping. The bell panel
also stacks each row, and the delivery table becomes cards.

Under `(pointer: coarse)` every tab, mini-button, small button, input, select, and
the attention strip is raised to a `44px` minimum height, and the bell to a `44×44`
square — a capability query rather than a width breakpoint, so a touch laptop gets
the same treatment as a phone. The `/d/<token>` link page is the one surface that
goes edge-to-edge below 640px: border and radius are removed and the card becomes
the page, because it is held at a roadside and the frame is wasted space.

Tables are the exception to the responsive story. `table.somo-table` holds a
`min-width: 700px` and scrolls horizontally inside a wrapper capped at `68vh` with
a sticky opaque header. The cap is deliberate: with `overflow-x` alone, the
horizontal scrollbar sits at the bottom of a forty-row table, so reaching it meant
scrolling to the bottom, dragging sideways, and scrolling back up to read what you
uncovered. It was `60vh` while a six-row attention queue sat above the box as well
as the toolbar; with the queue reduced to one line, the box took that height back.
Still not 75: a taller cap pushes the box's own scrollbar below the fold, which is
the entire problem it is there to solve.

### Named Rules

**The Window Rule.** The portal fills the viewport. The topbar spans it, the nav
column is flush to its left edge, and the content field runs to the useful width —
no outer frame, no gaps between the three, and no page-level card. This replaced a
`1100px` frame holding three lifted panels: what the frame bought was breathing
room, and what it cost was every pixel of table width past 1100px on a product whose
main screen is a fifteen-column log. The two session-less surfaces are exempt.

**The Named-Height Rule.** The topbar's height is a variable, not a number typed
twice. Anything that pins itself beneath the bar — today the nav column, tomorrow
whatever else — offsets by `var(--somo-topbar)`. Two hard-coded copies drift the
first time the bar changes, and the symptom is a 1px seam of moving content.

**The Measure Rule.** Width is granted by content type, not by the container. A
table takes the field; a form takes a measure. The pane's `1600px` is a ceiling for
the widest thing on a screen, and every composed container inside it carries its
own smaller cap. A form field that grew to 865px because nothing stopped it is the
failure this rule names.

## Elevation & Depth

Depth is tonal first, and more so than before. The shell is drawn entirely with
hairlines: the topbar and the nav column are opaque Ledger White separated from the
work by 1px Rule Grey edges, with no radius and no shadow. Content passes
underneath the topbar, which is exactly the situation the sticky table header is in,
and it takes the same answer — opaque, ruled, not lifted.

Inside the field, everything is flat: cards are white with a 1px rule on the cool
ground, inputs and tiles recede to the ground colour, and the sticky table header is
opaque white rather than elevated. Layering, not lifting.

Two shadow values exist, and both belong to things that genuinely float over
content they did not displace.

Shadow remains **available as a response to state**. Nothing currently uses it —
the table's row hover is a `rgb(0 0 0 / 0.02)` background tint, buttons swap fill,
and the attention strip deepens its tint — but a hover or focus elevation on a row,
card, or draggable is sanctioned where it communicates interactivity. What is not
sanctioned is a shadow that is simply there at rest.

### Shadow Vocabulary

- **Panel lift** (`0 1px 2px rgb(0 0 0 / 0.04), 0 8px 28px rgb(0 0 0 / 0.06)`): a
  tight contact shadow plus a wide soft one. It used to carry the three top-level
  panels; the shell is hairlined now, and this survives on the one surface that is
  still a card floating on a ground — the auth overlay. Do not reuse it inside the
  portal.
- **Overlay lift** (`0 1px 2px rgb(0 0 0 / 0.05), 0 8px 22px rgb(0 0 0 / 0.10)`): the
  hint bubble and the alert bell's panel. The one shadow that is not a response to
  state, allowed because an overlay sharing a plane with what it covers is
  unreadable.
- **State lift** (new work): keep it under the panel lift's total weight and pair it
  with a colour or border change, so it reads as a response rather than decoration.

### Named Rules

**The Flat-At-Rest Rule.** Surfaces are flat at rest. Depth at rest is carried by
tone (white surface, cool recess) and by 1px rules. A shadow that appears without a
state change behind it is a mistake.

**The Ruled-Chrome Rule.** The shell separates itself from the work with a hairline,
never with lift. A full-bleed bar has no corners to round and nothing to float
above; giving it a shadow makes the whole window look like a stack of loose paper.
Anything pinned to an edge — the topbar, the nav column, a future footer — is
opaque and ruled.

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
  short marker, the bell panel's row actions.
- **8px** — every standard control: inputs, selects, buttons, checkbox chips,
  validation flags, the notify-link block, the alert bell, the attention strip.

**Containers:**

- **9px** — the 34px logo mark.
- **10px** — recessed tiles: stat tiles, the price box, rider and account cards,
  the confirm summary, the hint bubble, and the ring the bell draws when a new
  alert lands.
- **12px** — cards, and the bell's panel.
- **14px** — the two full-surface overlays: the modal dialog and the auth card. This
  rung used to describe the three top-level panels; the shell has no radius now, and
  what is left at 14px is the pair of surfaces that cover the window rather than sit
  in it.
- **16px** — the public link card, the one container that is a whole page rather
  than a card inside one.
- **999px** — pills: status badges, role tags, leg tags, the account badge, its inner
  button, the bell's unread count, the `new` alert tag.

Two values sit outside the ladder on purpose: `50%` on the route indicator's dots,
which are circles rather than rounded boxes, and `0` on the link page's full-bleed
container.

Borders are uniformly `1px solid` in Rule Grey, or in a tint's own line colour
(`manifest-teal-line`, `alert-red-line`) when the surface is tinted. Dashed borders
carry a specific meaning: the price box's internal divider and the rider's
completion-link block are dashed, marking a thing that is torn off or copied out.
The route indicator uses two `10px` dots joined by a `3px` track — the one place
geometry is drawn rather than composed.

**The unauthenticated ground.** The two surfaces that exist without a session — the
auth overlay and the public link page — replace the flat ground with a barely
perceptible radial wash, `radial-gradient(circle at 30% 20%, var(--card) 0%, var(--muted) 75%)`.
It is the system's only atmospheric effect, and it is confined to the screens that
have no navigation to give them structure.

### Named Rules

**The Radius Ladder Rule.** Every radius in the product is one of 2, 3, 6, 7, 8, 9,
10, 12, 14, 16, or 999, and the tier matters more than the number: marks get 2–3,
controls and inline chips get 6–8, containers get 9–16, pills get 999. A new value
needs a new tier to justify it; otherwise pick the rung that already describes what
is being drawn. The two exceptions — a true circle and a full-bleed zero — are both
"not a rounded box" rather than a twelfth rung.

**The Dashed-Means-Detachable Rule.** A dashed rule marks something that leaves the
page — a copyable link, a tear-off total. Solid everywhere else.

## Components

### Buttons

- **Shape:** consistently rounded (`8px`), never pill, never square.
- **Primary:** Waybill Navy fill with white text, `12px` padding,
  600/14px, full width. Hover swaps to Waybill Navy Hover, active to Press.
  Disabled drops to `opacity: 0.5` with `not-allowed`.
- **Ghost:** transparent with a Rule Grey border and Ink text at 500 weight. The
  quieter peer of a primary, used when both actions are ordinary.
- **Decline:** transparent with an Alert Red Line border and Alert Red text. Used
  for the rider refusing a job — refusing is a normal answer, not a destructive one,
  so it is outlined rather than red-filled. This distinction is load-bearing: reserve
  a red *fill* for genuinely destructive confirmation.
- **Small:** `9px 16px`, 12.5px, auto width.
- **Mini:** the inline button beside an input — Cool Ground fill, Waybill Navy
  label at 600/12px, border moves to navy on hover.
- **Focus (all):** the global ring, below.

### Inputs / Fields

- **Style:** recessed — Cool Ground fill, Rule Grey border, `8px` radius,
  `10px 12px` padding, 14px body text.
- **Label:** above the field, 11.5px uppercase +0.5px muted, `6px` gap.
- **Focus:** border switches to Waybill Navy, native outline removed, and the
  global focus ring takes over.
- **Disabled:** `opacity: 0.6`. Placeholder is Muted Ink.
- **Checkbox chip:** a bordered `8px` chip that swaps its border to navy and its
  text to Ink when checked; the native input keeps `accent-color`.
- **Measure:** a field pair caps at `720px` and a form-only card at `720px`. On
  mobile, inputs go to 16px so iOS Safari does not zoom the page on focus.

### Cards / Containers

- **Corner:** `12px`.
- **Background:** Ledger White on the cool ground — separation comes from the
  `1px` Rule Grey border *and* from tone, now that the field behind them is not
  white.
- **Shadow:** none. See Elevation.
- **Padding:** `20px`. Sibling cards stack at `18px`.
- **Heading:** 600/14px +0.2px, `16px` bottom margin, with an optional navy ordinal
  (`.n`, 12px) and a right-aligned muted note (`.tag-note`, 11.5px/400).
- **Cards do not nest.** A card contains recessed tiles and boxes; it never contains
  another card. A card that is nothing but fields takes `.narrow` (`720px`).

### Navigation

The section nav has two forms, and the same markup produces both. Every item is a
real route link either way, so panes are never hidden — the `somoFade` animation
just softens the change.

Every item carries a **16px Lucide icon** beside its label, `aria-hidden` and
stroked in `currentColor` so it takes the row's own colour with no rule of its own —
muted at rest, navy when selected. The icons are decorative: the label always ships,
and the accessible name is the label alone. One per destination, chosen to be
distinct at 16px rather than literal:

| | | |
|---|---|---|
| Dashboard | `LayoutDashboard` | Riders | `Bike` |
| New delivery | `CirclePlus` | Pricing | `Calculator` |
| Deliveries | `Package` | Users | `Users` |
| Ledger | `Wallet` | Settings | `Settings` |

`CirclePlus` rather than `PackagePlus` because a second parcel differing by a few
pixels from Deliveries' `Package` is not a distinction at this size, and `Calculator`
rather than `Tag` because the page is the fare formula, not a price list — and a tag
would collide with the item categories under Settings.

**Column (over 900px).** The far-left `248px` region of the window, on its own white
surface with a 1px right edge, `16px 14px` of padding and `3px` between items. Each
item is `10px 12px` at 13.5px/500 with an `8px` radius, icon beside the label at an
`11px` gap. Inactive is Muted Ink; hover takes Ink text on Cool Ground; active is
Waybill Navy text at 600 weight on Waybill Navy Soft — a tint the row does not paint
itself, see *The selection travels* below. Sticky under the topbar for
the full height of the window, so it stays where the eye left it on a long log or
ledger. Wider than the 200px card it replaced: at 200px a full-height column reads
as a leftover margin, and eight labels had no room to breathe.

**Strip (900px and under).** The same element becomes a full-width row above the
content, `8px` padding and `4px` gaps, with its rule on the bottom edge instead of
the right. Nothing sticks but the topbar.

In the strip the icon sits **above** the label rather than beside it, at `7px 10px`
padding. Beside it, each tab would grow by the icon plus its gap — about 26px — and
eight of those push a three-row wrap to four. Stacked, the tab stays as wide as its
label, so the row count is exactly what it was before the icons arrived; it is also
the arrangement every phone tab bar already uses. The cost is height per row: 44px
becomes 53px.

The strip **wraps rather than scrolls**, and items grow to fill each row with
`10px` insets and centred labels, so a short last row reads as a deliberate block
rather than a leftover. Wrapping is adaptive, so the row count follows the width:
one row at 768px, two at 414px, three at 375px and below. Every tab is on screen at
every width — which a scrolling strip could not promise, because it clipped five of
eight on a phone, including the active one, with no affordance and a sideways swipe
inside a vertically scrolling page as the only way to find the rest.

**The selection travels.** The tint under the current row is not a background that
row paints for itself. It is one Waybill Navy Soft surface belonging to the nav,
absolutely positioned inside it and moved onto whichever row is current — position,
width and height measured off the row and written onto the surface, so a single
mechanism serves the column's identical rows and the strip's wrapped ones of
differing size. It travels in `0.34s` expo-out, and the row's ink changes on the
same curve, so the navy arrives *with* the tint rather than ahead of it. Two rows
swapping colour at once read as a flicker; one surface moving reads as the nav
answering.

What that mechanism owes in return:

- It is **placed, not travelled**, on first paint, on resize, and on the breakpoint
  change between the two forms. None of those is a selection, and none of them
  should look like one.
- It is **put away** on any route no tab owns, rather than left parked on a row that
  would be claiming you are somewhere you are not.
- The selected row's own background is `transparent`, so the hover grey never paints
  over the tint it is sitting on.
- Every label **reserves its selected width** with a hidden 600-weight `::before`
  ghost. In the column the rows are full-width and it costs nothing; in the strip it
  is what stops one tab's 500→600 step from nudging its neighbours along the row —
  or from moving the wrap point and reflowing a whole row underneath the surface
  while it is mid-travel.
- The surface scrolls with the column, and re-measures whenever a row or the nav
  itself changes size.

None of this reaches the accessibility tree. The surface is `aria-hidden` and so is
the reserved-width ghost; the markup is still a `nav` of links carrying
`aria-current="page"`, because a set of destinations is what it is. A screen reader
is told which page it is on, never which tab is showing.

**Order.** Dashboard, New delivery, Deliveries, Ledger, Riders, Pricing, Users,
Settings. Dashboard leads because it answers "where do things stand"; the next two
carry the day's work; the rest is reference and setup. Role filtering removes items
without reordering them, and two labels narrow per role — a merchant sees "My
ledger", ops sees "Merchants" for Users.

- **Touch:** `44px` minimum height under `(pointer: coarse)`; the stacked icon takes
  each strip row to 53px anyway. The strip's height is the price of never hiding a
  destination, and it is only paid on first view since the strip does not stick.

### The Alert Bell

The signature component of the shell, and the portal's only notification surface.

A **`38px` square button** (`44px` under a coarse pointer) at the right of the
topbar, holding an 18px Lucide `Bell`, `8px` radius, Muted Ink at rest. Hover takes
Ink on Cool Ground; open takes Waybill Navy on Waybill Navy Soft — the same
soft-tint-plus-accent pairing the active nav row and the status badges use, so the
bar says which of its controls is holding the panel.

The **unread count** is a `999px` pill on the button's top-right corner: minimum
`18px` wide, Waybill Navy fill, white ink, 10px/600 in the numeric token, with a
`2px` border in the bar's own white so it reads as sitting on top of the bell rather
than beside it. It caps at `99+`. It is `aria-hidden`, because the button's own
label carries the number in a sentence and a bare "6" read out after it is noise.

The **panel** is a `min(392px, 100vw - 24px)` white overlay at `12px` radius on the
overlay lift, opening `10px` below the button and anchored to its right edge. It
enters with `somoHintIn`. Inside:

- a `12px 14px` header — "Needs attention" as an 11px uppercase micro-label, with the
  outstanding total as a navy-soft pill pushed right;
- a list capped at `min(58vh, 424px)` and scrolling inside itself, one `11px 14px` row
  per alert, hairline-separated: the action at 12.5px/600 Ink, the route beneath it at
  11px muted and truncated, and the row's own action button on the right;
- a footer link on Cool Ground when the payload cap hid some — "and N more waiting".

Rows that were unread when the panel opened carry a **`new` tag** — the role-tag
shape at `2px 7px`, navy on navy-soft. It is a snapshot taken at open time, not live
state: opening the panel is what marks everything seen, so a live marker would flip
to "read" on the same frame the reader's eye reached it.

Below **760px** the panel stops being a popover and becomes a fixed sheet under the
bar, `12px` inset on both sides. Below **640px** each row stacks, giving the route
room to wrap and the button a full-width target.

The **empty state** is a centred `22px` Lucide `Inbox` at 55% muted, a 13px/600 line,
and a sentence of 11.5px muted explaining what will appear here. The bell stays
clickable at zero: a dead button is worse than a panel that says nothing is waiting.

### The Attention Strip

One line where a band of six rows used to be. A full-width `8px`-radius button on
Waybill Navy Soft with a navy hairline and navy text at 12.5px, `10px 14px` of
padding, `14px` below it: a 14px Lucide `BellRing`, the count in a sentence, and an
11px uppercase call to action that drops out under 640px. It is the second control
for the topbar's one disclosure and reports the same `aria-expanded` state.

It exists because the delivery log still wants the cue that something is waiting,
without paying a third of its first screen for the list itself.

### Toasts

A single bottom-centre toast, `8px` radius, `10px 18px`, 13px/600, entering on
opacity plus a `20px` rise. Three fills, and the fill is the only thing that
differs:

- **Confirm** — Manifest Teal. "The thing you just did worked." 2.4s.
- **Alert** — Waybill Navy. News that arrived unprompted, and the longest a reader
  needs to notice something they were not looking at. 3.4s.
- **Error** — Alert Red. A sentence telling you what to fix. 4s.

Two permanent live regions rather than one with a swapped role: assistive tech is
not reliably told about a `role`/`aria-live` change on a node it is already watching,
so each politeness level gets its own region and only the matching one is ever
filled. Confirm and Alert share the polite region — an alert is news, not a failure,
and interrupting a screen reader mid-sentence for "a rider declined" is not
warranted. Only Error is assertive.

### The "?" Hint

A `15px` Lucide `CircleQuestionMark` in a `19px` circular button, sitting beside a
card heading or a field label. Muted at rest; on hover, focus or open it takes
Waybill Navy on Waybill Navy Soft — the same soft-tint-plus-accent pairing the
status badges and the active nav row use. `cursor: help`, because it reveals a note
rather than going anywhere.

The bubble is a `10px` white panel on a `1px` Rule Grey hairline at the overlay
lift, `12px 14px` of padding, `12.5px/1.55` in Muted Ink, capped at
`min(330px, 78vw)`, with a rotated `8px` notch borrowing two of its own borders so
the hairline reads as continuous. It enters with `somoHintIn` — opacity plus a
`4px` rise over `0.16s` expo-out.

It is a **disclosure**, not a `role="tooltip"`: some hints carry a link, and a
tooltip is not somewhere you can travel to. Three ways in — mouse hover (with a
`160ms` grace period so the pointer can reach a link inside), keyboard focus, and
tap. Tap pins it, because `pointerenter` fires on touch too, so the mouse handlers
check `pointerType` and leave touch to the click handler. Escape closes it and
returns focus to the mark. Under `(pointer: coarse)` a `44px` pseudo-element gives
it a real touch target without growing the `19px` circle.

### Spinner

A drawn `14px` arc over a `28%`-opacity track, both in `currentColor`, turning on
the `somoSpin` keyframe at `0.7s`. It sits beside the busy label on a pressed
control — not instead of it — because "Saving…" alone looks identical whether the
server answered a second ago or never answered at all. Under reduced motion it stops
turning and breathes on opacity instead.

### Skeletons

Route-level placeholders under each portal tab's `loading.tsx`, drawn from the same
primitives the real pane uses — `.somo-kpis` tiles, `.somo-card` headings at a
`17px` min-height, field pairs at the `14px` rhythm — so nothing shifts when the
rows arrive. Blocks are flat `oklch(0.925)` and pulse in **tone**, between
`0.925` and `0.962` over `1.5s`; a shimmer sweep would be a third gradient in a
system whose only two encode something. Widths come from fixed cycling arrays
rather than `Math.random()`, which would differ between server and client and read
as a hydration mismatch. The pane carries one `role="status"` with a single
`sr-only` label; every block under it is `aria-hidden`.

### Badges and Tags

- **Status badge:** `999px` pill, `3px 9px`, 11px/600, `white-space: nowrap`.
  Requested is neutral grey, assigned is navy-soft, delivered is teal-soft,
  and the legacy approval state is red-soft.
- **Role tag:** `999px` pill, `2px 7px`, 10px +0.4px uppercase, in the seat's soft/hue
  pair.

### Stat Tile

Shared by the dashboard and the ledger so the same kind of figure never looks like
two unrelated numbers. A recessed `10px` tile holding three stacked lines: an 11px
uppercase muted label, a 19px/600 figure, and an optional 11px/1.45 muted sub-line.
Six tones (`due` navy, `owed` outbound-ochre, `good` teal, `bad` alert-red,
`flight` muted, `info` inherit) colour **only the figure** — state is carried by the
labelled value, not by a decorative edge, and never by colour alone.

### Route Indicator

Two `10px` dots — navy for origin, teal for destination — joined by a `3px` Rule Grey
track that fills with a `navy → teal` gradient as the distance resolves, scaled in
on the X axis over `0.25s` expo-out. This is the only gradient in the system besides
the session-less wash, and it encodes direction of travel.

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
  fill at `0.25s`, the toast at `0.2s`, the nav's selection at `0.34s`.
- **Nav selection travel:** `transform`, `width` and `height` at `0.34s` expo-out on
  the surface the nav shares between its rows, with the row's `color` on the same
  curve so the ink and the tint arrive together. Roughly half the distance is covered
  in the first `34ms`, and the rest is the settle. The portal's longest *transition*
  — past the route fill's `0.25s` and the toast's `0.2s` — because it is the only one
  that crosses a region instead of happening inside a single control.
- **Opacity:** `0.2s ease`.
- **Hint and bell panel enter:** `somoHintIn`, `0.16s` expo-out — opacity 0→1 with a
  `4px` rise.
- **Unread badge enter:** `somoBadgeIn`, `0.28s` expo-out — opacity plus a scale from
  `0.5`.
- **Bell ring:** `somoBellPing`, `0.7s` expo-out, `forwards` — a `2px` navy ring at
  `inset: -2px` expanding from `0.88` to `1.2` and fading out. Fired **once** when a
  new alert arrives.
- **Spinner:** `somoSpin`, `0.7s` linear on the spinner, `0.9s` on the toolbar's
  refresh icon.
- **Skeleton:** `somoSkeletonPulse`, `1.5s ease-in-out`, background tone only.
- **Hover transitions:** `0.15s ease` on the bell's and the attention strip's colour
  and background.
- **Reduced motion:** `prefers-reduced-motion: reduce` removes the pane animation
  and the route transition outright, and collapses the toast to `opacity 0.1s linear`
  with no transform. It cuts the nav selection to the same `0.1s` opacity change and
  drops the row's colour transition: the tint still lands on the row you chose, it
  just stops crossing the column to get there — a tinted block travelling that far is
  exactly the large-area movement this setting is asking us not to make, and the nav
  says the same thing without it. It drops the hint's and the bell panel's entrance,
  the badge's scale-in, and the skeleton's pulse, removes the bell's ring entirely,
  and swaps the spinner's rotation for an opacity breath — the indicator still has to
  say "in flight". Any new motion must have an entry here.

### Named Rules

**The Selected-Surface Rule.** A selected or open control is a tinted surface — the
same soft-tint-plus-accent pairing the status badges and ledger holder cells use.
This covers the nav item in both forms, the open bell, and the "?" mark. It used to
be a `2px` underline in strip form; once the strip became a bordered surface that
underline sat on its bottom edge and read as a flaw in the border, so there is no
underline anywhere now.

Where a set of these surfaces is mutually exclusive, there is **one surface, and it
moves**. The nav owns a single tint shared by every row rather than a background per
row, because the rows are one choice and should look like one object answering it.
The bell and the "?" mark keep their own, having no siblings to travel between. A
new exclusive set — a segmented control, a sub-nav — takes the shared surface; a
standalone open/closed control does not.

**The One-Ring Rule.** An arrival announces itself once. The bell's ring is a
single `forwards` animation, not a loop, and the toast auto-dismisses; the standing
signal is the count, which sits there silently until somebody looks. A badge that
keeps pulsing is a badge people learn to stop seeing.

**The Looking-Is-Reading Rule.** Opening the alerts panel is the read event. There
is no "mark all as read" control, because there is nothing one would add. The alerts
themselves are derived from delivery status and are never dismissed — a row leaves
the list the moment whoever it was waiting on acts, so the state *is* the alert.
"Unread" is a strictly separate and strictly local question, kept in `localStorage`,
about whether this browser has looked yet.

## Do's and Don'ts

### Do:

- **Do** extend the `.somo-*` layer in `app/globals.css`. That hand-written layer *is*
  the design system; the shadcn install underneath it supplies neutral tokens only.
- **Do** reach for `#26336D` whenever the answer is "the accent". There is no
  size-dependent or fill-only variant to choose between any more.
- **Do** verify any new colour against the surface it actually sits on and record the
  ratio in a comment, the way the existing palette does.
- **Do** pair every colour cue with words that say the same thing.
- **Do** offset anything pinned under the topbar by `var(--somo-topbar)`, and give
  anything an in-page anchor can target a matching `scroll-margin-top`.
- **Do** give a new container a measure when its content is a form. The pane's
  `1600px` is a ceiling for tables, not a target for fields.
- **Do** keep new radii on the ladder (2/3/6/7/8/9/10/12/14/16/999), matching the tier
  to what is being drawn.
- **Do** keep `44px` minimum control heights under `(pointer: coarse)`, and remember
  that the topbar grows to `70px` there to hold them.
- **Do** add a `prefers-reduced-motion` case for any new animation or transition.
- **Do** vendor any new typeface as a local `.woff2` under `app/fonts/`.
- **Do** put a card's standing explanation behind the `"?"` hint rather than in a
  paragraph under its heading. The words are worth keeping; the daily cost of
  scrolling past them is not.
- **Do** give a control that fires a request both a busy label and the spinner.
- **Do** put a new size in `typography.scale` with a reason, or use a step that is
  already there.
- **Do** re-assert a `.somo-hint-bubble` typographic property at `#somo-root`
  weight. `.somo-card h3` and `label.somo-field span` are `.class element` rules,
  which outrank a bare class — a class-only reset silently loses.

### Don't:

- **Don't** add shadcn components. The scaffolded `components/ui/` has been deleted;
  reintroducing it would give the portal two button languages at once. The shadcn
  install underneath `globals.css` supplies neutral tokens only.
- **Don't** design, verify, or screenshot against `.dark`. The dark token block in
  `globals.css` is inherited shadcn scaffolding that nothing applies — the portal is
  light-only on purpose and every documented ratio is against white.
- **Don't** put the shell back in a frame, or give the topbar or the nav column a
  radius, a shadow, or a gap. They are edges of the window; a hairline is how they
  separate from the work.
- **Don't** hard-code the topbar's height a second time. One typed copy plus
  `var(--somo-topbar)` is a 1px seam waiting for the first change to the bar.
- **Don't** let a form field take the pane's full width. Cap the container.
- **Don't** hover a dark fill with `filter: brightness()`. On `#26336D` a 1.06 filter
  is a 1.05:1 step — no hover at all. Swap `background` to `#304088` instead, and
  deepen the tint on anything already tinted.
- **Don't** draw an in/out or due/owed pair in two cool hues. `--brand-ops` is 2.7°
  from the navy; money out is Outbound Ochre for that reason.
- **Don't** put a notification count, badge, or alert surface in red. Red means
  something went wrong; an alert is work waiting. Navy.
- **Don't** loop an attention animation. One ring, `forwards`, and then the count
  carries it.
- **Don't** add a "mark all as read" control. Opening the panel is the read event,
  and the alerts themselves cannot be dismissed because they are derived from status.
- **Don't** reintroduce `--brand-amber`, `--amber`, or a size-dependent accent variant.
  The accent is one navy and the aliases (`--accent`, `--accent-fill`, `--accent-dim`)
  all resolve to it.
- **Don't** set a link colour inside the portal with a class alone. `#somo-root a
  { color: inherit }` beats any single class on ID specificity, so a `.somo-*` rule
  colouring an `<a>` is silently ignored — it had killed the whole nav's muted/active
  colour hierarchy until it was re-asserted as `#somo-root .somo-tab`, and the bell
  panel's footer link is written the same way. Match the specificity.
- **Don't** put a touch-target override earlier in the stylesheet than the rule it is
  overriding. The shared `(pointer: coarse)` block sits above the bell's own
  declaration, so the bell carries its own coarse block instead — same specificity
  means the later rule wins.
- **Don't** override `font-variant-numeric: tabular-nums`.
- **Don't** point `--font-mono` at a real monospace face, or add a second typeface.
  Never load a font from a CDN — the build cannot reach `fonts.gstatic.com` and will
  fail, in Docker too.
- **Don't** shimmer a skeleton. Placeholders pulse in tone; a sweeping highlight is
  a gradient, and this system's two both encode something.
- **Don't** use a unicode glyph as an icon. Icons come from Lucide, at the stroke
  and size of the nav's marks — the `✕`, `+`, `↻` and `⤡/⤢` characters that used
  to stand in for them are gone.
- **Don't** add a gradient. This system has exactly two, and both are structural:
  the route line's `navy → teal` fill encodes direction of travel, and the radial
  wash grounds the two session-less screens. A third gradient is decoration.
- **Don't** put a shadow on anything at rest.
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
