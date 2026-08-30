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

  // The selection is drawn by a travelling surface and each label reserves its
  // own selected width with a `::before` ghost. Both are pure decoration, and
  // both would be read aloud if they ever stopped being hidden — the ghost would
  // say every label twice. `aria-current` is the only thing telling a screen
  // reader where it is, so nothing else may speak.
  it('keeps the selection surface and the reserved label width out of the accessibility tree', () => {
    const { container } = render(<PortalTabs role="merchant" />);

    const surface = container.querySelector('.somo-tab-indicator');
    expect(surface).toBeTruthy();
    expect(surface?.getAttribute('aria-hidden')).toBe('true');

    // One accessible name per link, not the label plus its own ghost.
    expect(screen.getAllByRole('link', { name: 'Deliveries' })).toHaveLength(1);
    // The ghost renders from `data-label`, so it has to carry the same text the
    // row shows — a merchant's Ledger is relabelled, and a stale ghost would
    // reserve the wrong width.
    expect(
      screen.getByRole('link', { name: 'My ledger' }).querySelector('.somo-tab-label')
    ).toHaveProperty('dataset.label', 'My ledger');
  });
});
