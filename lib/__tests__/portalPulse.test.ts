import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPortalPulse } from '@/lib/portalPulse';

const { readPulseRow } = vi.hoisted(() => ({ readPulseRow: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: readPulseRow }) }) }),
  }),
}));

let logged: unknown[][] = [];

beforeEach(() => {
  readPulseRow.mockReset();
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPortalPulse', () => {
  it('returns the revision as a string', async () => {
    readPulseRow.mockResolvedValue({ data: { revision: 41 }, error: null });
    expect(await readPortalPulse()).toBe('41');
  });

  it('answers null when the table is not there yet', async () => {
    // An app deployed ahead of its migration. The caller reads null as "assume
    // something changed", so the portal refreshes on every tick exactly as it
    // did before the pulse existed — never a portal that silently stops.
    //
    // PGRST205 rather than Postgres' own 42P01: the request never reaches a
    // planner that could raise "relation does not exist", because PostgREST
    // fails it against its schema cache first. Verified against the live
    // project, which has not had this migration applied.
    readPulseRow.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the table 'public.portal_pulse' in the schema cache",
        code: 'PGRST205',
      },
    });
    expect(await readPortalPulse()).toBeNull();
  });

  it('says nothing about the missing table, on any of the renders that ask', async () => {
    // Every portal render calls this, several times a minute per open tab. A
    // line each would bury the failures that do mean something, for however long
    // it takes the migration to follow the deploy.
    readPulseRow.mockResolvedValue({
      data: null,
      error: { message: 'nope', code: 'PGRST205' },
    });

    await Promise.all([readPortalPulse(), readPortalPulse(), readPortalPulse()]);
    expect(logged).toEqual([]);
  });

  it('answers null when the read fails outright', async () => {
    readPulseRow.mockRejectedValue(new Error('connection reset'));
    expect(await readPortalPulse()).toBeNull();
  });

  it('still reports a failure that is not the missing table', async () => {
    readPulseRow.mockResolvedValue({
      data: null,
      error: { message: 'connection reset', code: '08006' },
    });

    expect(await readPortalPulse()).toBeNull();
    expect(logged).toHaveLength(1);
  });

  it('answers null rather than inventing a revision for a missing row', async () => {
    readPulseRow.mockResolvedValue({ data: null, error: null });
    expect(await readPortalPulse()).toBeNull();
  });

  it('does not confuse revision zero with a failure', async () => {
    // The counter starts at 0, so a fresh install must not be read as "unknown"
    // and refresh forever.
    readPulseRow.mockResolvedValue({ data: { revision: 0 }, error: null });
    expect(await readPortalPulse()).toBe('0');
  });
});
