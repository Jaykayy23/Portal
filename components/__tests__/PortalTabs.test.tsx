import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PortalTabs } from '@/components/PortalTabs';

vi.mock('next/navigation', () => ({
  usePathname: () => '/portal/log',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

describe('PortalTabs', () => {
  it('names the navigation and exposes the current route', () => {
    render(<PortalTabs role="merchant" />);

    expect(screen.getByRole('navigation', { name: 'Portal sections' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Deliveries' }).getAttribute('aria-current')).toBe(
      'page'
    );
    expect(screen.getByRole('link', { name: 'New delivery' }).hasAttribute('aria-current')).toBe(
      false
    );
  });
});
