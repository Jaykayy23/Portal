import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CrmDashboard } from '@/components/dashboard/CrmDashboard';
import type { DeliveryWithMerchant } from '@/lib/types';

const apiDownload = vi.fn();

vi.mock('@/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiDownload: (path: string, fallback: string) => apiDownload(path, fallback),
  errMessage: (e: unknown) => String(e),
}));

/**
 * The dashboard's export buttons, and specifically the query string they send.
 *
 * That string is the whole promise of the feature: the server re-reads the rows
 * through the caller's session, so what makes the file describe *this* screen
 * rather than the whole business is the period and merchant travelling with the
 * request. A silently wrong parameter here hands somebody a plausible file of
 * the wrong figures, which is worse than an error.
 */

function delivery(over: Partial<DeliveryWithMerchant> = {}): DeliveryWithMerchant {
  return {
    id: 'a1',
    // Today, so it lands inside every period the picker offers.
    date: new Date().toISOString(),
    customer: 'Kofi Stores',
    recipientName: 'Ama Boateng',
    recipientPhone: '0201234567',
    merchantId: 'm1',
    submittedBy: 'u1',
    pickup: 'Osu',
    dropoff: 'Labone',
    distance: 4.5,
    durationMin: 18,
    type: 'On demand',
    itemCategory: 'Food',
    surcharges: [],
    declaredValue: 120,
    itemPayment: 'Cash on delivery',
    deliveryPaidBy: 'Merchant',
    price: 25,
    status: 'Delivered',
    riderId: 'r1',
    riderName: 'Yaw Mensah',
    riderPhone: '0209876543',
    riderReg: 'GR 1234-24',
    riderModel: 'Boxer',
    acceptedAt: '',
    declinedAt: '',
    pickedUpAt: '',
    recipientConfirmedAt: '',
    deliveredAt: new Date().toISOString(),
    ...over,
  };
}

const MERCHANTS = [
  { id: 'm1', name: 'Kofi Stores', active: true },
  { id: 'm2', name: 'Adjoa Fabrics', active: true },
];

function renderDashboard(records: DeliveryWithMerchant[], seesAll = true) {
  return render(
    <CrmDashboard
      records={records}
      merchants={seesAll ? MERCHANTS : []}
      seesAll={seesAll}
      viewerCompany="Kofi Stores"
    />
  );
}

describe('CrmDashboard export', () => {
  it('offers both formats and asks for the one that was pressed', async () => {
    renderDashboard([delivery()]);

    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect(apiDownload).toHaveBeenLastCalledWith(
      '/dashboard/export?range=30d&format=xlsx',
      'somoexpress-dashboard.xlsx'
    );

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(apiDownload).toHaveBeenLastCalledWith(
      '/dashboard/export?range=30d&format=csv',
      'somoexpress-dashboard.csv'
    );
  });

  it('sends the period the screen is showing, not the default', async () => {
    renderDashboard([delivery()]);

    await userEvent.selectOptions(screen.getByLabelText('Period'), '7d');
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));

    expect(apiDownload).toHaveBeenLastCalledWith(
      '/dashboard/export?range=7d&format=xlsx',
      expect.any(String)
    );
  });

  it('sends the selected merchant, and omits the parameter when none is picked', async () => {
    renderDashboard([delivery()]);

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    // No merchant chosen: the parameter is absent rather than empty, so the
    // route's `?? ''` default is what decides the scope.
    expect(apiDownload).toHaveBeenLastCalledWith(
      expect.not.stringContaining('merchant='),
      expect.any(String)
    );

    await userEvent.selectOptions(screen.getByLabelText('Merchant'), 'm1');
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));

    expect(apiDownload).toHaveBeenLastCalledWith(
      '/dashboard/export?range=30d&format=csv&merchant=m1',
      expect.any(String)
    );
  });

  it('offers no export when the period holds nothing to export', () => {
    // A delivery well outside the default 30 days: the screen shows its empty
    // state, and a file of zeroes would only be puzzling.
    renderDashboard([delivery({ date: '2020-01-01T09:00:00.000Z' })]);

    expect(screen.getByText('Nothing in this period')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Excel/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /CSV/ })).toHaveProperty('disabled', true);
  });

  it('shows a merchant their own export without a merchant picker to scope it', () => {
    renderDashboard([delivery()], false);

    expect(screen.queryByLabelText('Merchant')).toBeNull();
    expect(screen.getByRole('button', { name: /Excel/ })).toBeTruthy();
  });
});
