import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';

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

const { patchDelivery, DeliveryConflictError } = await import('@/lib/deliveries');

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
