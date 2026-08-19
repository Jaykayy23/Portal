'use client';

import { Modal } from '@/components/Modal';
import { shortId } from '@/lib/format';
import { smsLink, waLink } from '@/lib/phone';
import type { DeliveryWithMerchant } from '@/lib/types';

function NotifyContact({
  who,
  phone,
  message,
}: {
  who: string;
  phone: string;
  message: string;
}) {
  const wa = waLink(phone, message);
  const sms = smsLink(phone, message);

  if (!wa || !sms) {
    return (
      <div className="somo-notify-contact">
        <div className="who">{who}</div>
        <div className="unavailable">No phone number on file — nothing to send.</div>
      </div>
    );
  }

  return (
    <div className="somo-notify-contact">
      <div className="who">{who}</div>
      <div className="num">{phone}</div>
      <div className="btns">
        <a className="wa" href={wa} target="_blank" rel="noopener noreferrer">
          Open WhatsApp
        </a>
        <a className="sms" href={sms}>
          Open SMS
        </a>
      </div>
    </div>
  );
}

/**
 * Alerts are deep links, not automated sends: the message is pre-filled and a
 * human taps send in WhatsApp or their SMS app. Nothing leaves the device until
 * they do — see the README on wiring up a provider API for unattended sending.
 */
export function NotifyModal({
  record,
  opsPhone,
  onClose,
}: {
  record: DeliveryWithMerchant | null;
  opsPhone: string;
  onClose: () => void;
}) {
  if (!record) return null;

  const sid = shortId(record.id);
  const hasRider = !!record.riderId;
  // Rows filed before item categories existed have none, so the sentence is
  // dropped rather than sent half-empty.
  const item = record.itemCategory ? ` Item: ${record.itemCategory}.` : '';

  const opsMessage = hasRider
    ? `SomoExpress order #${sid} assigned. Rider: ${record.riderName} (${record.riderPhone}). Customer: ${record.customer}. Route: ${record.pickup} -> ${record.dropoff}.`
    : `New SomoExpress delivery request #${sid}: ${record.customer} — ${record.pickup} -> ${record.dropoff} (${record.distance.toFixed(1)}km${record.durationMin > 0 ? `, ~${record.durationMin.toFixed(0)}min` : ''}).${item} Declared value GHS ${record.declaredValue}. Recommended GHS ${record.recommended.toFixed(2)}, agreed GHS ${record.agreed.toFixed(2)}. Please assign a rider.`;

  const riderMessage = `New SomoExpress delivery assigned to you. Order #${sid}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}. Customer: ${record.customer}.${item} Declared value: GHS ${record.declaredValue}. Type: ${record.type}. Please confirm pickup.`;

  const merchantMessage = `Your SomoExpress delivery (order #${sid}) has been assigned to rider ${record.riderName}, phone ${record.riderPhone}, riding a ${record.riderModel || 'motorbike'} (reg. ${record.riderReg || 'n/a'}). Pickup location: ${record.pickup}. Drop-off: ${record.dropoff}.`;

  return (
    <Modal
      open
      wide
      title="Send delivery alerts"
      description="These open WhatsApp or your SMS app with the message pre-filled — tap send there to actually deliver it. No message leaves this device until you do."
      closeLabel="Close"
      onClose={onClose}
    >
      <NotifyContact who="Ops team" phone={opsPhone} message={opsMessage} />
      {hasRider ? (
        <>
          <NotifyContact
            who={`Rider — ${record.riderName}`}
            phone={record.riderPhone}
            message={riderMessage}
          />
          <NotifyContact
            who={`Merchant — ${record.customer}`}
            phone={record.merchantPhone || ''}
            message={merchantMessage}
          />
        </>
      ) : (
        <div className="somo-notify-contact">
          <div className="who">Rider &amp; merchant</div>
          <div className="unavailable">
            Assign a rider to this order to notify the rider and the merchant.
          </div>
        </div>
      )}
    </Modal>
  );
}
