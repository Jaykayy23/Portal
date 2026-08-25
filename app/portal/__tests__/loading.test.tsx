import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AccountsLoading from '@/app/portal/accounts/loading';
import DashboardLoading from '@/app/portal/dashboard/loading';
import LedgerLoading from '@/app/portal/ledger/loading';
import DeliveryLogLoading from '@/app/portal/log/loading';
import NewDeliveryLoading from '@/app/portal/new/loading';
import PricingLoading from '@/app/portal/pricing/loading';
import RidersLoading from '@/app/portal/riders/loading';
import SettingsLoading from '@/app/portal/settings/loading';

/**
 * Every portal tab has a route-level skeleton, and none of them is reachable
 * without a session — so this is what proves they render at all.
 *
 * The assertions are about the two things a skeleton has to get right: it says
 * out loud that something is loading, and it draws placeholder geometry rather
 * than an empty pane.
 */
const PANES = [
  ['dashboard', DashboardLoading, 'Loading the delivery dashboard'],
  ['log', DeliveryLogLoading, 'Loading the delivery log'],
  ['ledger', LedgerLoading, 'Loading the ledger'],
  ['new', NewDeliveryLoading, 'Loading the new delivery form'],
  ['riders', RidersLoading, 'Loading the rider roster'],
  ['pricing', PricingLoading, 'Loading the pricing rules'],
  ['accounts', AccountsLoading, 'Loading accounts'],
  ['settings', SettingsLoading, 'Loading portal settings'],
] as const;

describe('portal route skeletons', () => {
  it.each(PANES)('%s announces the wait and draws placeholders', (_slug, Pane, label) => {
    const { container, unmount } = render(<Pane />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain(label);

    // The blocks themselves are decorative; a screen reader should hear the one
    // label above and nothing else.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.somo-skeleton').length).toBeGreaterThan(5);

    unmount();
  });
});
