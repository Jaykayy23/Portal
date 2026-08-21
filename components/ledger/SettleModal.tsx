'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, shortId } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import {
  COMPANY,
  SETTLEMENT_METHODS,
  settleableSteps,
  type LedgerEntry,
  type SettlementStep,
} from '@/lib/ledger';

/** Who the money is changing hands with. Null closes the dialog. */
export interface SettleParty {
  kind: 'rider' | 'merchant';
  id: string;
  name: string;
}

/** One selectable obligation. */
interface Candidate {
  step: SettlementStep;
  entry: LedgerEntry;
}

function keyOf(step: SettlementStep): string {
  return `${step.deliveryId}:${step.stream}:${step.leg}`;
}

/** Local YYYY-MM-DD, which is what <input type="date"> speaks. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function SettleModal({
  party,
  entries,
  onClose,
  onDone,
}: {
  party: SettleParty | null;
  /** The rows currently on the ledger. Candidates are derived from these. */
  entries: LedgerEntry[];
  onClose: () => void;
  /** Called after a successful record, so the caller can refresh. */
  onDone: () => void;
}) {
  const toast = useToast();
  /**
   * What has been *unticked*, not what has been ticked.
   *
   * Inverted on purpose. Everything starts selected because settling a whole
   * float is the normal case, and holding the inverse means the list never has to
   * be seeded from the candidates — so a re-render that hands back a new
   * candidates array cannot silently reset somebody's choices, or the reference
   * they were half-way through typing. A row that appears after a refresh is
   * included by default, which is also the right default for a float.
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  /**
   * Held across retries, released on success.
   *
   * This is the endpoint where a lost response hurts most: the money really was
   * recorded, and a blind retry would be refused by the one-leg-one-settlement
   * index and read as a failure. Same key, same answer.
   */
  const submitKey = useRef('');

  const candidates = useMemo<Candidate[]>(() => {
    if (!party) return [];
    const steps = settleableSteps(
      entries,
      party.kind === 'rider' ? { riderId: party.id } : { merchantId: party.id }
    );
    const byId = new Map(entries.map((e) => [e.delivery.id, e]));
    return steps
      .map((step) => ({ step, entry: byId.get(step.deliveryId) }))
      .filter((c): c is Candidate => !!c.entry)
      .sort((a, b) => a.entry.delivery.date.localeCompare(b.entry.delivery.date));
  }, [party, entries]);

  // Keyed on the party rather than on the object, so re-opening the same rider's
  // dialog after a refresh does not count as a change.
  const partyKey = party ? `${party.kind}:${party.id}` : '';

  // A fresh form each time the dialog opens on somebody new, and only then.
  useEffect(() => {
    if (!partyKey) return;
    setExcluded(new Set());
    setReference('');
    setNote('');
    setWhen(todayKey());
    setMethod('Cash');
    submitKey.current = '';
  }, [partyKey]);

  const chosen = candidates.filter((c) => !excluded.has(keyOf(c.step)));
  const totalIn = chosen
    .filter((c) => c.step.leg === 'in')
    .reduce((sum, c) => sum + c.step.amount, 0);
  const totalOut = chosen
    .filter((c) => c.step.leg === 'out')
    .reduce((sum, c) => sum + c.step.amount, 0);
  const net = totalIn - totalOut;

  function toggle(step: SettlementStep) {
    setExcluded((was) => {
      const next = new Set(was);
      const key = keyOf(step);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setExcluded((was) =>
      was.size === 0 ? new Set(candidates.map((c) => keyOf(c.step))) : new Set()
    );
  }

  async function submit() {
    if (!party || chosen.length === 0) return;
    setBusy(true);
    try {
      if (!submitKey.current) submitKey.current = crypto.randomUUID();
      await api('/settlements', {
        method: 'POST',
        idempotencyKey: submitKey.current,
        body: {
          riderId: party.kind === 'rider' ? party.id : undefined,
          merchantId: party.kind === 'merchant' ? party.id : undefined,
          method,
          reference,
          note,
          // Only sent when it is not today: leaving it out lets the database
          // stamp `now()`, which is the honest value for a settlement being
          // recorded as it happens.
          settledAt:
            when && when !== todayKey()
              ? new Date(`${when}T12:00:00`).toISOString()
              : undefined,
          lines: chosen.map((c) => ({
            deliveryId: c.step.deliveryId,
            stream: c.step.stream,
            leg: c.step.leg,
          })),
        },
      });
      submitKey.current = '';
      toast(
        chosen.length === 1
          ? 'Settlement recorded'
          : `Settlement recorded — ${chosen.length} obligations cleared`
      );
      onDone();
    } catch (e) {
      toast(errMessage(e));
    }
    setBusy(false);
  }

  if (!party) return null;

  const isRider = party.kind === 'rider';
  const title = isRider ? `Record remittance from ${party.name}` : `Settle with ${party.name}`;
  const description = isRider
    ? `Cash ${party.name} collected at the door and is handing in. Untick anything they have not brought.`
    : `Fees ${party.name} owes ${COMPANY}, and cash-on-delivery takings ${COMPANY} owes them. Both directions can go on one settlement.`;

  return (
    <Modal open title={title} description={description} wide closeLabel="Cancel" onClose={onClose}>
      {candidates.length === 0 ? (
        <div className="somo-empty small">
          Nothing outstanding to settle here. If you were expecting something, widen the period on
          the ledger — the dialog only offers what is currently on screen.
        </div>
      ) : (
        <>
          <div className="somo-settle-list">
            <div className="somo-settle-head">
              <button type="button" className="somo-inline-link" onClick={toggleAll}>
                {excluded.size === 0 ? 'Untick all' : 'Tick all'}
              </button>
              <span>
                {chosen.length} of {candidates.length} selected
              </span>
            </div>

            {candidates.map((c) => {
              const key = keyOf(c.step);
              const d = c.entry.delivery;
              return (
                <label className={`somo-settle-row${excluded.has(key) ? '' : ' on'}`} key={key}>
                  <input
                    type="checkbox"
                    checked={!excluded.has(key)}
                    onChange={() => toggle(c.step)}
                  />
                  <span className="what">
                    <span className="line1">
                      #{shortId(d.id)} · {c.step.label}
                      <span className={`somo-leg-tag ${c.step.leg}`}>
                        {c.step.leg === 'in' ? 'in' : 'out'}
                      </span>
                    </span>
                    <span className="line2">
                      {isRider ? `${d.customer} · ` : ''}
                      {d.dropoff} · {fmtDateTime(d.date)}
                    </span>
                  </span>
                  <span className="amt">{fmtMoney(c.step.amount)}</span>
                </label>
              );
            })}
          </div>

          <div className="somo-settle-totals">
            {totalIn > 0 ? (
              <div className="somo-price-row">
                <span className="l">Coming in to {COMPANY}</span>
                <span className="v">{fmtMoney(totalIn)}</span>
              </div>
            ) : null}
            {totalOut > 0 ? (
              <div className="somo-price-row">
                <span className="l">Going out to {party.name}</span>
                <span className="v">{fmtMoney(totalOut)}</span>
              </div>
            ) : null}
            <div className="somo-price-row main">
              <span className="l">
                {net === 0
                  ? 'Nothing changes hands — it cancels out'
                  : net > 0
                    ? `${party.name} pays ${COMPANY}`
                    : `${COMPANY} pays ${party.name}`}
              </span>
              <span className="v">{fmtMoney(Math.abs(net))}</span>
            </div>
          </div>

          <div className="somo-row2">
            <label className="somo-field">
              <span>How it was paid</span>
              <select
                className="somo-select"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {SETTLEMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m === 'Offset' ? 'Offset — balances cancelled, no cash moved' : m}
                  </option>
                ))}
              </select>
            </label>
            <label className="somo-field">
              <span>Date it changed hands</span>
              <input
                className="somo-input"
                type="date"
                value={when}
                max={todayKey()}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
          </div>

          <div className="somo-row2">
            <label className="somo-field">
              <span>Reference (optional)</span>
              <input
                className="somo-input"
                placeholder="Receipt no, momo transaction id, cheque no"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label className="somo-field">
              <span>Note (optional)</span>
              <input
                className="somo-input"
                placeholder="Anything worth remembering"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            className="somo-btn small"
            disabled={busy || chosen.length === 0}
            onClick={submit}
          >
            {busy
              ? 'Recording…'
              : `Record ${chosen.length} ${chosen.length === 1 ? 'obligation' : 'obligations'}`}
          </button>

          <div className="somo-note">
            The amounts are the deliveries&rsquo; own figures and are not editable here — a
            settlement records that an obligation was met, not what it was worth. If a rider
            brought less than they owe, untick what they have not brought and record the rest when
            they do. Recorded by mistake? Void it below the ledger; the obligation comes back.
          </div>
        </>
      )}
    </Modal>
  );
}
