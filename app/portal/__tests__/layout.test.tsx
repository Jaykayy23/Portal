import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PortalLayout from '@/app/portal/layout';

let role: 'finance' | 'ops' = 'finance';

// The layout now renders the portal-wide refresh poll and the alert bell, both of
// which are client components reaching for the router.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/portal/ledger',
}));
vi.mock('@/lib/config', () => ({ missingEnv: () => [] }));
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => ({
    id: 'user-1',
    username: 'audit.finance',
    companyName: 'SomoExpress Finance',
    role,
    active: true,
  }),
}));
vi.mock('@/lib/portalPulse', () => ({ readPortalPulse: async () => 'r1' }));
vi.mock('@/lib/settings', () => ({
  getLogoDataUrl: async () => '',
  getMapsApiKeyForSignedInUser: async () => '',
  getPricingParams: async () => ({ opsPhone: '0200000000' }),
}));
// Finance is the seat this test signs in as, and a read-only seat has no alerts —
// so neither of these is actually called. They are mocked because importing the
// real modules would pull in the Supabase server client.
vi.mock('@/lib/deliveries', () => ({
  listDeliveriesFor: async () => {
    throw new Error('The portal layout must not load general delivery history for alerts.');
  },
  listAlertDeliveriesFor: async () => [],
}));
vi.mock('@/components/BrandMark', () => ({ BrandMark: () => <span>SX</span> }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => <button>Log out</button> }));
vi.mock('@/components/PortalTabs', () => ({ PortalTabs: () => <nav>Sections</nav> }));
vi.mock('@/components/MapsProvider', () => ({
  MapsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('PortalLayout landmarks', () => {
  it('provides a skip target and one primary content landmark', async () => {
    role = 'finance';
    render(await PortalLayout({ children: <h1>Ledger</h1> }));

    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main-content'
    );
    expect(screen.getByRole('main').id).toBe('main-content');
  });

  it('renders an alert-bearing seat without loading the general delivery history', async () => {
    role = 'ops';

    render(await PortalLayout({ children: <h1>Operations</h1> }));

    expect(screen.getByRole('main').textContent).toContain('Operations');
  });
});
