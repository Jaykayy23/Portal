import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';
import type { SessionUser } from '@/lib/types';

type DeliveryRow = Database['public']['Tables']['deliveries']['Row'];
type DeliveryUpdate = Database['public']['Tables']['deliveries']['Update'];
type DeliveryStatus = DeliveryRow['status'];

const RIDER = {
  id: 'rider-new',
  name: 'Aba',
  phone: '0577004739',
  reg_number: 'GT 654',
  model: 'Boxer',
};

/**
 * Enough of a row for `fromRow` to read. Only `status` and `rider_id` matter to
 * these tests; the rest exists so the mapper does not trip over nulls.
 */
const BASE_ROW = {
  id: 'delivery-1',
  created_at: '2026-08-21T11:00:00.000Z',
  customer: 'Obra Chop Bar',
  recipient_name: 'Kwame',
  recipient_phone: '0255555555',
  merchant_id: 'merchant-1',
  submitted_by: 'user-1',
  pickup: 'Osu, Accra, Ghana',
  dropoff: 'East Legon, Accra, Ghana',
  distance: 12.9,
  duration_min: 22,
  type: 'Standard',
  item_category: 'Food',
  surcharges: [],
  declared_value: 200,
  item_payment: 'COD',
  delivery_paid_by: 'customer',
  agreed: 38,
  status: 'Requested',
  rider_id: null,
  rider_name: '',
  rider_phone: '',
  rider_reg: '',
  rider_model: '',
  accepted_at: null,
  declined_at: null,
  picked_up_at: null,
  recipient_confirmed_at: null,
  delivered_at: null,
} as unknown as DeliveryRow;

/**
 * A Supabase double that records the update payload rather than performing it.
 *
 * The payload is the whole point: what these tests assert is which columns
 * `patchDelivery` decided to write, and a status it deliberately left alone is
 * an absent key, not a value.
 */
function fakeSupabase(
  current: { status: DeliveryStatus; rider_id: string | null },
  { updateFindsRow = true }: { updateFindsRow?: boolean } = {}
) {
  const updates: DeliveryUpdate[] = [];

  const readOne = (data: unknown) => ({
    eq: () => ({ maybeSingle: async () => ({ data, error: null }) }),
  });

  const client = {
    from(table: string) {
      if (table === 'riders') return { select: () => readOne(RIDER) };
      if (table === 'profiles') return { select: () => readOne({ phone: '0201111111' }) };

      return {
        // Serves both pre-reads: `rider_id` before overwriting it, and `status`
        // before deciding whether to advance it.
        select: () => readOne(current),
        update: (payload: DeliveryUpdate) => {
          updates.push(payload);
          // The write is anchored with chained filters (.eq on id and status,
          // .eq/.is on rider_id), so the double has to accept any number of them.
          const chain = {
            eq: () => chain,
            is: () => chain,
            select: () => ({
              maybeSingle: async () => ({
                data: updateFindsRow ? { ...BASE_ROW, ...current, ...payload } : null,
                error: null,
              }),
            }),
          };
          return chain;
        },
      };
    },
  };

  return { client, updates };
}

const createSupabaseServerClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));
// The previous rider's availability is recomputed on every reassignment. It is
// its own unit of behaviour and its own query surface — not this one's.
vi.mock('@/lib/riderAvailability', () => ({ syncRiderAvailability: vi.fn() }));

const {
  patchDelivery,
  confirmPickup,
  DeliveryConflictError,
  DELIVERY_MAX_ROWS,
  listDeliveriesFor,
  listAlertDeliveriesFor,
} = await import('@/lib/deliveries');

const MERCHANT_USER: SessionUser = {
  id: 'merchant-1',
  username: 'obra',
  companyName: 'Obra Chop Bar',
  phone: '0201111111',
  role: 'merchant',
};

