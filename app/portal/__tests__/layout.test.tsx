import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PortalLayout from '@/app/portal/layout';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/config', () => ({ missingEnv: () => [] }));
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => ({
    id: 'user-1',
    username: 'audit.finance',
    companyName: 'SomoExpress Finance',
    role: 'finance',
    active: true,
  }),
}));
vi.mock('@/lib/settings', () => ({
  getLogoDataUrl: async () => '',
  getMapsApiKeyForSignedInUser: async () => '',
}));
vi.mock('@/components/BrandMark', () => ({ BrandMark: () => <span>SX</span> }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => <button>Log out</button> }));
vi.mock('@/components/PortalTabs', () => ({ PortalTabs: () => <nav>Sections</nav> }));
vi.mock('@/components/MapsProvider', () => ({
  MapsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('PortalLayout landmarks', () => {
  it('provides a skip target and one primary content landmark', async () => {
    render(await PortalLayout({ children: <h1>Ledger</h1> }));

    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main-content'
    );
    expect(screen.getByRole('main').id).toBe('main-content');
  });
});
