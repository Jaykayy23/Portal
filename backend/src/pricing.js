const SURCHARGE_OPTIONS = [
  { id: 'rush', label: 'Same-day rush', amount: 15 },
  { id: 'fragile', label: 'Fragile handling', amount: 10 },
  { id: 'afterhours', label: 'After-hours (past 8pm)', amount: 12 },
];

/**
 * Recommended price = max(minimum fare, base fare + rate x distance) + surcharges.
 * Minimum negotiable = recommended price x min. negotiable %.
 *
 * Calculated server-side (not trusted from the client) so a merchant can't
 * submit a request with a fabricated "recommended" price.
 */
function calcPrice(params, distanceKm, surchargeIds) {
  const distance = Number(distanceKm) || 0;
  const base = params.base + params.rate * distance;
  const surchargeTotal = (surchargeIds || []).reduce((sum, id) => {
    const opt = SURCHARGE_OPTIONS.find((o) => o.id === id);
    return sum + (opt ? opt.amount : 0);
  }, 0);
  const recommended = Math.max(params.minFare, base) + surchargeTotal;
  const minimum = recommended * (params.minPct / 100);
  return { recommended: round2(recommended), minimum: round2(minimum) };
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { SURCHARGE_OPTIONS, calcPrice };
