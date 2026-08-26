import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSupabaseServerClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

const { listSettlementMarks, listSettlements } = await import('@/lib/settlements');

/**
 * Records every filter both settlement reads apply, and serves the pages given.
 * Each `from()` starts a fresh builder, the way supabase-js does.
 */
function recordingClient(pagesByTable: Record<string, unknown[][]>) {
  const calls: [string, string, ...unknown[]][] = [];
  const served: Record<string, number> = {};

  return {
    calls,
    client: {
      from(table: string) {
        const query = {
          eq(column: string, value: unknown) {
            calls.push([table, 'eq', column, value]);
            return query;
          },
          is(column: string, value: unknown) {
            calls.push([table, 'is', column, value]);
            return query;
          },
          gte(column: string, value: unknown) {
            calls.push([table, 'gte', column, value]);
            return query;
          },
          lt(column: string, value: unknown) {
            calls.push([table, 'lt', column, value]);
            return query;
          },
          in(column: string, value: unknown) {
            calls.push([table, 'in', column, value]);
            return query;
          },
          or(filter: string) {
            calls.push([table, 'or', filter]);
            return query;
          },
          order(column: string, options: unknown) {
            calls.push([table, 'order', column, options]);
            return query;
          },
          async limit(size: number) {
            calls.push([table, 'limit', size]);
            const index = served[table] ?? 0;
            served[table] = index + 1;
            return { data: pagesByTable[table]?.[index] ?? [], error: null };
          },
        };
        return { select: () => query };
      },
    },
  };
}

describe('listSettlementMarks', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  it('orders both settlement tables newest first and bounds each request', async () => {
    const { calls, client } = recordingClient({});
    createSupabaseServerClient.mockResolvedValue(client);

    const { marks, truncated } = await listSettlementMarks();

    expect(marks.size).toBe(0);
    expect(truncated).toBe(false);
    expect(calls).toEqual([
      ['settlement_lines', 'eq', 'voided', false],
      ['settlement_lines', 'order', 'settled_at', { ascending: false }],
      ['settlement_lines', 'order', 'id', { ascending: false }],
      ['settlement_lines', 'limit', 1000],
      ['settlements', 'is', 'voided_at', null],
      ['settlements', 'order', 'settled_at', { ascending: false }],
      ['settlements', 'order', 'id', { ascending: false }],
      ['settlements', 'limit', 1000],
    ]);
  });

  /**
   * The bug: unbounded and newest-first, so PostgREST's own ceiling dropped the
   * *oldest* marks — the ones belonging to the oldest deliveries still on the
   * ledger. A delivery whose mark went missing reads as unpaid, and somebody is
   * sent to collect money that was handed in months ago.
   *
   * A settlement cannot predate the delivery it settles, so bounding the read at
   * the window's start keeps every mark that could match a row on screen and
   * discards only the ones that could not.
   */
  it('bounds both tables at the start of the delivery window it was given', async () => {
    const { calls, client } = recordingClient({});
    createSupabaseServerClient.mockResolvedValue(client);

    await listSettlementMarks({ from: '2025-08-27T00:00:00.000Z' });

    expect(calls.filter((c) => c[1] === 'gte')).toEqual([
      ['settlement_lines', 'gte', 'settled_at', '2025-08-27T00:00:00.000Z'],
      ['settlements', 'gte', 'settled_at', '2025-08-27T00:00:00.000Z'],
    ]);
  });

  /**
   * Every line of one bulk remittance carries that settlement's `settled_at` to
   * the microsecond, so a tie spanning a page boundary is routine here. The
   * cursor has to resume on `(settled_at, id)` or the rest of the tie is lost.
   */
  it('resumes a second page on the timestamp and id of the last line read', async () => {
    const at = '2026-03-01T09:00:00.000Z';
    const line = (id: string) => ({
      id,
      settlement_id: 's1',
      delivery_id: `d-${id}`,
      stream: 'fee',
      leg: 'in',
      kind: 'payment',
      amount: 10,
      settled_at: at,
      voided: false,
    });
    const first = Array.from({ length: 1000 }, (_, i) => line(`l${String(i).padStart(4, '0')}`));

    const { calls, client } = recordingClient({
      settlement_lines: [first, [line('l1000')]],
      settlements: [[]],
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const { marks, truncated } = await listSettlementMarks();

    expect(truncated).toBe(false);
    // 1,001 lines, each on its own delivery — none dropped at the page boundary.
    expect(marks.size).toBe(1001);
    expect(calls).toContainEqual([
      'settlement_lines',
      'or',
      `settled_at.lt.${at},and(settled_at.eq.${at},id.lt.l0999)`,
    ]);
  });
});

describe('listSettlements', () => {
  beforeEach(() => createSupabaseServerClient.mockReset());

  it('applies an export date range before ordering and limiting settlement headers', async () => {
    const { calls, client } = recordingClient({});
    createSupabaseServerClient.mockResolvedValue(client);

    await listSettlements(100, {
      from: '2026-08-20T00:00:00.000Z',
      before: '2026-08-27T00:00:00.000Z',
    });

    expect(calls).toEqual([
      ['settlements', 'gte', 'settled_at', '2026-08-20T00:00:00.000Z'],
      ['settlements', 'lt', 'settled_at', '2026-08-27T00:00:00.000Z'],
      ['settlements', 'order', 'settled_at', { ascending: false }],
      ['settlements', 'order', 'id', { ascending: false }],
      ['settlements', 'limit', 100],
    ]);
  });
});
