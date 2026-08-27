import { describe, expect, it } from 'vitest';
import { calcPrice } from '@/lib/pricing';
import type { PricingParams } from '@/lib/types';

function params(patch: Partial<PricingParams> = {}): PricingParams {
  return {
    base: 10,
    rate: 6,
    perMin: 0,
    minFare: 25,
    bookingFee: 0,
    platformFee: 0,
    opsPhone: '0200000000',
    surcharges: [{ id: 'rush', label: 'Same-day rush', amount: 15 }],
    ...patch,
  };
}

describe('calcPrice fees', () => {
  /**
   * The point of making the fees flat: they are charged in full on a run short
   * enough that the minimum fare is doing the work, rather than disappearing
   * into the floor on exactly the deliveries where they are most of the price.
   */
  it('adds both fees on top of the minimum fare rather than inside it', () => {
    const short = params({ bookingFee: 3, platformFee: 2 });

    // 10 + 6x1 = 16, under the 25 minimum, so the fare is the floor.
    expect(calcPrice(short, 1).price).toBe(30);
    // And the same two fees on a run that clears the floor: 10 + 6x10 = 70.
    expect(calcPrice(short, 10).price).toBe(75);
  });

  it('charges the fees alongside surge charges and time', () => {
    const p = params({ perMin: 0.5, bookingFee: 3, platformFee: 2.5 });

    // max(25, 10 + 6x4 + 0.5x20) = 44, + 15 rush + 5.5 fees.
    expect(calcPrice(p, 4, 20, ['rush']).price).toBe(64.5);
  });

  it('leaves the price unchanged when both fees are zero', () => {
    expect(calcPrice(params(), 10).price).toBe(70);
  });

  /**
   * A portal deployed ahead of the fees migration reads a row with no
   * booking_fee or platform_fee. Every quote it makes has to survive that, not
   * come out as NaN.
   */
  it('quotes without the fees when the columns are not there yet', () => {
    const legacy = params();
    delete (legacy as Partial<PricingParams>).bookingFee;
    delete (legacy as Partial<PricingParams>).platformFee;

    expect(calcPrice(legacy, 10).price).toBe(70);
  });

  it('rounds the total to the pesewa', () => {
    const p = params({ base: 0, rate: 0, minFare: 0, bookingFee: 0.005, platformFee: 0.005 });

    expect(calcPrice(p, 0).price).toBe(0.01);
  });
});
