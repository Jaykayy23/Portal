import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PricingForm } from '@/components/pricing/PricingForm';
import type { PricingParams } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  errMessage: (e: unknown) => String(e),
}));

function params(patch: Partial<PricingParams> = {}): PricingParams {
  return {
    base: 10,
    rate: 6,
    perMin: 0,
    minFare: 25,
    bookingFee: 3,
    platformFee: 2,
    opsPhone: '0200000000',
    surcharges: [],
    ...patch,
  };
}

/** The readout is the row labelled "Smallest possible quote"; this is its value. */
function smallestQuote(): string {
  const label = screen.getByText(/^Smallest possible quote/);
  return label.parentElement?.querySelector('.v')?.textContent ?? '';
}

describe('PricingForm smallest possible quote', () => {
  /**
   * The point of the readout: "Minimum fare: 25" reads like the floor on what a
   * merchant pays, and it is not — the two fees are charged outside it.
   */
  it('adds the fees to the minimum fare rather than showing the minimum fare alone', () => {
    render(<PricingForm params={params()} />);

    expect(smallestQuote()).toBe('GHS 30.00');
    expect(screen.getByText('25.00 + 3.00 + 2.00')).toBeTruthy();
  });

  it('falls back to the minimum fare when neither fee is charged', () => {
    render(<PricingForm params={params({ bookingFee: 0, platformFee: 0 })} />);

    expect(smallestQuote()).toBe('GHS 25.00');
  });

  /**
   * Three boxes across three separate forms feed this figure, so it will often be
   * showing the consequence of an edit that has not been saved. It has to say so
   * rather than pass a typed number off as what the portal is charging.
   */
  it('marks the figure unsaved while a fee box differs from what is stored', async () => {
    const user = userEvent.setup();
    render(<PricingForm params={params()} />);

    expect(screen.queryByText(/Smallest possible quote \(unsaved\)/)).toBeNull();

    const booking = screen.getByLabelText('Booking fee (GHS)');
    await user.clear(booking);
    await user.type(booking, '8');

    expect(smallestQuote()).toBe('GHS 35.00');
    expect(screen.getByText('Smallest possible quote (unsaved)')).toBeTruthy();
  });

  it('tracks the minimum fare box as well as the fee boxes', async () => {
    const user = userEvent.setup();
    render(<PricingForm params={params()} />);

    const minFare = screen.getByLabelText('Minimum fare (GHS)');
    await user.clear(minFare);
    await user.type(minFare, '40');

    expect(smallestQuote()).toBe('GHS 45.00');
  });

  /**
   * The readout claims to be a quote, so it is rounded like one. The breakdown
   * underneath keeps its pesewas — that is what shows where the rounding went,
   * rather than leaving three boxes that visibly do not add up to the figure.
   */
  it('rounds the readout to the cedi while the breakdown keeps its pesewas', () => {
    render(<PricingForm params={params({ minFare: 25.2, bookingFee: 3.1, platformFee: 2.05 })} />);

    expect(smallestQuote()).toBe('GHS 30.00');
    expect(screen.getByText('25.20 + 3.10 + 2.05')).toBeTruthy();
  });

  /**
   * The trap in rounding the readout: an edit worth less than half a cedi leaves
   * the figure identical, and reading the rounded number to decide would tell the
   * admin their unsaved change was stored.
   */
  it('still marks the figure unsaved when a pesewa edit rounds to the same cedi', async () => {
    const user = userEvent.setup();
    render(<PricingForm params={params({ minFare: 25, bookingFee: 3, platformFee: 2 })} />);

    const booking = screen.getByLabelText('Booking fee (GHS)');
    await user.clear(booking);
    await user.type(booking, '3.2');

    expect(smallestQuote()).toBe('GHS 30.00');
    expect(screen.getByText('Smallest possible quote (unsaved)')).toBeTruthy();
  });
});
