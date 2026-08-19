import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getPricingParams, savePricingParams } from '@/lib/settings';
import { surchargeId } from '@/lib/pricing';
import type { PricingParams, SurchargeOption } from '@/lib/types';

// Every signed-in role reads pricing — merchants need it for the live preview and
// for the surge charge options on the New delivery form.
export async function GET() {
  return handle(async () => {
    await requireUser();
    return NextResponse.json({ params: await getPricingParams() });
  });
}

const MAX_SURCHARGES = 20;
const MAX_SURCHARGE_AMOUNT = 100_000;

/**
 * Surge charges arrive from the Pricing tab as free-form rows, so ids are worked
 * out here rather than trusted from the browser: an existing id is kept (past
 * deliveries reference it), and a new row gets one slugified from its label,
 * de-duplicated against the rest of the list.
 */
function normaliseSurcharges(input: unknown): SurchargeOption[] {
  if (!Array.isArray(input)) badRequest('Surge charges must be a list.');
  if (input.length > MAX_SURCHARGES) {
    badRequest(`That is more than ${MAX_SURCHARGES} surge charges — please remove a few.`);
  }

  const seen = new Set<string>();
  return input.map((raw) => {
    const row = (raw ?? {}) as Partial<SurchargeOption>;
    const label = String(row.label ?? '').trim();
    if (!label) badRequest('Every surge charge needs a name.');

    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      badRequest(`"${label}" needs an amount of zero or more.`);
    }
    if (amount > MAX_SURCHARGE_AMOUNT) {
      badRequest(`The amount for "${label}" looks wrong — it is far too large.`);
    }

    const base = String(row.id ?? '').trim() || surchargeId(label);
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`;
    seen.add(id);

    return { id, label, amount: Math.round(amount * 100) / 100 };
  });
}

// Admin only. Writes just the fields the caller sent, so the fares form and the
// surge charge list can each save without touching the other.
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser('admin');
    const body = await readJson<PricingParams>(req);

    const patch: Partial<PricingParams> = {};
    if (body.base !== undefined) patch.base = Number(body.base) || 0;
    if (body.rate !== undefined) patch.rate = Number(body.rate) || 0;
    if (body.perMin !== undefined) patch.perMin = Number(body.perMin) || 0;
    if (body.minFare !== undefined) patch.minFare = Number(body.minFare) || 0;
    if (body.minPct !== undefined) patch.minPct = Number(body.minPct) || 0;
    if (body.opsPhone !== undefined) patch.opsPhone = body.opsPhone || '';
    if (body.surcharges !== undefined) patch.surcharges = normaliseSurcharges(body.surcharges);

    return NextResponse.json({ params: await savePricingParams(patch) });
  });
}
