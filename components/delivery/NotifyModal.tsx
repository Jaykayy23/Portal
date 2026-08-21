'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { smsLink, waLink } from '@/lib/phone';
import {
  TRIGGER_TITLE,
  linkNeededFor,
  outboundFor,
  triggerForStatus,
  type OutboundMessage,
} from '@/lib/deliveryMessages';
import type { DeliveryWithMerchant, LinkPurpose } from '@/lib/types';

function NotifyContact({
  message,
  /** While true the send links are held back — the text isn't final yet. */
  pending,
  pendingLabel,
  children,
}: {
  message: OutboundMessage;
  pending?: boolean;
  pendingLabel?: string;
  children?: React.ReactNode;
}) {
  const wa = waLink(message.phone, message.text);
  const sms = smsLink(message.phone, message.text);

  if (!wa || !sms) {
    return (
      <div className="somo-notify-contact">
        <div className="who">{message.who}</div>
        <div className="unavailable">No phone number on file — nothing to send.</div>
      </div>
    );
  }

  return (
    <div className="somo-notify-contact">
      <div className="who">{message.who}</div>
      <div className="num">{message.phone}</div>
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

interface MintedLink {
  url: string;
  expiresAt: string;
}

/** The minted link, shown so ops can see what they are about to send. */
function LinkBox({ link, onCopy }: { link: MintedLink; onCopy: () => void }) {
  return (
    <div className="somo-notify-link">
      <div className="label">
        Link — expires {fmtDateTime(link.expiresAt)}
        <button type="button" onClick={onCopy}>
          Copy
        </button>
      </div>
      <div className="url">{link.url}</div>
    </div>
  );
}

/**
 * The alerts for wherever this delivery has just got to.
 *
 * Which messages appear is decided by the delivery's status, not by the button
 * that opened the modal: a row sitting at 'Recipient confirmed' offers the
 * rider's completion link whether it was opened from the log or from the
 * attention queue. lib/deliveryMessages.ts owns the wording.
 *
 * The link a step needs is minted on mount rather than when the delivery moved,
 * so it is always fresh in the message about to be sent — and every send button
 * for that step is held back until it arrives, because a job offer with no
 * accept/decline link is the exact failure this flow exists to prevent.
 */
function NotifyBody({
  record,
  opsPhone,
  onClose,
}: {
  record: DeliveryWithMerchant;
  opsPhone: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const trigger = triggerForStatus(record);
  const needed: LinkPurpose | null = linkNeededFor(trigger);

  const [link, setLink] = useState<MintedLink | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!needed) return;

    let cancelled = false;
    setLink(null);
    setError('');

    api<MintedLink>(`/deliveries/${record.id}/links`, {
      method: 'POST',
      body: { purpose: needed },
    })
      .then((data) => {
        if (!cancelled) setLink(data);
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      });

    return () => {
      cancelled = true;
    };
  }, [record.id, needed]);

  const messages = outboundFor(trigger, record, {
    opsPhone,
    merchantPhone: record.merchantPhone || '',
    links: needed && link ? { [needed]: link.url } : {},
  });

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast('Link copied');
    } catch {
      toast('Could not copy — select the link and copy it by hand.', 'danger');
    }
  }

  return (
    <Modal
      open
      wide
      title={TRIGGER_TITLE[trigger]}
      description="These open WhatsApp or your SMS app with the message pre-filled — tap send there to actually deliver it. No message leaves this device until you do."
      closeLabel="Close"
      onClose={onClose}
    >
      {messages.map((message) => {
        const waitingForLink = !!message.needsLink && !link && !error;
        return (
          <NotifyContact
            key={message.id}
            message={message}
            pending={waitingForLink}
            pendingLabel="Preparing link…"
          >
            {message.needsLink && link ? <LinkBox link={link} onCopy={copyLink} /> : null}
            {message.needsLink && error ? (
              <div className="somo-notify-link-error">Link unavailable — {error}</div>
            ) : null}
          </NotifyContact>
        );
      })}

      {messages.length === 0 ? (
        <div className="somo-notify-contact">
          <div className="who">Nothing to send</div>
          <div className="unavailable">This delivery has no outstanding alerts.</div>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Alerts are deep links, not automated sends: the message is pre-filled and a
 * human taps send in WhatsApp or their SMS app. Nothing leaves the device until
 * they do — lib/deliveryMessages.ts is written so a provider API can be dropped
 * in behind the same message list when one is available.
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

  // Keyed on both, so moving a delivery forward and re-opening mints the link for
  // the new step instead of reusing the last one's state.
  return (
    <NotifyBody
      key={`${record.id}:${record.status}`}
      record={record}
      opsPhone={opsPhone}
      onClose={onClose}
    />
  );
}
