'use client';

import { useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Spinner } from '@/components/Spinner';
import type { LinkAction, LinkOutcome, LinkPurpose } from '@/lib/types';

/** What the holder is told once they — or someone before them — have answered. */
export function OutcomeNote({
  purpose,
  outcome,
  usedAt,
}: {
  purpose: LinkPurpose;
  outcome: LinkOutcome | null;
  usedAt: string;
}) {
  const declined = outcome === 'declined';

  const heading = declined
    ? 'Job declined'
    : purpose === 'rider-response'
      ? 'Job accepted'
      : purpose === 'recipient-confirm'
        ? 'Receipt confirmed'
        : 'Delivery confirmed';

  const after = declined
    ? 'The ops team has been told and will offer this job to another rider.'
    : purpose === 'rider-response'
      ? 'Collect the parcel from the pickup address. The merchant confirms once you have it.'
      : purpose === 'recipient-confirm'
        ? 'Thank you. The merchant and the ops team have this on record.'
        : 'Ops can see it as delivered. Nothing else to do — you can close this page.';

  return (
    <div className={`somo-confirm-done${declined ? ' declined' : ''}`}>
      <div className="tick" aria-hidden="true">
        {declined ? '×' : '✓'}
      </div>
      <div className="big">{heading}</div>
      {usedAt ? <div className="when">Recorded {fmtDateTime(usedAt)}</div> : null}
      <div className="after">{after}</div>
    </div>
  );
}

/**
 * The holder's buttons.
 *
 * None of this is undoable from here, on purpose: a rider who taps Decline by
 * mistake calls ops, who reassign the job to them. Giving the page a second
 * button that un-declines would mean a link sitting in a WhatsApp thread that can
 * flip a delivery back and forth.
 */
export function LinkActions({ token, purpose }: { token: string; purpose: LinkPurpose }) {
  const [busy, setBusy] = useState<LinkAction | null>(null);
  const [done, setDone] = useState<{ outcome: LinkOutcome; usedAt: string } | null>(null);
  const [error, setError] = useState('');

  if (done) {
    return <OutcomeNote purpose={purpose} outcome={done.outcome} usedAt={done.usedAt} />;
  }

  async function take(action: LinkAction) {
    setBusy(action);
    setError('');
    try {
      const data = await api<{ outcome: LinkOutcome; usedAt: string }>(
        `/delivery-link/${encodeURIComponent(token)}`,
        { method: 'POST', body: { action } }
      );
      setDone(data);
    } catch (e) {
      // Riders and customers are on phone data at the roadside, so a failure has
      // to say what to do next rather than just that something went wrong.
      setError(errMessage(e));
      setBusy(null);
    }
  }

  const errorBox = error ? <div className="somo-confirm-error">{error}</div> : null;

  if (purpose === 'rider-response') {
    return (
      <>
        {errorBox}
        <button
          type="button"
          className="somo-btn"
          onClick={() => take('accept')}
          disabled={busy !== null}
        >
          {busy === 'accept' ? <Spinner /> : null}
          {busy === 'accept' ? 'Accepting…' : 'Accept this job'}
        </button>
        <button
          type="button"
          className="somo-btn decline"
          onClick={() => take('decline')}
          disabled={busy !== null}
        >
          {busy === 'decline' ? <Spinner /> : null}
          {busy === 'decline' ? 'Declining…' : "I can't take this one"}
        </button>
        <div className="somo-confirm-hint">
          Declining is final — ops will offer the job to another rider.
        </div>
      </>
    );
  }

  const label =
    purpose === 'recipient-confirm' ? 'I have received this' : "I've delivered this";
  const hint =
    purpose === 'recipient-confirm'
      ? 'Only tap this once the parcel is in your hands.'
      : 'Only tap this once the parcel is with the customer.';

  return (
    <>
      {errorBox}
      <button
        type="button"
        className="somo-btn"
        onClick={() => take('confirm')}
        disabled={busy !== null}
      >
        {busy ? <Spinner /> : null}
        {busy ? 'Confirming…' : label}
      </button>
      <div className="somo-confirm-hint">{hint}</div>
    </>
  );
}
