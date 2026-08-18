import type { PricingParams } from './types';

export interface SurchargeOption {
  id: string;
  label: string;
  amount: number;
}

export const SURCHARGE_OPTIONS: SurchargeOption[] = [
  { id: 'rush', label: 'Same-day rush', amount: 15 },
  { id: 'fragile', label: 'Fragile handling', amount: 10 },
  { id: 'afterhours', label: 'After-hours (past 8pm)', amount: 12 },
];

export interface PriceQuote {
  recommended: number;
  minimum: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Recommended price = max(minimum fare, base fare + rate x distance) + surcharges.
 * Minimum negotiable = recommended price x min. negotiable %.
 *
 * Shared by the client-side preview and the Route Handler that actually writes
 * the record — but the Route Handler's result is the only one stored, so a
 * merchant can't submit a fabricated recommended/minimum price.
 */
export function calcPrice(
  params: PricingParams,
  distanceKm: number | string,
  surchargeIds: string[] = []
): PriceQuote {
  const distance = Number(distanceKm) || 0;
  const base = params.base + params.rate * distance;
  const surchargeTotal = surchargeIds.reduce((sum, id) => {
    const opt = SURCHARGE_OPTIONS.find((o) => o.id === id);
    return sum + (opt ? opt.amount : 0);
  }, 0);
  const recommended = Math.max(params.minFare, base) + surchargeTotal;
  return { recommended: round2(recommended), minimum: round2(recommended * (params.minPct / 100)) };
}
