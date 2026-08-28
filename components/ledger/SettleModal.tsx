'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { fmtDateTime, fmtMoney, orderNo } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import {
  COMPANY,
  SETTLEMENT_METHODS,
  settleableSteps,
  type LedgerEntry,
  type SettlementKind,
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

/** One line as it will be sent. */
interface OutgoingLine {
  deliveryId: string;
  stream: SettlementStep['stream'];
  leg: SettlementStep['leg'];
  kind: SettlementKind;
  amount: number;
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

/**
 * What a typed amount means, clamped to what is owed.
 *
 * Blank means all of it, which is the ordinary case and so the default. Anything
 * above the remaining amount is pulled down rather than rejected mid-keystroke —
 * the database enforces the same bound, so this is only about not letting somebody
 * stare at a figure that was never going to be accepted.
 */
function amountFor(step: SettlementStep, typed: string | undefined): number {
  if (typed === undefined || typed.trim() === '') return step.amount;
  const parsed = Number(typed);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed * 100) / 100, step.amount);
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
   * they were half-way through typing.
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** Typed amounts, by line key. Absent means "all of what is owed". */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  /** Lines whose shortfall is being charged rather than left on the float. */
  const [writeOff, setWriteOff] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  /**
   * Held across retries, released on success.
   *
   * This is the endpoint where a lost response hurts most: the money really was
   * recorded, and a blind retry would be bounced by the remaining-amount check
   * and read as a failure. Same key, same answer.
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
    setAmounts({});
    setWriteOff(new Set());
    setReference('');
    setNote('');
    setWhen(todayKey());
    setMethod('Cash');
    submitKey.current = '';
  }, [partyKey]);

  const chosen = candidates.filter((c) => !excluded.has(keyOf(c.step)));

  /**
   * The lines that will actually be sent.
   *
   * A short payment becomes two lines against the same obligation when the
   * difference is being written off: the payment, and the write-off for the rest.
   * Left alone, the remainder simply stays outstanding and comes back next time.
   */
  const outgoing = useMemo<OutgoingLine[]>(() => {
    const lines: OutgoingLine[] = [];
    for (const c of chosen) {
      const key = keyOf(c.step);
      const paid = amountFor(c.step, amounts[key]);
      if (paid > 0) {
        lines.push({
          deliveryId: c.step.deliveryId,
          stream: c.step.stream,
          leg: c.step.leg,
          kind: 'payment',
          amount: paid,
        });
      }
      const shortfall = Math.round((c.step.amount - paid) * 100) / 100;
      // Only inbound legs can be written off — you cannot declare money you owe a
      // merchant to be gone. The database says the same.
      if (shortfall > 0 && writeOff.has(key) && c.step.leg === 'in') {
        lines.push({
          deliveryId: c.step.deliveryId,
          stream: c.step.stream,
          leg: c.step.leg,
          kind: 'writeoff',
          amount: shortfall,
        });
      }
    }
    return lines;
  }, [chosen, amounts, writeOff]);

  const totalIn = outgoing
    .filter((l) => l.leg === 'in' && l.kind === 'payment')
    .reduce((sum, l) => sum + l.amount, 0);
  const totalOut = outgoing.filter((l) => l.leg === 'out').reduce((sum, l) => sum + l.amount, 0);
  const totalWritten = outgoing
    .filter((l) => l.kind === 'writeoff')
    .reduce((sum, l) => sum + l.amount, 0);
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

  function toggleWriteOff(key: string) {
    setWriteOff((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    if (!party || outgoing.length === 0) return;
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
            when && when !== todayKey() ? new Date(`${when}T12:00:00`).toISOString() : undefined,
          lines: outgoing,
        },
      });
      submitKey.current = '';
      toast(
        outgoing.length === 1
          ? 'Settlement recorded'
          : `Settlement recorded — ${outgoing.length} entries`
      );
      onDone();
    } catch (e) {
      toast(errMessage(e), 'danger');
    }
    setBusy(false);
  }

  if (!party) return null;

  const isRider = party.kind === 'rider';
  const title = isRider ? `Record remittance from ${party.name}` : `Settle with ${party.name}`;
  const description = isRider
    ? `What ${party.name} is handing in. Edit an amount if they have brought only part of it, and say whether the rest stays outstanding or goes on their debt.`
    : `Fees ${party.name} owes ${COMPANY}, and cash-on-delivery takings ${COMPANY} owes them. Both directions can go on one settlement.`;

  return (
    <Modal
      open
      title={title}
      description={description}
      wide
      closeLabel="Cancel"
      onClose={onClose}
      hint={
        <>
          <p>
            Leave an amount blank to settle all of it. A partial amount leaves the rest outstanding,
            so it appears here again next time.
          </p>
          <p>
            Writing an amount off closes it instead, and charges it{isRider ? ` to ${party.name}` : ''}.
            Nothing here can exceed what is owed — the database bounds every figure to the
            obligation it is against.
          </p>
          <p>Recorded by mistake? Void it under the ledger and everything reopens.</p>
        </>
      }
    >
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
              const on = !excluded.has(key);
              const paid = amountFor(c.step, amounts[key]);
              const shortfall = Math.round((c.step.amount - paid) * 100) / 100;
              const canWriteOff = c.step.leg === 'in';

              return (
                <div className={`somo-settle-row${on ? ' on' : ''}`} key={key}>
                  <label className="tick">
                    <input type="checkbox" checked={on} onChange={() => toggle(c.step)} />
                  </label>

                  <span className="what">
                    <span className="line1">
                      {orderNo(d.id)} · {c.step.label}
                      <span className={`somo-leg-tag ${c.step.leg}`}>{c.step.leg}</span>
                    </span>
                    <span className="line2">
                      {isRider ? `${d.customer} · ` : ''}
                      {d.dropoff} · {fmtDateTime(d.date)}
                    </span>
                    {/* Only worth saying when part of it has already been settled —
                        otherwise it is the same number twice. */}
                    {c.step.amount < c.step.obligation ? (
                      <span className="line2">
                        {fmtMoney(c.step.amount)} of {fmtMoney(c.step.obligation)} still owed
                      </span>
                    ) : null}
                  </span>

                  <span className="amt">
                    <input
                      className="somo-input tiny"
                      type="number"
                      min="0"
                      step="0.01"
                      max={c.step.amount}
                      disabled={!on}
                      placeholder={c.step.amount.toFixed(2)}
                      value={amounts[key] ?? ''}
                      aria-label={`Amount settled on order ${orderNo(d.id)}`}
                      onChange={(e) => setAmounts((was) => ({ ...was, [key]: e.target.value }))}
                    />
                    <span className="of">of {fmtMoney(c.step.amount)}</span>
                  </span>

                  {on && shortfall > 0 ? (
                    <div className="short">
                      {canWriteOff ? (
                        <label className="somo-check-inline">
                          <input
                            type="checkbox"
                            checked={writeOff.has(key)}
                            onChange={() => toggleWriteOff(key)}
                          />
                          <span>
                            Write off the {fmtMoney(shortfall)} shortfall
                            {isRider ? ` to ${party.name}’s debt` : ''}
                          </span>
                        </label>
                      ) : (
                        <span className="somo-rider-sub">
                          {fmtMoney(shortfall)} stays owed to them.
                        </span>
                      )}
                      {canWriteOff && !writeOff.has(key) ? (
                        <span className="somo-rider-sub">
                          Otherwise it stays outstanding and appears here again.
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
            {totalWritten > 0 ? (
              <div className="somo-price-row">
                <span className="l">
                  Written off{isRider ? ` to ${party.name}’s debt` : ''} — no cash
                </span>
                <span className="v">{fmtMoney(totalWritten)}</span>
              </div>
            ) : null}
            <div className="somo-price-row main">
              <span className="l">
                {net === 0
                  ? 'No cash changes hands'
                  : net > 0
                    ? `${party.name} hands over`
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
            disabled={busy || outgoing.length === 0}
            onClick={submit}
          >
            {busy ? <Spinner /> : null}
            {busy
              ? 'Recording…'
              : `Record ${outgoing.length} ${outgoing.length === 1 ? 'entry' : 'entries'}`}
          </button>
        </>
      )}
    </Modal>
  );
}
