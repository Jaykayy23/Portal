import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { idempotencyKey, withIdempotency } from '@/lib/idempotency';
import { SettlementError, listSettlements, recordSettlement } from '@/lib/settlements';
import { SETTLEMENT_METHODS } from '@/lib/ledger';
import { logActivity } from '@/lib/activity';
import { shortId } from '@/lib/format';

/**
 * The remittance book. RLS decides the contents: finance, ops and admin get all
 * of it, a merchant gets the settlements they are party to.
 */
export async function GET() {
  return handle(async () => {
    await requireUser();
    return NextResponse.json({ settlements: await listSettlements() });
  });
}

/**
 * The expected shape, not a guarantee about it — the body is untrusted and every
 * field is re-checked below. Declaring the literals rather than `string` is the
 * same choice the deliveries route makes for `type` and `itemPayment`.
 */
interface LineBody {
  deliveryId?: string;
  stream?: 'goods' | 'fee';
  leg?: 'in' | 'out';
  kind?: 'payment' | 'writeoff';
  /** Omitted means all of what is still owed. */
  amount?: number | string;
}

interface CreateBody {
  riderId?: string;
  merchantId?: string;
  method?: string;
  reference?: string;
  note?: string;
  settledAt?: string;
  lines?: LineBody[];
}

// Recording a float is a handful of actions a day, not thirty in five minutes.
const PER_USER = { limit: 30, windowSeconds: 300 };

/**
 * Records one money movement.
 *
 * Almost nothing is validated here, and that is deliberate. Every rule that
 * decides whether a settlement is legal — the caller's role, the amount, whether
 * the delivery has been handed over, whether that counterparty is the one who
 * owes this leg, whether it has been settled already — lives in
 * `record_settlement`, in one transaction, in the database. Re-checking any of it
 * in TypeScript would be a second opinion that could drift from the first.
 *
 * What is checked here is only the shape: enough to give a clear 400 instead of
 * a Postgres error for an obviously malformed request.
 *
 * Idempotent when the browser sends an Idempotency-Key. That matters more here
 * than anywhere else in the portal: a settle request whose response never
 * arrived, retried, would otherwise be refused by the one-obligation-one-leg
 * index and look like a failure when the money was in fact recorded.
 */
export async function POST(req: Request) {
  return handle(async () => {
    // The role list is a courtesy — record_settlement refuses anyone else itself,
    // and it is the only path to these tables. Naming the roles turns that into a
    // clean 403 rather than a database exception.
    const user = await requireUser('admin', 'ops', 'finance');
    await enforceRateLimit('settlement-create', user.id, PER_USER);

    const key = idempotencyKey(req);
    const body = await readJson<CreateBody>(req);
    const riderId = String(body.riderId ?? '').trim();
    const merchantId = String(body.merchantId ?? '').trim();
    const method = String(body.method ?? '').trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!riderId && !merchantId) {
      badRequest('Say whether this settlement is with a rider or with a merchant.');
    }
    if (riderId && merchantId) {
      badRequest('A settlement is with a rider or with a merchant, not both.');
    }
    if (lines.length === 0) {
      badRequest('Choose at least one delivery to settle.');
    }
    if (method && !SETTLEMENT_METHODS.includes(method as (typeof SETTLEMENT_METHODS)[number])) {
      badRequest(`How it was paid has to be one of: ${SETTLEMENT_METHODS.join(', ')}.`);
    }

    const cleaned = lines.map((l) => {
      const deliveryId = String(l.deliveryId ?? '').trim();
      if (!deliveryId) badRequest('A settlement line needs a delivery.');
      if (l.stream !== 'goods' && l.stream !== 'fee') {
        badRequest('A settlement line is for the goods or for the fee.');
      }
      if (l.leg !== 'in' && l.leg !== 'out') {
        badRequest('A settlement line is money in or money out.');
      }
      const kind = l.kind ?? 'payment';
      if (kind !== 'payment' && kind !== 'writeoff') {
        badRequest('A settlement line is a payment or a write-off.');
      }
      // Only the shape is checked here. Whether the figure is *allowed* — that
      // it is at most what the obligation still has room for — is decided by
      // record_settlement and by the trigger on settlement_lines, because that
      // answer depends on rows this handler would have to go and read.
      let amount: number | undefined;
      if (l.amount !== undefined && l.amount !== null && l.amount !== '') {
        amount = Number(l.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          badRequest('A settlement amount has to be a number greater than zero.');
        }
      }
      return { deliveryId, stream: l.stream, leg: l.leg, kind, amount };
    });

    const created = await withIdempotency('settlement-create', user.id, key, async () => {
      try {
        const id = await recordSettlement({
          riderId: riderId || undefined,
          merchantId: merchantId || undefined,
          method,
          reference: String(body.reference ?? '').trim(),
          note: String(body.note ?? '').trim(),
          settledAt: String(body.settledAt ?? '').trim() || undefined,
          lines: cleaned,
        });
        logActivity({
          actor: user,
          action: 'settlement.recorded',
          entityType: 'settlement',
          entityId: id,
          entityLabel: `#${shortId(id)}`,
          // No amount: what each line is worth is decided inside
          // record_settlement against the obligation's remaining room, so any
          // figure written here would be the request's, not the settlement's.
          details: {
            lines: cleaned.length,
            counterparty: riderId ? 'rider' : 'merchant',
            method: method || 'unstated',
          },
        });

        return { id, lines: cleaned.length };
      } catch (e) {
        // The messages record_settlement raises name the order and say what is
        // wrong with it, so they are worth passing through verbatim.
        if (e instanceof SettlementError) badRequest(e.message);
        throw e;
      }
    });

    return NextResponse.json(created);
  });
}
