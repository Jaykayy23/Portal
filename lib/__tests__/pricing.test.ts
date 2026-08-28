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

    // max(25, 10 + 6x4 + 0.5x20) = 44, + 15 rush + 5.5 fees = 64.5, rounded up.
    expect(calcPrice(p, 4, 20, ['rush']).price).toBe(65);
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

});

/**
 * A fee is counted out in cash at a gate and remitted by a rider at the end of a
 * shift, so it is a whole number of cedis however the fare table is set. The
 * rounding lands on the total, once — rounding the parts first would let the
 * pesewas in the base fare, the rate and each surge charge each pull the answer
 * a little, and the figure would stop matching what anybody can recalculate.
 */
describe('calcPrice rounding', () => {
  /** A fare table in pesewas, priced to the cedi. */
  function pesewaFare(minFare: number) {
    return params({ base: 0, rate: 0, minFare, bookingFee: 0, platformFee: 0 });
  }

  it('rounds down below the half cedi', () => {
    expect(calcPrice(pesewaFare(43.35), 0).price).toBe(43);
    expect(calcPrice(pesewaFare(43.49), 0).price).toBe(43);
  });

  it('rounds a half cedi up, as money conventionally does', () => {
    expect(calcPrice(pesewaFare(43.5), 0).price).toBe(44);
  });

  it('rounds up above the half cedi', () => {
    expect(calcPrice(pesewaFare(43.65), 0).price).toBe(44);
  });

  it('leaves a total that is already whole alone', () => {
    expect(calcPrice(pesewaFare(43), 0).price).toBe(43);
  });

  /**
   * The pesewas are added up before anything is rounded. 42.40 + 0.40 + 0.40 is
   * 43.20, so the answer is 43 — where rounding each part on its own would drop
   * both 0.40s to nothing and quote 42.
   */
  it('rounds the total rather than the parts', () => {
    const p = params({
      base: 42.4,
      rate: 0.4,
      perMin: 0,
      minFare: 0,
      bookingFee: 0.4,
      platformFee: 0,
    });

    expect(calcPrice(p, 1).price).toBe(43);
  });

  it('never returns a fraction, whatever the fare table holds', () => {
    const p = params({ base: 7.77, rate: 3.33, perMin: 1.11, minFare: 0.99 });

    for (const km of [0, 0.5, 1, 2.7, 13.4]) {
      const { price } = calcPrice(p, km, km * 3, ['rush']);
      expect(Number.isInteger(price)).toBe(true);
    }
  });
});