describe('listDeliveriesFor — bounded history', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  it('orders a rolling 365-day delivery window and reads it whole', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));

    const calls: [string, ...unknown[]][] = [];
    const query = {
      gte(column: string, value: string) {
        calls.push(['gte', column, value]);
        return query;
      },
      lt(column: string, value: string) {
        calls.push(['lt', column, value]);
        return query;
      },
      order(column: string, options: unknown) {
        calls.push(['order', column, options]);
        return query;
      },
      async limit(value: number) {
        calls.push(['limit', value]);
        return { data: [BASE_ROW], error: null };
      },
    };
    createSupabaseServerClient.mockResolvedValue({
      from: () => ({
        select: () => query,
      }),
    });

    try {
      const { records, truncated } = await listDeliveriesFor(MERCHANT_USER);

      expect(records).toHaveLength(1);
      // A short first page is the whole window, so the figures built from it
      // are totals and the screens say nothing.
      expect(truncated).toBe(false);
      expect(calls).toEqual([
        ['gte', 'created_at', '2025-08-27T00:00:00.000Z'],
        ['lt', 'created_at', '2026-08-27T00:00:00.000Z'],
        ['order', 'created_at', { ascending: false }],
        ['order', 'id', { ascending: false }],
        ['limit', 1000],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The bug this replaced: a single capped query handed back the newest 1,000
   * rows of the year and nothing said the rest existed, so a debt older than the
   * cut simply stopped being owed. Two full pages have to come back as one set.
   */
  it('pages past the row ceiling instead of stopping at the first thousand', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...BASE_ROW,
        id: `delivery-${String(start + i).padStart(5, '0')}`,
        created_at: new Date(Date.UTC(2026, 0, 1) - (start + i) * 60_000).toISOString(),
      }));

    const pages = [page(0, 1000), page(1000, 250)];
    const filters: string[] = [];
    let served = 0;

    createSupabaseServerClient.mockResolvedValue({
      from: () => ({
        select: () => {
          const query = {
            gte: () => query,
            lt: () => query,
            or(filter: string) {
              filters.push(filter);
              return query;
            },
            order: () => query,
            async limit() {
              return { data: pages[served++] ?? [], error: null };
            },
          };
          return query;
        },
      }),
    });

    const { records, truncated } = await listDeliveriesFor(MERCHANT_USER);

    expect(records).toHaveLength(1250);
    expect(truncated).toBe(false);
    expect(served).toBe(2);
    // The second request resumed from the last row of the first, by timestamp
    // and id together rather than timestamp alone.
    const last = pages[0][999];
    expect(filters).toEqual([
      `created_at.lt.${last.created_at},` +
        `and(created_at.eq.${last.created_at},id.lt.${last.id})`,
    ]);
  });

  /**
   * Past the ceiling the screens are working from a prefix of the period, and
   * that has to arrive as a fact the page can render — not as a shorter array
   * that looks exactly like a quiet year.
   */
  it('says so when the window is larger than the ceiling', async () => {
    let served = 0;
    createSupabaseServerClient.mockResolvedValue({
      from: () => ({
        select: () => {
          const query = {
            gte: () => query,
            lt: () => query,
            or: () => query,
            order: () => query,
            async limit(size: number) {
              const start = served++ * size;
              return {
                data: Array.from({ length: size }, (_, i) => ({
                  ...BASE_ROW,
                  id: `delivery-${start + i}`,
                  created_at: new Date(Date.UTC(2026, 0, 1) - (start + i) * 1000).toISOString(),
                })),
                error: null,
              };
            },
          };
          return query;
        },
      }),
    });

    const { records, truncated } = await listDeliveriesFor(MERCHANT_USER);

    expect(truncated).toBe(true);
    expect(records).toHaveLength(DELIVERY_MAX_ROWS);
  });

  it('gives the alert bell only actionable in-flight rows with its own capped query', async () => {
    const calls: [string, ...unknown[]][] = [];
    const query = {
      in(column: string, values: string[]) {
        calls.push(['in', column, values]);
        return query;
      },
      order(column: string, options: unknown) {
        calls.push(['order', column, options]);
        return query;
      },
      async limit(value: number) {
        calls.push(['limit', value]);
        return { data: [BASE_ROW], error: null };
      },
    };
    createSupabaseServerClient.mockResolvedValue({
      from: () => ({ select: () => query }),
    });

    const records = await listAlertDeliveriesFor(MERCHANT_USER);

    expect(records).toHaveLength(1);
    expect(calls).toEqual([
      [
        'in',
        'status',
        ['Requested', 'Approved', 'Pending', 'Declined', 'Assigned', 'Recipient confirmed'],
      ],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 1000],
    ]);
  });
});

