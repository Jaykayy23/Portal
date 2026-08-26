'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/Spinner';
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

/** Whether the portal can send SMS itself. GET /api/sms — never a credential. */
interface SmsChannel {
  enabled: boolean;
  reason: string;
}

/** One message's fate, as POST /api/deliveries/[id]/notify reports it. */
interface SendResult {
  id: string;
  who: string;
  phone: string;
  ok: boolean;
  sid: string;
  status: string;
  segments: number;
  error: string;
}

interface MintedLink {
  url: string;
  expiresAt: string;
}

function NotifyContact({
  message,
  /** While true the send controls are held back — the text isn't final yet. */
  pending,
  pendingLabel,
  /** Null while the portal is still finding out whether it can send. */
  channel,
  sending,
  result,
  onSend,
  children,
}: {
  message: OutboundMessage;
  pending?: boolean;
  pendingLabel?: string;
  channel: SmsChannel | null;
  sending: boolean;
  result: SendResult | undefined;
  onSend: () => void;
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
        <>
          <div className="btns">
            {/* The portal's own send leads when it is available, because it is the
                one that needs no second app and no second tap. The deep links stay
                beside it rather than being replaced: they are what works when
                Twilio is down, when a rider only reads WhatsApp, and when whoever
                is sending wants the message to come from their own number. */}
            {channel?.enabled ? (
              <button type="button" className="wa" onClick={onSend} disabled={sending}>
                {sending ? <Spinner /> : null}
                {sending ? 'Sending…' : result?.ok ? 'Send again' : 'Send by SMS'}
              </button>
            ) : null}
            <a className="wa" href={wa} target="_blank" rel="noopener noreferrer">
              Open WhatsApp
            </a>
            <a className="sms" href={sms}>
              Open SMS
            </a>
          </div>

          {result?.ok ? (
            <div className="somo-notify-confirmed">
              Sent by SMS — Twilio says “{result.status}”
              {result.segments > 1 ? `, ${result.segments} parts` : ''}.
            </div>
          ) : null}
          {result && !result.ok ? (
            <div className="somo-notify-link-error">Not sent — {result.error}</div>
          ) : null}
        </>
      )}
    </div>
  );
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
 * so it is always fresh in the message about to be sent — and every send control
 * for that step is held back until it arrives, because a job offer with no
 * accept/decline link is the exact failure this flow exists to prevent.
 *
 * Two ways out, and only one of them is new. If an admin has configured Twilio
 * under Settings, "Send by SMS" posts to the server and the server sends. If not
 * — or as well — the WhatsApp and SMS deep links are what they always were. The
 * words are identical either way: both are rendered from the same
 * outboundFor() call the server composes from, so there is no second copy of the
 * wording to drift.
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
  const [channel, setChannel] = useState<SmsChannel | null>(null);
  const [sending, setSending] = useState('');
  const [results, setResults] = useState<Record<string, SendResult>>({});

  /**
   * One idempotency key per message, minted on the first attempt and dropped once
   * it succeeds. A retry after a lost response replays the first send instead of
   * texting a customer twice; pressing "Send again" deliberately is a new key and
   * a real second message.
   */
  const sendKeys = useRef<Record<string, string>>({});

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

  // Asked on open rather than threaded down from the page, because this modal is
  // opened from three different trees (the log, the attention bell, the New
  // delivery form) and each would otherwise have to carry the answer. A failure
  // here is treated as "no SMS": the deep links below still work, which is the
  // right thing to fall back to.
  useEffect(() => {
    let cancelled = false;
    api<SmsChannel>('/sms')
      .then((data) => {
        if (!cancelled) setChannel(data);
      })
      .catch(() => {
        if (!cancelled) setChannel({ enabled: false, reason: '' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * Sends one message through the portal.
   *
   * The text is not sent up. The request names the message and the server
   * composes it from the delivery row — see the Route Handler for why that is the
   * whole point rather than an optimisation.
   */
  async function send(message: OutboundMessage) {
    setSending(message.id);
    try {
      if (!sendKeys.current[message.id]) sendKeys.current[message.id] = crypto.randomUUID();

      const data = await api<{ link: MintedLink | null; results: SendResult[] }>(
        `/deliveries/${record.id}/notify`,
        {
          method: 'POST',
          idempotencyKey: sendKeys.current[message.id],
          body: { only: [message.id] },
        }
      );

      // The server mints its own link, so what is on screen becomes the URL that
      // actually went out rather than a second one nobody was sent.
      if (data.link) setLink(data.link);

      const result = data.results.find((r) => r.id === message.id);
      if (result) {
        setResults((prev) => ({ ...prev, [message.id]: result }));
        if (result.ok) {
          // Consumed: the next press is a deliberate second message.
          delete sendKeys.current[message.id];
          toast(`Sent to ${result.who}`);
        } else {
          toast(result.error, 'danger');
        }
      }
    } catch (e) {
      toast(errMessage(e), 'danger');
    }
    setSending('');
  }

  return (
    <Modal
      open
      wide
      title={TRIGGER_TITLE[trigger]}
      description={
        channel?.enabled
          ? 'Send by SMS goes out from the portal’s Twilio number straight away. The WhatsApp and SMS buttons open the message on this device instead, for you to tap send there.'
          : 'These open WhatsApp or your SMS app with the message pre-filled — tap send there to actually deliver it. No message leaves this device until you do.'
      }
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
            channel={channel}
            sending={sending === message.id}
            result={results[message.id]}
            onSend={() => send(message)}
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

      {/* Said once, at the bottom, and only when there is something to say: an
          admin who has not set Twilio up does not need telling on every row. */}
      {channel && !channel.enabled && channel.reason ? (
        <div className="somo-note">{channel.reason}</div>
      ) : null}
    </Modal>
  );
}

/**
 * Alerts go out one of two ways: through Twilio, when an admin has configured it
 * under Settings, or as a pre-filled deep link a human taps send on. Both send
 * the same words — lib/deliveryMessages.ts composes them, and the server composes
 * from the same function rather than trusting anything this component sends up.
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
