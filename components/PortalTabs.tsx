'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';

interface Tab {
  href: string;
  label: string;
  roles: Role[];
}

const TABS: Tab[] = [
  { href: '/portal/new', label: 'New delivery', roles: ['admin', 'ops', 'merchant'] },
  { href: '/portal/log', label: 'My deliveries', roles: ['admin', 'ops', 'merchant'] },
  { href: '/portal/riders', label: 'Riders', roles: ['admin', 'ops'] },
  { href: '/portal/pricing', label: 'Pricing settings', roles: ['admin'] },
  { href: '/portal/accounts', label: 'Accounts', roles: ['admin'] },
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
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
