import { describe, expect, it, vi } from 'vitest';
import { keysetBefore, readAllPages, type ReadCursor } from '@/lib/pagedRead';

interface Row {
  id: string;
  at: string;
}

const fail = (message: string) => new Error(message);
const context = 'test';
const unavailable = 'Could not load that.';
const cursorOf = (r: Row): ReadCursor => ({ sort: r.at, id: r.id });

/**
 * A PostgREST stand-in: holds rows, applies the composite cursor the way the
 * `or=(...)` filter does, sorts newest first and truncates to the page size.
 */
function source(rows: Row[]) {
  const cursors: (ReadCursor | null)[] = [];
  const page = (cursor: ReadCursor | null, size: number) => {
    cursors.push(cursor);
    const matched = rows
      .filter((r) =>
        cursor === null
          ? true
          : r.at < cursor.sort || (r.at === cursor.sort && r.id < cursor.id)
      )
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    return Promise.resolve({ data: matched.slice(0, size), error: null });
  };
  return { page, cursors };
}

/** Ids that sort the same way as their index, so ordering is readable. */
function rows(count: number, at: (i: number) => string, prefix = 'r'): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(4, '0')}`,
    at: at(i),
  }));
}

/** Distinct, ascending timestamps — one second apart. */
const spread = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();

describe('keysetBefore', () => {
  it('asks for an older row, or the same instant with a lower id', () => {
    expect(
      keysetBefore('created_at', { sort: '2026-01-01T00:00:05.000Z', id: 'abc-123' })
    ).toBe(
      'created_at.lt.2026-01-01T00:00:05.000Z,' +
        'and(created_at.eq.2026-01-01T00:00:05.000Z,id.lt.abc-123)'
    );
  });
});

describe('readAllPages', () => {
  it('returns a set smaller than one page in a single request', async () => {
    const { page, cursors } = source(rows(3, spread));

    const result = await readAllPages({ page, cursorOf, maxRows: 100, pageSize: 10, context, fail, unavailable });

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(3);
    // One request, no cursor: a short page means the filter is exhausted.
    expect(cursors).toEqual([null]);
  });

  it('walks every page of a set several pages deep, newest first and without gaps', async () => {
    const { page, cursors } = source(rows(25, spread));

    const result = await readAllPages({ page, cursorOf, maxRows: 100, pageSize: 10, context, fail, unavailable });

    expect(result.truncated).toBe(false);
    // Every row exactly once — the whole point. A single capped query would
    // have returned 10 of the 25 and said nothing about the rest.
    expect(result.rows).toHaveLength(25);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(25);
    expect(result.rows[0].at > result.rows[24].at).toBe(true);
    expect(cursors).toHaveLength(3);
  });

  /**
   * Why the cursor carries the id and not just the timestamp. Twelve rows share
   * one instant and the page holds six, so a timestamp-only cursor either steps
   * over the six it has not read (exclusive) or asks for the same six forever
   * (inclusive). This is not a corner case in the ledger: every line of one bulk
   * settlement is stamped with that settlement's `settled_at`.
   */
  it('pages through a tie larger than one page without losing or repeating a row', async () => {
    const collide = '2026-01-01T00:00:05.000Z';
    const { page } = source([...rows(4, spread), ...rows(12, () => collide, 'tie')]);

    const result = await readAllPages({ page, cursorOf, maxRows: 100, pageSize: 6, context, fail, unavailable });

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(16);
    expect(result.rows.filter((r) => r.at === collide)).toHaveLength(12);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(16);
  });

  it('reports truncation at the ceiling instead of returning a short answer quietly', async () => {
    const { page } = source(rows(50, spread));

    const result = await readAllPages({ page, cursorOf, maxRows: 20, pageSize: 10, context, fail, unavailable });

    expect(result.rows).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  /**
   * The backstop. A cursor that cannot advance — a bad comparison, a column that
   * is not unique enough — would otherwise re-request the same page until the
   * request died. It stops and reports the set as incomplete instead.
   */
  it('stops rather than looping when a page returns nothing new', async () => {
    const page = vi
      .fn()
      .mockResolvedValue({ data: rows(4, spread), error: null });

    const result = await readAllPages({ page, cursorOf, maxRows: 100, pageSize: 4, context, fail, unavailable });

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(4);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('raises the calling module’s own error type', async () => {
    class LedgerError extends Error {}
    const page = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      readAllPages({
        page,
        cursorOf,
        maxRows: 10,
        context,
        fail: (m) => new LedgerError(m),
        unavailable,
      })
    ).rejects.toBeInstanceOf(LedgerError);
  });
});
