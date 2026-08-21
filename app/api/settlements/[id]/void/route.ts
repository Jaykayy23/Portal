import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { SettlementError, voidSettlement } from '@/lib/settlements';

const PER_USER = { limit: 20, windowSeconds: 300 };

interface Body {
  reason?: string;
}

/**
 * Unwinds a settlement recorded by mistake.
 *
 * Void, not delete: the row stays, stamped with who did it and why, and the
 * obligations it had discharged reappear on the ledger as unsettled. A settlement
 * that vanished would leave money looking unpaid with nothing to say why, which
 * is the one thing a ledger must never do.
 *
 * POST rather than DELETE for the same reason — nothing is being removed, and the
 * reason is a body, which DELETE cannot carry reliably.
 *
 * Idempotent without a key: `void_settlement` treats an already-voided settlement
 * as success, since the end state is the one the caller asked for and a second
 * tap is almost always a double click.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser('admin', 'ops', 'finance');
    const { id } = await ctx.params;
    await enforceRateLimit('settlement-void', user.id, PER_USER);

    const { reason } = await readJson<Body>(req);
    const why = String(reason ?? '').trim();
    // Checked here as well as in the database so the message is about the form
    // rather than about a constraint.
    if (!why) badRequest('Say why this settlement is being voided.');

    try {
      await voidSettlement(id, why);
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (e instanceof SettlementError) badRequest(e.message);
      throw e;
    }
  });
}
