'use client';

import { useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

/** The green "this is done" block, shared by both routes into it. */
export function ConfirmedNote({ confirmedAt }: { confirmedAt: string }) {
  return (
    <div className="somo-confirm-done">
      <div className="tick" aria-hidden="true">
        ✓
      </div>
      <div className="big">Delivery confirmed</div>
      <div className="when">Recorded {fmtDateTime(confirmedAt)}</div>
      <div className="after">
        Ops can see it as delivered. Nothing else to do — you can close this page.
      </div>
    </div>
  );
}

/**
 * The rider's one button.
 *
 * Confirming is not undoable from here on purpose: a rider who taps it by
 * mistake calls ops, who can set the status back in the log. Giving the page an
 * "actually, no" button would mean a link that can also un-deliver a delivery,
 * which is a much less comfortable thing to leave in a WhatsApp thread.
 */
export function ConfirmDelivery({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState('');
  const [error, setError] = useState('');

  if (confirmedAt) return <ConfirmedNote confirmedAt={confirmedAt} />;

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ confirmedAt: string }>(
        `/delivery-confirm/${encodeURIComponent(token)}`,
        { method: 'POST' }
      );
      setConfirmedAt(data.confirmedAt);
    } catch (e) {
      // Riders are on phone data at the roadside, so a failure has to say what
      // to do next rather than just that something went wrong.
      setError(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <div className="somo-confirm-error">{error}</div> : null}
      <button type="button" className="somo-btn" onClick={confirm} disabled={busy}>
        {busy ? 'Confirming…' : "I've delivered this"}
      </button>
      <div className="somo-confirm-hint">
        Only tap this once the parcel is with the customer.
      </div>
    </>
  );
}
