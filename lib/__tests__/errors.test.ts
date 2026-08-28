import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logFailure, userMessage } from '@/lib/errors';

const FALLBACK = 'Could not save that. Try again.';

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

/**
 * Every sentence in this list is raised by a function in supabase/migrations, in
 * wording chosen for the person who triggered it. Showing them is the point of
 * the exercise — a settlement refused for a reason the finance clerk can read is
 * worth more than any generic apology, so a change to the jargon filter that
 * starts swallowing these should fail here.
 */
const OUR_RULES = [
  'A settlement cannot be dated in the future.',
  'A settlement is with a rider or with a merchant, not both and not neither.',
  'A merchant may only confirm pickup, not edit a delivery.',
  'Order SME4f2a1 has already been settled for that part. Void the earlier settlement first if it was wrong.',
  'Order SME4f2a1 is prepaid — the merchant was paid for the goods directly, so there is nothing to settle.',
  'Order SME4f2a1: only GHS 12 is still owed on that part, so GHS 30 cannot be settled against it.',
  'The rider has not remitted the cash on order SME4f2a1 yet, so it cannot be paid out.',
  'Only money owed to us can be written off, so a write-off is always inbound.',
  'That account is no longer active.',
  'Say why this settlement is being voided.',
];

/**
 * And these are what the stack says when something breaks rather than when a
 * rule fires. None of it means anything to a merchant, and some of it describes
 * the shape of the database to someone who was never shown it.
 */
const PLUMBING = [
  { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
  { code: 'PGRST204', message: "Could not find the 'sms_api_key' column of 'app_settings' in the schema cache" },
  { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' },
  { code: '42703', message: 'column deliveries.item_category does not exist' },
  { code: '42P01', message: 'relation "public.settlements" does not exist' },
  { code: '42501', message: 'permission denied for table deliveries' },
  { code: '42501', message: 'new row violates row-level security policy for table "deliveries"' },
  { code: '23503', message: 'insert or update on table "deliveries" violates foreign key constraint "deliveries_rider_id_fkey"' },
  { code: '23502', message: 'null value in column "merchant_id" of relation "deliveries" violates not-null constraint' },
  { code: '22P02', message: 'invalid input syntax for type uuid: "not-an-id"' },
  { code: 'PGRST301', message: 'JWT expired' },
];

describe('userMessage', () => {
  it('shows a rule this app raised, in the words it was raised in', () => {
    for (const message of OUR_RULES) {
      expect(userMessage('test', { code: 'P0001', message }, FALLBACK)).toBe(message);
    }
    expect(logged).not.toHaveBeenCalled();
  });

  it('shows our own wording on the codes we raise deliberately', () => {
    // `raise exception … using errcode = 'foreign_key_violation'` / 'no_data_found'.
    expect(userMessage('test', { code: '23503', message: 'Unknown rider.' }, FALLBACK)).toBe(
      'Unknown rider.'
    );
    expect(userMessage('test', { code: 'P0002', message: 'Settlement not found.' }, FALLBACK)).toBe(
      'Settlement not found.'
    );
  });

  it('replaces anything the stack wrote about itself', () => {
    for (const error of PLUMBING) {
      const shown = userMessage('test', error, FALLBACK);
      expect(shown).toBe(FALLBACK);
      // The point of the whole module: none of it reaches the screen.
      expect(shown).not.toContain(error.message);
    }
  });

  it('logs every message it decides not to show', () => {
    userMessage('deliveries.createDelivery', { code: '23505', message: 'duplicate key value' }, FALLBACK);

    expect(logged).toHaveBeenCalledTimes(1);
    const [line, detail] = logged.mock.calls[0];
    expect(line).toContain('deliveries.createDelivery');
    expect(detail).toEqual({ code: '23505', message: 'duplicate key value' });
  });

  /**
   * Failing closed matters more here than being generous. An error with no
   * SQLSTATE came from somewhere that was never asked to write for an audience —
   * a fetch that never landed, a throw inside a library — so however sentence-like
   * it looks, nobody chose to show it to anyone.
   */
  it('says nothing for a failure of unknown provenance', () => {
    expect(userMessage('test', new Error('fetch failed'), FALLBACK)).toBe(FALLBACK);
    expect(userMessage('test', { message: 'That looks like a sentence.' }, FALLBACK)).toBe(FALLBACK);
    expect(userMessage('test', { code: 'P0001', message: '' }, FALLBACK)).toBe(FALLBACK);
    expect(userMessage('test', null, FALLBACK)).toBe(FALLBACK);
    expect(userMessage('test', undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe('logFailure', () => {
  it('keeps the whole error, which is where details and hint live', () => {
    const error = { code: 'PGRST116', message: 'no rows', details: 'Results contain 0 rows', hint: null };
    logFailure('settlements.recordSettlement', error);

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('settlements.recordSettlement'),
      error
    );
  });
});
