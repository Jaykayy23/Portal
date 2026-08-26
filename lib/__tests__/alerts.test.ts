import { describe, expect, it } from 'vitest';
import { ALERT_LIST_LIMIT, alertFeed, seatHasAlerts } from '@/lib/alerts';
import type { DeliveryStatus, DeliveryWithMerchant, Role, SessionUser } from '@/lib/types';

function user(role: Role): SessionUser {
  return {
    id: `user-${role}`,
    username: `${role}.one`,
    companyName: 'SomoExpress',
    role,
    active: true,
    phone: '0200000000',
  } as SessionUser;
}

/** Only `id`, `status` and the display fields matter here. */
function delivery(id: string, status: DeliveryStatus): DeliveryWithMerchant {
  return {
    id,
    status,
    customer: 'Obra Chop Bar',
    pickup: 'Osu',
    dropoff: 'Adenta',
    riderName: 'Aba',
  } as DeliveryWithMerchant;
}

describe('alertFeed', () => {
  it('gives ops the queue and merchants only their own handover step', () => {
    const records = [
      delivery('a', 'Requested'),
      delivery('b', 'Assigned'),
      delivery('c', 'Delivered'),
    ];

    const ops = alertFeed(user('ops'), records);
    expect(ops.total).toBe(2);
    expect(ops.items.map((i) => i.action)).toEqual([
      'Assign a rider',
      'Send the merchant the rider’s details',
    ]);
    expect(ops.items.every((i) => i.confirmPickup)).toBe(false);

    const merchant = alertFeed(user('merchant'), records);
    expect(merchant.total).toBe(1);
    expect(merchant.items[0].record.id).toBe('b');
    expect(merchant.items[0].confirmPickup).toBe(true);
  });

  /**
   * The regression this guard exists for. The log page redirects finance to the
   * ledger, so while the queue lived on that page the question never came up — but
   * the bell is in the topbar of every tab. Without the role check, finance (which
   * reads the whole business and is read-only by construction) would be told to
   * confirm the pickup of every assigned delivery in the country.
   */
  it('gives a read-only seat no alerts at all', () => {
    const records = [delivery('a', 'Assigned'), delivery('b', 'Requested')];

    expect(seatHasAlerts('finance')).toBe(false);
    expect(alertFeed(user('finance'), records)).toEqual({ keys: [], items: [], total: 0 });
  });

  it('caps the carried records but not the count', () => {
    const records = Array.from({ length: ALERT_LIST_LIMIT + 7 }, (_, i) =>
      delivery(`d-${i}`, 'Requested')
    );

    const feed = alertFeed(user('admin'), records);
    expect(feed.total).toBe(ALERT_LIST_LIMIT + 7);
    expect(feed.items).toHaveLength(ALERT_LIST_LIMIT);
    // Every outstanding key travels, because that is what "unread" is counted over.
    expect(feed.keys).toHaveLength(ALERT_LIST_LIMIT + 7);
  });

  it('keys an alert by status, so a row that moves on reads as a new alert', () => {
    const requested = alertFeed(user('ops'), [delivery('a', 'Requested')]);
    const declined = alertFeed(user('ops'), [delivery('a', 'Declined')]);

    expect(requested.keys).toEqual(['a|Requested']);
    expect(declined.keys).toEqual(['a|Declined']);
  });
});
