import { describe, expect, it } from 'vitest';
import {
  TRIGGER_ON_ENTERING,
  linkNeededFor,
  outboundFor,
  triggerForStatus,
  type NotifyTrigger,
} from '@/lib/deliveryMessages';
import { DELIVERY_STATUSES, type DeliveryStatus, type DeliveryWithMerchant } from '@/lib/types';

/**
 * These are about the automatic sender, not about wording.
 *
 * Alerts now go out on the transition itself, which makes two tables in this
 * module load-bearing in a way they were not when a person pressed send: one
 * decides who gets texted when a delivery arrives somewhere, and the other
 * decides which capability link has to be minted first. Both are quiet to get
 * wrong — the failure is a message that goes to the wrong person, or a job offer
 * with no way to answer it, and neither shows up on a screen.
 */

const RECORD: DeliveryWithMerchant = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  date: '2026-08-27T09:00:00.000Z',
  customer: 'Obra Chop Bar',
  recipientName: 'Kwame',
  recipientPhone: '0255555555',
  merchantId: 'merchant-1',
  merchantPhone: '0201111111',
  submittedBy: 'user-1',
  pickup: 'Osu, Accra',
  dropoff: 'East Legon, Accra',
  distance: 12.9,
  durationMin: 22,
  type: 'Standard',
  itemCategory: 'Food',
  surcharges: [],
  declaredValue: 200,
  itemPayment: 'Cash on delivery',
  deliveryPaidBy: 'Customer',
  price: 38,
  status: 'Pending',
  riderId: 'rider-1',
  riderName: 'Aba',
  riderPhone: '0577004739',
  riderReg: 'GT 654',
  riderModel: 'Boxer',
  acceptedAt: '',
  declinedAt: '',
  pickedUpAt: '',
  recipientConfirmedAt: '',
  deliveredAt: '',
};

describe('TRIGGER_ON_ENTERING — what a status change announces on its own', () => {
  // The regression this guards. Taking a rider off a job sends the delivery back
  // to 'Requested', and 'Requested' reads as 'created' when the Notify modal is
  // opened on it — correctly, because the message says "please assign a rider".
  // Firing it automatically as well would text ops "New SomoExpress delivery
  // request" every time someone corrected an assignment.
  it.each(['Requested', 'Approved'] as DeliveryStatus[])(
    'stays silent when a delivery lands back in %s',
    (status) => {
      expect(TRIGGER_ON_ENTERING[status]).toBeUndefined();
      // …while the modal still has something to offer for that row.
      expect(triggerForStatus({ ...RECORD, status })).toBe('created');
    }
  );

  it.each([
    ['Pending', 'offered'],
    ['Declined', 'declined'],
    ['Assigned', 'accepted'],
    ['Picked up', 'picked-up'],
    ['Recipient confirmed', 'recipient-confirmed'],
    ['Delivered', 'delivered'],
  ] as [DeliveryStatus, NotifyTrigger][])('announces %s as "%s"', (status, trigger) => {
    expect(TRIGGER_ON_ENTERING[status]).toBe(trigger);
  });

  // Every status is accounted for one way or the other. A status added later
  // without a decision here would send nothing and look like it was handled.
  it('has a decision recorded for every delivery status', () => {
    for (const status of DELIVERY_STATUSES) {
      expect(Object.prototype.hasOwnProperty.call(TRIGGER_ON_ENTERING, status)).toBe(
        status !== 'Requested' && status !== 'Approved'
      );
    }
  });
});

describe('linkNeededFor — the link an automatic alert must mint first', () => {
  // The sender mints a link only when a message it is actually sending carries
  // one, and it decides that by asking these two in agreement. If a message
  // declares `needsLink` for a purpose this function does not name, no link is
  // minted and the message goes out with an empty URL in it.
  it.each([
    'created',
    'offered',
    'declined',
    'accepted',
    'picked-up',
    'recipient-confirmed',
    'delivered',
  ] as NotifyTrigger[])('agrees with the composed messages for "%s"', (trigger) => {
    const needed = linkNeededFor(trigger);
    const carried = outboundFor(trigger, RECORD, {
      opsPhone: '0209999999',
      merchantPhone: RECORD.merchantPhone ?? '',
      links: {},
    })
      .map((m) => m.needsLink)
      .filter(Boolean);

    if (needed === null) {
      expect(carried).toEqual([]);
    } else {
      // At most one per trigger — that is what lets the sender mint once.
      expect(carried).toEqual([needed]);
    }
  });
});