/** Runs one patch against a delivery in `current`, and returns what was written. */
async function patchFrom(
  current: { status: DeliveryStatus; rider_id?: string | null },
  patch: Parameters<typeof patchDelivery>[1]
) {
  const { client, updates } = fakeSupabase({ rider_id: null, ...current });
  createSupabaseServerClient.mockResolvedValue(client);
  await patchDelivery('delivery-1', patch);
  return updates[0];
}

describe('patchDelivery — offering a job to a rider', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  // The regression this file exists for. 'Approved' reads as "assign a rider" on
  // the delivery log exactly as 'Requested' does, so a delivery left behind in
  // 'Approved' keeps that line in Needs attention for both ops and admin after
  // someone has already been put on the job.
  it.each(['Requested', 'Approved', 'Declined'] as DeliveryStatus[])(
    'advances a delivery in %s to Pending',
    async (status) => {
      const update = await patchFrom({ status }, { riderId: RIDER.id });

      expect(update.status).toBe('Pending');
      expect(update.rider_id).toBe(RIDER.id);
      // A reassignment is a clean start: the previous rider's answer does not
      // travel to the next one.
      expect(update.accepted_at).toBeNull();
      expect(update.declined_at).toBeNull();
    }
  );

  // It stops at 'Pending' — only the rider's own acceptance makes a delivery
  // 'Assigned', and nothing past that point is rewritten by attaching a rider.
  it.each(['Pending', 'Assigned', 'Picked up', 'Delivered'] as DeliveryStatus[])(
    'leaves a delivery in %s at the status it already has',
    async (status) => {
      const update = await patchFrom({ status, rider_id: 'rider-old' }, { riderId: RIDER.id });

      expect(update.status).toBeUndefined();
      expect(update.rider_id).toBe(RIDER.id);
    }
  );

  it('never overrides a status sent in the same patch', async () => {
    const update = await patchFrom(
      { status: 'Approved' },
      { riderId: RIDER.id, status: 'Assigned' }
    );

    expect(update.status).toBe('Assigned');
  });

  // The mirror case is deliberately not symmetric: 'Approved' is a pre-rider
  // status, so taking the rider off one leaves it saying "assign a rider", which
  // is what it now genuinely needs.
  it('returns a rider-bearing status to the queue on unassignment, and leaves Approved alone', async () => {
    const pending = await patchFrom({ status: 'Pending', rider_id: 'rider-old' }, { riderId: null });
    expect(pending.status).toBe('Requested');
    expect(pending.rider_id).toBeNull();

    const approved = await patchFrom(
      { status: 'Approved', rider_id: 'rider-old' },
      { riderId: null }
    );
    expect(approved.status).toBeUndefined();
  });
});

