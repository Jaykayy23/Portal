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
import type { DeliveryWithMerchant, LinkPurpose, SentAlert } from '@/lib/types';

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
  /** BMS campaign id, for looking the send up in their dashboard. */
  campaignId: string;
  /** Billable SMS parts this message cost. */
  parts: number;
  /** Credits left on the account afterwards, or -1 when BMS did not say. */
  creditLeft: number;
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
  /** The last time the portal sent this message, if it ever has. */
  already,
  onSend,
  children,
}: {
  message: OutboundMessage;
  pending?: boolean;
  pendingLabel?: string;
  channel: SmsChannel | null;
  sending: boolean;
  result: SendResult | undefined;
  already: SentAlert | undefined;
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
          {/* What the portal has already done with this message, before offering
              to do it again. With alerts going out on the transition itself, this
              is the normal state of every contact in this modal — the send button
              below is a second message, and it should read like one. */}
          {!result && already ? (
            already.ok ? (
              <div className="somo-notify-confirmed">
                {already.automatic ? 'Sent automatically' : 'Sent by hand'} {fmtDateTime(already.sentAt)}{' '}
                — {already.parts} credit{already.parts === 1 ? '' : 's'} used.
              </div>
            ) : (
              <div className="somo-notify-link-error">
                Did not send {fmtDateTime(already.sentAt)} — {already.error}
              </div>
            )
          ) : null}

          <div className="btns">
            {/* The portal's own send leads when it is available, because it is the
                one that needs no second app and no second tap. The deep links stay
                beside it rather than being replaced: they are what works when
                the provider is down, when a rider only reads WhatsApp, and when whoever
                is sending wants the message to come from their own number. */}
            {channel?.enabled ? (
              <button type="button" className="wa" onClick={onSend} disabled={sending}>
                {sending ? <Spinner /> : null}
                {sending
                  ? 'Sending…'
                  : result?.ok || already?.ok
                    ? 'Send again'
                    : already
                      ? 'Try again'
                      : 'Send by SMS'}
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
              Sent by SMS — {result.parts} credit{result.parts === 1 ? '' : 's'} used
              {result.creditLeft >= 0 ? `, ${result.creditLeft} left on the account` : ''}.
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
 * What this modal is *for* has changed, and the code reads best if that is said
 * plainly. Alerts now go out on the transition itself (lib/autoNotify.ts), so by
 * the time anyone opens this, the rider has usually been offered the job and the
 * customer has usually been told the parcel is coming. Nothing here opens by
 * itself any more. It is opened deliberately, by someone who wants to know what
 * was sent — which is why the first thing each contact shows is the recorded
 * send, and only then a button to do it again.
 *
 * It stays the whole story for a portal with SMS switched off. There, nothing is
 * automatic, the WhatsApp and SMS deep links are the channel, and this modal
 * still opens by itself after an assignment or a pickup. The words are identical
 * either way: every path renders the same outboundFor() call the server composes
 * from, so there is no second copy of the wording to drift.
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
  /** The newest recorded send per message id. Empty until the log arrives. */
  const [history, setHistory] = useState<Record<string, SentAlert>>({});

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

  // What has already been sent for this delivery. The server returns every
  // recorded attempt newest first, so the first row for a message id is its
  // latest outcome and the rest are its history — which this screen has no room
  // for and no question that needs it.
  //
  // A failure here is silent on purpose: it means the modal shows no send
  // history, which is the state it was in before this existed, rather than an
  // error over a delivery flow that is working.
  useEffect(() => {
    let cancelled = false;
    api<{ sent: SentAlert[] }>(`/deliveries/${record.id}/notify`)
      .then(({ sent }) => {
        if (cancelled) return;
        const latest: Record<string, SentAlert> = {};
        for (const alert of sent) {
          if (!latest[alert.messageId]) latest[alert.messageId] = alert;
        }
        setHistory(latest);
      })
      .catch(() => {
        /* no history shown */
      });

    return () => {
      cancelled = true;
    };
  }, [record.id]);

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
          // This send is now the newest one, and it is already on screen as
          // `result`. Dropping the recorded row stops the two contradicting each
          // other — "did not send 14:02" sitting above "sent by SMS".
          setHistory((prev) => {
            const { [message.id]: _gone, ...rest } = prev;
            return rest;
          });
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
          ? 'The portal sends these by itself as a delivery moves, so they have normally gone already — each one says when. Send again if something did not arrive, or use WhatsApp to send it from this device.'
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
            already={history[message.id]}
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
          admin who has not set SMS up does not need telling on every row. */}
      {channel && !channel.enabled && channel.reason ? (
        <div className="somo-note">{channel.reason}</div>
      ) : null}
    </Modal>
  );
}

/**
 * Alerts go out one of two ways: through the SMS provider, when an admin has configured it
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
