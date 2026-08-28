'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

/**
 * Tabs are real routes now, so each pane is bookmarkable and the browser's back
 * button works. Hiding a tab is presentation only — the page for it re-checks
 * the role server-side, as does every Route Handler behind it.
 */
export function PortalTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="somo-tabs" aria-label="Portal sections">
      {TABS.filter((t) => t.roles.includes(role)).map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`somo-tab${pathname === tab.href ? ' active' : ''}`}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          <tab.icon className="somo-tab-icon" aria-hidden="true" size={16} />
          <span>{tab.labelByRole?.[role] ?? tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
