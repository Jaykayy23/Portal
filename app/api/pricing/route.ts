import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { logActivity } from '@/lib/activity';
import { humanFields } from '@/lib/activityText';
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
 * A flat fee, checked here rather than left to the database.
 *
 * The non-negative CHECK on pricing_params would catch a negative fee, but it
 * would come back as a save failure with nothing on screen saying which box was
 * wrong. These two are the only pricing fields with their own form, so a typo in
 * one is worth naming.
 */
function feeAmount(value: unknown, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    badRequest(`The ${label} has to be zero or more.`);
  }
  if (amount > MAX_SURCHARGE_AMOUNT) {
    badRequest(`That ${label} looks wrong — it is far too large.`);
  }
  return Math.round(amount * 100) / 100;
}

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

// Admin only. Writes just the fields the caller sent, so the fares, the surge
// charge list and each fee can save without touching one another.
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser('admin');
    const body = await readJson<PricingParams>(req);

    const patch: Partial<PricingParams> = {};
    if (body.base !== undefined) patch.base = Number(body.base) || 0;
    if (body.rate !== undefined) patch.rate = Number(body.rate) || 0;
    if (body.perMin !== undefined) patch.perMin = Number(body.perMin) || 0;
    if (body.minFare !== undefined) patch.minFare = Number(body.minFare) || 0;
    if (body.bookingFee !== undefined) {
      patch.bookingFee = feeAmount(body.bookingFee, 'booking fee');
    }
    if (body.platformFee !== undefined) {
      patch.platformFee = feeAmount(body.platformFee, 'platform fee');
    }
    if (body.opsPhone !== undefined) patch.opsPhone = body.opsPhone || '';
    if (body.surcharges !== undefined) patch.surcharges = normaliseSurcharges(body.surcharges);

    const saved = await savePricingParams(patch);

    // The fares themselves are worth writing down, not just that they moved: a
    // quote a merchant disputes next month is settled by knowing what the
    // formula was on the day, and this row is the only place that survives the
    // next edit. Nothing here is a secret — every signed-in seat reads pricing.
    if (Object.keys(patch).length > 0) {
      logActivity({
        actor: user,
        action: 'pricing.updated',
        entityType: 'pricing',
        details: { fields: humanFields(Object.keys(patch)), to: patch },
      });
    }

    return NextResponse.json({ params: saved });
  });
}