describe('patchDelivery — two ops working the same stale queue', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  // The screen said "Unassigned", but by the time the request arrived somebody
  // else had already put a rider on it. Refusing before anything is written is
  // what stops both riders being messaged for one parcel.
  it('refuses a write whose expected rider no longer matches, without writing', async () => {
    const { client, updates } = fakeSupabase({ status: 'Pending', rider_id: 'rider-old' });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      patchDelivery('delivery-1', { riderId: RIDER.id, expectedRiderId: null })
    ).rejects.toBeInstanceOf(DeliveryConflictError);
    expect(updates).toHaveLength(0);
  });

  // The row moved between this request's own read and its write — the anchored
  // UPDATE matches zero rows, and a row that still exists means conflict, not
  // "not found".
  it('reports a conflict when the anchored update lands on zero rows', async () => {
    const { client } = fakeSupabase(
      { status: 'Requested', rider_id: null },
      { updateFindsRow: false }
    );
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      patchDelivery('delivery-1', { riderId: RIDER.id })
    ).rejects.toBeInstanceOf(DeliveryConflictError);
  });
});

/**
 * Both of these exist for the automatic sender, and the property they protect is
 * the same one: an alert fires when a delivery genuinely moves, and not
 * otherwise. Getting it wrong is not a crash — it is a rider texted twice about
 * one job, or a customer told their parcel is on the way every time somebody
 * refreshes a page.
 *
 * Neither function decides to send anything. What they do is report honestly
 * whether their own write changed the row, which is the fact the Route Handlers
 * key the send off. That is why it is worth a test: the write is anchored in
 * Postgres, so the only way this breaks is a caller here quietly reporting a
 * transition that did not happen.
 */
describe('patchDelivery — reporting the transition, for the alert that follows', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  it('reports the status the row held before, alongside the one it holds now', async () => {
    const { client } = fakeSupabase({ status: 'Requested', rider_id: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const { delivery, previousStatus } = await patchDelivery('delivery-1', {
      riderId: RIDER.id,
    });

    expect(previousStatus).toBe('Requested');
    expect(delivery.status).toBe('Pending');
  });

  // Attaching a rider to a delivery that is already Pending — correcting a
  // mis-assignment, say — writes the rider columns and leaves the status where it
  // was. There is no new job offer to send, and the two statuses matching is how
  // the route knows that.
  it('reports no change when a patch writes columns but does not move the row', async () => {
    const { client } = fakeSupabase({ status: 'Pending', rider_id: 'rider-old' });
    createSupabaseServerClient.mockResolvedValue(client);

    const { delivery, previousStatus } = await patchDelivery('delivery-1', {
      riderId: RIDER.id,
    });

    expect(previousStatus).toBe('Pending');
    expect(delivery.status).toBe('Pending');
  });
});

describe('confirmPickup — a second tap is not a second message', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  it('reports the move when the status filter claims the row', async () => {
    const { client } = fakeSupabase({ status: 'Assigned', rider_id: RIDER.id });
    createSupabaseServerClient.mockResolvedValue(client);

    const { delivery, moved } = await confirmPickup('delivery-1');

    expect(moved).toBe(true);
    expect(delivery.status).toBe('Picked up');
  });

  // The merchant tapping twice, or a retried request. The update finds nothing
  // because the delivery is no longer 'Assigned', the row comes back anyway
  // because that is what the caller asked for — and `moved` is false, so the
  // recipient is not sent their "on the way" message a second time.
  it('returns the row but reports no move when the delivery is already picked up', async () => {
    const { client, updates } = fakeSupabase(
      { status: 'Picked up', rider_id: RIDER.id },
      { updateFindsRow: false }
    );
    createSupabaseServerClient.mockResolvedValue(client);

    const { delivery, moved } = await confirmPickup('delivery-1');

    expect(moved).toBe(false);
    expect(delivery.status).toBe('Picked up');
    // It did attempt the write — the guard is Postgres's status filter, not a
    // read-then-decide in Node, which two taps a second apart would race.
    expect(updates).toHaveLength(1);
  });

  it('refuses a delivery that has not been accepted yet', async () => {
    const { client } = fakeSupabase({ status: 'Pending', rider_id: RIDER.id }, { updateFindsRow: false });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(confirmPickup('delivery-1')).rejects.toThrow(/only be confirmed once/);
  });
});
