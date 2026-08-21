'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';

interface Tab {
  href: string;
  label: string;
  roles: Role[];
  /** Override where the same route means something narrower to one role. */
  labelByRole?: Partial<Record<Role, string>>;
}

const TABS: Tab[] = [
  { href: '/portal/new', label: 'New delivery', roles: ['admin', 'ops', 'merchant'] },
  { href: '/portal/log', label: 'My deliveries', roles: ['admin', 'ops', 'merchant'] },
  {
    href: '/portal/ledger',
    label: 'Ledger',
    roles: ['admin', 'ops', 'merchant', 'finance'],
    // A merchant's ledger is their own company's and nobody else's, and saying so
    // on the tab saves them wondering what they are about to see.
    labelByRole: { merchant: 'My ledger' },
  },
  { href: '/portal/dashboard', label: 'Dashboard', roles: ['admin', 'ops', 'merchant', 'finance'] },
  { href: '/portal/riders', label: 'Riders', roles: ['admin', 'ops'] },
  { href: '/portal/pricing', label: 'Pricing settings', roles: ['admin'] },
  {
    href: '/portal/accounts',
    label: 'Accounts',
    roles: ['admin', 'ops'],
    // Ops only ever sees merchants there, so naming it 'Accounts' would promise
    // more than the pane delivers.
    labelByRole: { ops: 'Merchants' },
  },
  { href: '/portal/settings', label: 'Settings', roles: ['admin'] },
];

/**
 * Tabs are real routes now, so each pane is bookmarkable and the browser's back
 * button works. Hiding a tab is presentation only — the page for it re-checks
 * the role server-side, as does every Route Handler behind it.
 */
export function PortalTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="somo-tabs">
      {TABS.filter((t) => t.roles.includes(role)).map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`somo-tab${pathname === tab.href ? ' active' : ''}`}
        >
          {tab.labelByRole?.[role] ?? tab.label}
        </Link>
      ))}
    </nav>
  );
}
