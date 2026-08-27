import type { PricingParams, SurchargeOption } from './types';

export type { SurchargeOption };

/**
 * The list a fresh install starts with, and the fallback when the app is
 * deployed ahead of the surcharges migration — without it the surge charge field
 * would silently disappear from the New delivery form.
 *
 * Not the live list: that is `params.surcharges`, which admin edits under Settings.
 */
export const DEFAULT_SURCHARGES: SurchargeOption[] = [
  { id: 'rush', label: 'Same-day rush', amount: 15 },
  { id: 'fragile', label: 'Fragile handling', amount: 10 },
  { id: 'afterhours', label: 'After-hours (past 8pm)', amount: 12 },
];

export interface PriceQuote {
  /** What the delivery costs. There is no floor and nothing to negotiate. */
  price: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Turns a label into a stable id. Used when admin adds a surge charge, since
 * deliveries store ids rather than labels.
 */
export function surchargeId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'surcharge'
  );
}

/**
 * Price = max(minimum fare, base fare + rate x distance + per-min x time)
 *         + surge charges + booking fee + platform fee.
 *
 * One figure, and it is the price. There is no floor and no negotiable band: what
 * this returns is what the delivery is logged and charged at.
 *
 * The two fees are flat amounts and sit outside the max() alongside the surge
 * charges — the minimum fare floors the fare, not the fees, so a booking fee is
 * worth the same on a 1km run as on a 30km one rather than being quietly
 * swallowed on short trips.
 *
 * Time is the estimated driving minutes for the route, which is what makes two
 * runs of equal distance price differently when one of them crawls through
 * traffic. It sits inside the max() alongside distance because the minimum fare
 * is a floor on the whole trip, not on the distance component alone.
 *
 * Surge charge amounts come from `params`, never from the caller, so a merchant
 * cannot submit a surge charge worth -50 GHS. Ids that are not in the configured
 * list — an option admin has since deleted, say — add nothing.
 *
 * Shared by the client-side preview and the Route Handler that actually writes
 * the record — but the Route Handler's result is the only one stored, so a
 * merchant can't submit a fabricated recommended/minimum price.
 */
export function calcPrice(
  params: PricingParams,
  distanceKm: number | string,
  durationMin: number | string = 0,
  surchargeIds: string[] = []
): PriceQuote {
  const distance = Number(distanceKm) || 0;
  const minutes = Number(durationMin) || 0;
  const base = params.base + params.rate * distance + params.perMin * minutes;
  const options = params.surcharges ?? [];
  const surchargeTotal = surchargeIds.reduce((sum, id) => {
    const opt = options.find((o) => o.id === id);
    return sum + (opt ? opt.amount : 0);
  }, 0);
  // `|| 0` for the same reason toPricingParams() uses it: a portal running ahead
  // of the fees migration quotes without them instead of returning NaN.
  const fees = (Number(params.bookingFee) || 0) + (Number(params.platformFee) || 0);
  const recommended = Math.max(params.minFare, base) + surchargeTotal + fees;
  return { price: round2(recommended) };
}
