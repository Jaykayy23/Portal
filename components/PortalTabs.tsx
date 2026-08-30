'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Bike,
  Calculator,
  CirclePlus,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import type { Role } from '@/lib/types';

interface Tab {
  href: string;
  label: string;
  roles: Role[];
  /**
   * Decorative only — every item keeps its label, and the icon is
   * `aria-hidden`. It is there to make a known destination findable at a glance,
   * not to name it.
   */
  icon: LucideIcon;
  /** Override where the same route means something narrower to one role. */
  labelByRole?: Partial<Record<Role, string>>;
}

/**
 * Nav order, top to bottom.
 *
 * Dashboard first because it is the "where do things stand" screen somebody opens
 * the portal to see, then the two that carry the day's work — filing a request and
 * working the queue. Everything after that is reference or setup, in the order it
 * is reached for.
 */
const TABS: Tab[] = [
  {
    href: '/portal/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'ops', 'merchant', 'finance'],
  },
  // A plain plus rather than a second parcel: `PackagePlus` beside `Package` is
  // two boxes differing by a few pixels at 16px, and "create" is the one action
  // every interface already draws this way.
  { href: '/portal/new', label: 'New delivery', icon: CirclePlus, roles: ['admin', 'ops', 'merchant'] },
  { href: '/portal/log', label: 'Deliveries', icon: Package, roles: ['admin', 'ops', 'merchant'] },
  {
    href: '/portal/ledger',
    label: 'Ledger',
    // A wallet, not a book: the page answers "whose pocket is this cedi in", and
    // that reads faster than the ledger metaphor does at this size.
    icon: Wallet,
    roles: ['admin', 'ops', 'merchant', 'finance'],
    // A merchant's ledger is their own company's and nobody else's, and saying so
    // on the tab saves them wondering what they are about to see.
    labelByRole: { merchant: 'My ledger' },
  },
  { href: '/portal/riders', label: 'Riders', icon: Bike, roles: ['admin', 'ops'] },
  // The page is the fare formula, not a price list, so a calculator rather than a
  // tag — which would also collide with the item categories under Settings.
  { href: '/portal/pricing', label: 'Pricing', icon: Calculator, roles: ['admin'] },
  {
    href: '/portal/accounts',
    label: 'Users',
    icon: Users,
    roles: ['admin', 'ops'],
    // Ops only ever sees merchants there, so naming it 'Users' would promise more
    // than the pane delivers.
    labelByRole: { ops: 'Merchants' },
  },
  { href: '/portal/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
  // Last, and admin's alone. It is the tab you reach for after something has
  // already happened — never part of the day's work — and putting it under
  // Settings is what says so without a heading.
  //
  // A clock with a turned-back arrow rather than a scroll or a list: the page
  // answers "what happened, and when", and every other list-shaped icon in this
  // nav is already spoken for by a thing you can act on.
  { href: '/portal/activity', label: 'Activity', icon: History, roles: ['admin'] },
];

// The layout effect parks the travelling surface before the frame is painted, so
// it is never briefly drawn against the wrong row. There is no layout to read on
// the server and React warns about the hook there, so it degrades to the passive
// one — which on the server is a no-op anyway.
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Tabs are real routes now, so each pane is bookmarkable and the browser's back
 * button works. Hiding a tab is presentation only — the page for it re-checks
 * the role server-side, as does every Route Handler behind it.
 *
 * The selection is drawn by one tinted surface belonging to the nav rather than
 * by a background each row paints for itself, and it travels to whichever row is
 * current. Two rows changing colour at once reads as a flicker; one surface
 * moving reads as the nav answering. None of the markup changes for it: this is
 * still a `nav` of links carrying `aria-current`, because that is what a set of
 * destinations is. A screen reader is told which page it is on, not which tab
 * panel is showing.
 */
export function PortalTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLSpanElement>(null);
  // Whether the surface is already parked on a row. False means the next
  // measurement places it outright instead of travelling — a first paint, a
  // resize, or a return from a route no tab owns. None of those is a selection,
  // and none of them should look like one.
  const parkedRef = useRef(false);

  const place = useCallback((travel: boolean) => {
    const nav = navRef.current;
    const surface = surfaceRef.current;
    if (!nav || !surface) return;

    const row = nav.querySelector<HTMLElement>('.somo-tab.active');
    // A route no tab owns. The surface is put away rather than left parked on a
    // row that is no longer current and would be saying you are somewhere else.
    if (!row) {
      nav.dataset.parked = 'false';
      parkedRef.current = false;
      return;
    }

    const jump = !travel || !parkedRef.current;
    if (jump) nav.dataset.travel = 'off';

    const navBox = nav.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    // Measured against the nav's padding box, which is what an absolutely
    // positioned child is placed against — hence `clientLeft`/`clientTop` for the
    // nav's own border — and offset by its scroll, so a column scrolled down to
    // Activity still measures true.
    const x = rowBox.left - navBox.left - nav.clientLeft + nav.scrollLeft;
    const y = rowBox.top - navBox.top - nav.clientTop + nav.scrollTop;

    // Written onto the element rather than handed to the stylesheet as four
    // custom properties for it to reassemble. This geometry is measured, not
    // authored, so it belongs with the code that measures it — and setting
    // `transform` directly keeps the travel on the compositor and out of a
    // `var()` indirection inside a transitioning property, which browsers have
    // been uneven about. The stylesheet keeps what is actually design: the tint,
    // the radius, and how long the trip takes.
    surface.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    surface.style.width = `${rowBox.width}px`;
    surface.style.height = `${rowBox.height}px`;

    if (jump) {
      // Force the untransitioned position to be committed before travel goes back
      // on, or the browser folds both writes into one frame and animates the jump
      // we just asked it not to.
      void nav.offsetWidth;
      nav.dataset.travel = 'on';
    }

    nav.dataset.parked = 'true';
    parkedRef.current = true;
  }, []);

  useMeasureEffect(() => {
    place(true);
  }, [place, pathname, role]);

  useEffect(() => {
    const nav = navRef.current;
    // jsdom has no ResizeObserver, and a nav that cannot re-measure is still a
    // working nav — the surface is placed on every route change regardless.
    if (!nav || typeof ResizeObserver === 'undefined') return;

    // Below 900px the column becomes a wrapping strip whose rows change width and
    // wrap point with the window, so the surface is re-measured rather than
    // assumed. Every row is observed, not only the nav: in the sidebar the column
    // is a fixed window height, so a row growing taller never changes the box
    // around it. Dragging a window edge is not a selection, so these re-park
    // without travelling.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    for (const row of nav.querySelectorAll<HTMLElement>('.somo-tab')) observer.observe(row);
    return () => observer.disconnect();
  }, [place, role]);

  return (
    <nav className="somo-tabs" aria-label="Portal sections" ref={navRef} data-travel="on">
      <span className="somo-tab-indicator" aria-hidden="true" ref={surfaceRef} />
      {TABS.filter((t) => t.roles.includes(role)).map((tab) => {
        const label = tab.labelByRole?.[role] ?? tab.label;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`somo-tab${pathname === tab.href ? ' active' : ''}`}
            aria-current={pathname === tab.href ? 'page' : undefined}
          >
            <tab.icon className="somo-tab-icon" aria-hidden="true" size={16} />
            {/* The label reserves its own selected width — see `.somo-tab-label`
                in globals.css — so becoming current never re-flows the strip. */}
            <span className="somo-tab-label" data-label={label}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
