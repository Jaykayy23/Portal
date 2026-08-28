import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { getDeliveryOptions, saveDeliveryOptions } from '@/lib/settings';
import type { DeliveryOptions } from '@/lib/types';
import { logActivity } from '@/lib/activity';

// Every signed-in role reads these — a merchant needs the item category list to
// pick from it on the New delivery form.
export async function GET() {
  return handle(async () => {
    await requireUser();
    return NextResponse.json({ options: await getDeliveryOptions() });
  });
}

const MAX_CATEGORIES = 40;
const MAX_LABEL_CHARS = 60;

/**
 * Blank rows are dropped rather than rejected, so an admin who clicks "add" and
 * changes their mind can still save. Duplicates are folded case-insensitively:
 * two options reading "Food" and "food" in the same dropdown is a mistake, never
 * an intent.
 */
function normaliseCategories(input: unknown): string[] {
  if (!Array.isArray(input)) badRequest('Item categories must be a list.');
  if (input.length > MAX_CATEGORIES) {
    badRequest(`That is more than ${MAX_CATEGORIES} item categories — please remove a few.`);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    if (label.length > MAX_LABEL_CHARS) {
      badRequest(
        `"${label.slice(0, 20)}…" is too long — keep a category under ${MAX_LABEL_CHARS} characters.`
      );
    }
    const key = label.toLowerCase();
    if (seen.has(key)) badRequest(`"${label}" is listed twice.`);
    seen.add(key);
    out.push(label);
  }
  return out;
}

// Admin only, and RLS says the same thing under it: saveDeliveryOptions writes
// through the caller's session, so a non-admin write updates zero rows.
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser('admin');
    const body = await readJson<DeliveryOptions>(req);

    const patch: Partial<DeliveryOptions> = {};
    if (body.itemCategories !== undefined) {
      patch.itemCategories = normaliseCategories(body.itemCategories);
    }

    const saved = await saveDeliveryOptions(patch);

    if (patch.itemCategories !== undefined) {
      logActivity({
        actor: user,
        action: 'delivery_options.updated',
        entityType: 'settings',
        // The list itself, because removing a category is invisible afterwards:
        // deliveries snapshot the label they were filed under, so the only
        // record that a category ever existed is this line.
        details: {
          categories: saved.itemCategories.length,
          to: saved.itemCategories,
        },
      });
    }

    return NextResponse.json({ options: saved });
  });
}
