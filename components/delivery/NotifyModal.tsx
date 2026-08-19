'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime, shortId } from '@/lib/format';
import { smsLink, waLink } from '@/lib/phone';
import type { DeliveryWithMerchant } from '@/lib/types';

function NotifyContact({
  who,
  phone,
  message,
  /** While true the send links are held back — the message isn't final yet. */
  pending,
  pendingLabel,
  children,
}: {
  who: string;
  phone: string;
  message: string;
  pending?: boolean;
  pendingLabel?: string;
  children?: React.ReactNode;
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
      {children}
      {pending ? (
        <div className="somo-notify-pending">{pendingLabel || 'Preparing…'}</div>
      ) : (
        <div className="btns">
          <a className="wa" href={wa} target="_blank" rel="noopener noreferrer">
            Open WhatsApp
          </a>
          <a className="sms" href={sms}>
            Open SMS
          </a>
        </div>
      )}
    </div>
  );
}

interface CompletionLink {
  url: string;
  expiresAt: string;
}

/**
 * The rider's block, which is the only one that carries a completion link.
 *
 * The link is minted when this mounts rather than when the delivery is assigned,
 * so it is always fresh in the message about to be sent — a token issued days
 * earlier and left in a stale modal would already be half-expired. Sending is
 * held back until it arrives: a rider message without the link is the exact
 * failure this feature exists to prevent.
 */
function RiderContact({ record }: { record: DeliveryWithMerchant }) {
  const toast = useToast();
  const [link, setLink] = useState<CompletionLink | null>(null);
  const [error, setError] = useState('');

  // A delivery the rider has already confirmed gets no new link: redeeming a
  // second one would re-stamp a finished job with a later time. The server
  // refuses too — this only saves the round trip and says so plainly.
  const alreadyConfirmed = !!record.deliveredAt;

  useEffect(() => {
    if (alreadyConfirmed) return;

    let cancelled = false;
    setLink(null);
    setError('');

    api<CompletionLink>(`/deliveries/${record.id}/completion-link`, { method: 'POST' })
      .then((data) => {
        if (!cancelled) setLink(data);
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      });

    return () => {
      cancelled = true;
    };
  }, [record.id, alreadyConfirmed]);

  const sid = shortId(record.id);
  const item = record.itemCategory ? ` Item: ${record.itemCategory}.` : '';
  // The whole point of collecting the recipient: the rider can call ahead rather
  // than stand at a gate. Dropped for rows filed before the field existed.
  const recipient = record.recipientName
    ? ` Recipient: ${record.recipientName} (${record.recipientPhone}).`
    : '';
  const base = `New SomoExpress delivery assigned to you. Order #${sid}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}.${recipient} Merchant: ${record.customer}.${item} Declared value: GHS ${record.declaredValue}. Type: ${record.type}. Please confirm pickup.`;

  // If the link could not be minted the alert still goes out — a rider who knows
  // about the job without a link beats a rider who hears nothing at all.
  const message = link
    ? `${base} When you have handed the parcel over, tap this link to confirm the delivery is complete: ${link.url}`
    : base;

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast('Completion link copied');
    } catch {
      toast('Could not copy — select the link and copy it by hand.');
    }
  }

  return (
    <NotifyContact
      who={`Rider — ${record.riderName}`}
      phone={record.riderPhone}
      message={message}
      pending={!link && !error && !alreadyConfirmed}
      pendingLabel="Preparing completion link…"
    >
      {alreadyConfirmed ? (
        <div className="somo-notify-confirmed">
          ✓ Rider confirmed this delivered on {fmtDateTime(record.deliveredAt)}.
        </div>
      ) : null}
      {link ? (
        <div className="somo-notify-link">
          <div className="label">
            Completion link — expires {fmtDateTime(link.expiresAt)}
            <button type="button" onClick={copyLink}>
              Copy
            </button>
          </div>
          <div className="url">{link.url}</div>
        </div>
      ) : null}
      {error ? (
        <div className="somo-notify-link-error">Completion link unavailable — {error}</div>
      ) : null}
    </NotifyContact>
  );
}

/**
 * Alerts are deep links, not automated sends: the message is pre-filled and a
 * human taps send in WhatsApp or their SMS app. Nothing leaves the device until
 * they do — see the README on wiring up a provider API for unattended sending.
 *
 * The rider's message is the exception in one respect: it carries a link the
 * portal issued, and tapping it is what marks the delivery complete.
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
          {/* Keyed on the delivery so switching rows mints a link for the new
              one instead of reusing the last row's state. */}
          <RiderContact key={record.id} record={record} />
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
