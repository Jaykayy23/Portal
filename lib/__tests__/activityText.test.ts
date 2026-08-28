import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  actionLabel,
  actorName,
  describeActivity,
  humanFields,
  isActivityAction,
} from '@/lib/activityText';
import type { ActivityEntry } from '@/lib/types';

/**
 * These are about what the audit line says, which is the only thing this module
 * does and the only thing it can get wrong in a way nobody notices.
 *
 * The failure mode worth guarding is not an ugly sentence — it is a line that
 * quietly says nothing. "Kojo updated #4F2A1" is indistinguishable from a
 * correct log until the day somebody needs to know what was updated, and by then
 * the row is months old and the answer is gone. So the assertions here are about
 * the *facts* each sentence carries, not its phrasing.
 */

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: '1',
    at: '2026-08-28T09:00:00.000Z',
    actorId: 'a1b2c3d4-0000-4000-8000-000000000001',
    actorUsername: 'kojo',
    actorRole: 'admin',
    action: 'auth.signed_in',
    entityType: '',
    entityId: '',
    entityLabel: '',
    details: {},
    ...over,
  };
}

describe('describeActivity', () => {
  it('names both ends of a status change, not just the delivery', () => {
    const line = describeActivity(
      entry({
        action: 'delivery.status_changed',
        entityLabel: 'SME4f2a1',
        details: { from: 'Requested', to: 'Pending' },
      })
    );

    expect(line).toContain('SME4f2a1');
    expect(line).toContain('Requested');
    expect(line).toContain('Pending');
  });

  it('names the rider taken off a delivery, who is no longer on the row', () => {
    // The whole reason patchDelivery carries previousRiderName out: after the
    // write there is nobody left on the delivery to name.
    const line = describeActivity(
      entry({
        action: 'delivery.rider_cleared',
        entityLabel: 'SME4f2a1',
        details: { rider: 'Yaw Mensah' },
      })
    );

    expect(line).toContain('Yaw Mensah');
    expect(line).toContain('SME4f2a1');
  });

  it('falls back to "the rider" rather than an empty gap', () => {
    const line = describeActivity(
      entry({ action: 'delivery.rider_cleared', entityLabel: 'SME4f2a1', details: {} })
    );

    expect(line).toBe('took the rider off SME4f2a1');
  });

  it('quotes a void reason verbatim — it is the only account of why', () => {
    const line = describeActivity(
      entry({
        action: 'settlement.voided',
        entityLabel: '#8c1d2',
        details: { reason: 'Counted twice at close of shift' },
      })
    );

    expect(line).toContain('Counted twice at close of shift');
  });

  it('pluralises counts, including the nouns an s does not fix', () => {
    const one = describeActivity(
      entry({ action: 'delivery.exported', details: { rows: 1 } })
    );
    const many = describeActivity(
      entry({ action: 'delivery.exported', details: { rows: 412 } })
    );
    const categories = describeActivity(
      entry({ action: 'delivery_options.updated', details: { categories: 3 } })
    );

    expect(one).toContain('1 delivery');
    expect(many).toContain('412 deliveries');
    expect(categories).toContain('3 categories');
  });

  it('shows an unknown action rather than dropping the line', () => {
    // A row written by a newer deploy. A missing line in an audit log is worse
    // than an ugly one, so the action name itself is the fallback.
    const line = describeActivity(
      entry({ action: 'invoice.raised', entityLabel: '#0099' })
    );

    expect(line).toContain('invoice.raised');
    expect(line).toContain('#0099');
  });

  it('survives details that are missing or the wrong type', () => {
    // details is jsonb: nothing in the database guarantees the shape a build
    // from six months ago wrote, and a thrown TypeError here takes the whole
    // page down rather than one row.
    const line = describeActivity(
      entry({
        action: 'delivery.status_changed',
        entityLabel: 'SME4f2a1',
        details: { from: { was: 'Requested' }, to: null } as Record<string, unknown>,
      })
    );

    expect(typeof line).toBe('string');
  });

  it('has a sentence for every action the portal can write', () => {
    // The guard against adding an action to the catalogue and forgetting the
    // branch — which would ship as a line reading `did "delivery.whatever"`.
    for (const action of ACTIVITY_ACTIONS) {
      const line = describeActivity(entry({ action, entityLabel: 'SME4f2a1' }));
      expect(line, action).not.toContain('did "');
    }
  });
});

describe('actorName', () => {
  it('uses the snapshotted username, not a join', () => {
    expect(actorName(entry({ actorUsername: 'ama' }))).toBe('ama');
  });

  it('says so when the account is gone rather than showing a blank', () => {
    expect(actorName(entry({ actorUsername: '', actorId: null }))).toMatch(/no longer/i);
  });
});

describe('isActivityAction', () => {
  it('accepts the catalogue and rejects anything else', () => {
    expect(isActivityAction('delivery.created')).toBe(true);
    // A stale bookmark or a hand-edited URL: the page drops it and shows
    // everything rather than an unexplained empty table.
    expect(isActivityAction('delivery.deleted')).toBe(false);
    expect(isActivityAction('')).toBe(false);
  });
});

describe('actionLabel and humanFields', () => {
  it('drops the noun and reads the verb back', () => {
    expect(actionLabel('delivery.rider_assigned')).toBe('Rider assigned');
    expect(actionLabel('auth.signed_in')).toBe('Signed in');
  });

  it('splits camelCase field names into words', () => {
    expect(humanFields(['base', 'perMin', 'bookingFee'])).toBe('base, per min, booking fee');
  });
});
