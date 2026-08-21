'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { RIDER_STATUSES, type Rider, type RiderStatus } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { FLOAT_DEADLINE_HOURS, type RiderFloat } from '@/lib/ledger';

const EMPTY = { name: '', phone: '', regNumber: '', model: '' };

/** '3d 4h' — a float's age, in the units somebody chasing it thinks in. */
function fmtHeld(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function RidersPane({
  riders,
  floats,
}: {
  riders: Rider[];
  /**
   * Cash each rider is still holding, and for how long.
   *
   * Shown here because 'why can I not assign Kwame?' is a question that gets
   * asked on this screen, and the answer is money rather than availability.
   * Settling is done on the ledger; this is only the notice.
   */
  floats: RiderFloat[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  function field(key: keyof typeof EMPTY) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function addRider(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast('Enter a rider name', 'danger');
    if (!form.phone.trim()) return toast('Phone number is required for riders', 'danger');
    if (!form.regNumber.trim()) return toast('Motorbike registration number is required', 'danger');
    if (!form.model.trim()) return toast('Motorbike model is required', 'danger');

    setBusy(true);
    try {
      await api('/riders', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          regNumber: form.regNumber.trim(),
          model: form.model.trim(),
        },
      });
      setForm(EMPTY);
      toast('Rider added');
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
    }
    setBusy(false);
  }

  async function setStatus(id: string, status: RiderStatus) {
    try {
      await api('/riders/' + id, { method: 'PATCH', body: { status } });
      toast('Rider status updated');
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
      router.refresh();
    }
  }

  const floatByRider = new Map(floats.filter((f) => f.riderId).map((f) => [f.riderId, f]));
  const blockedCount = floats.filter((f) => f.overdue).length;

  return (
    <div className="somo-card" style={{ marginTop: 0 }}>
      <h3>
        <span className="n">—</span> Rider roster
        <span className="tag-note">shared, managed by admin/ops</span>
      </h3>

      {blockedCount > 0 ? (
        <div className="somo-flag show">
          {blockedCount === 1
            ? 'One rider has been holding cash for more than '
            : `${blockedCount} riders have been holding cash for more than `}
          {FLOAT_DEADLINE_HOURS} hours and cannot be assigned new deliveries until they
          settle. Record what they hand in — or write off what they cannot produce — on the
          Ledger tab.
        </div>
      ) : null}

      <form onSubmit={addRider}>
        <div className="somo-row2" style={{ alignItems: 'end' }}>
          <label className="somo-field">
            <span>Rider name</span>
            <input className="somo-input" placeholder="e.g. Kwame Boateng" {...field('name')} />
          </label>
          <label className="somo-field">
            <span>Phone number (required)</span>
            <input className="somo-input" type="tel" placeholder="024 000 0000" {...field('phone')} />
          </label>
        </div>
        <div className="somo-row2" style={{ alignItems: 'end' }}>
          <label className="somo-field">
            <span>Motorbike registration number (required)</span>
            <input className="somo-input" placeholder="e.g. GT 1234-24" {...field('regNumber')} />
          </label>
          <label className="somo-field">
            <span>Motorbike model (required)</span>
            <input className="somo-input" placeholder="e.g. Bajaj Boxer 150" {...field('model')} />
          </label>
        </div>
        <button className="somo-btn small" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add rider'}
        </button>
      </form>

      <div style={{ marginTop: 18 }}>
        {riders.length === 0 ? (
          <div className="somo-empty">
            <div className="big">No riders added yet</div>
            Add your internal fleet above to start assigning deliveries.
          </div>
        ) : (
          <div className="somo-riders-grid">
            {riders.map((r) => {
              const held = floatByRider.get(r.id);
              return (
                <div
                  className={`somo-rider-card${held?.overdue ? ' somo-overdue-row' : ''}`}
                  key={r.id}
                >
                  <div>
                    <div className="name">
                      {r.name}
                      {held?.overdue ? (
                        <span className="somo-badge b-approval" style={{ marginLeft: 6 }}>
                          blocked
                        </span>
                      ) : null}
                    </div>
                    <div className="phone">{r.phone}</div>
                    <div className="phone">
                      {r.model || '—'} · {r.regNumber || '—'}
                    </div>
                    {held && held.total > 0 ? (
                      <div className={held.overdue ? 'somo-void-note' : 'phone'}>
                        holding {fmtMoney(held.total)} · {fmtHeld(held.hoursHeld)}
                        {held.overdue
                          ? ` — ${fmtHeld(-held.hoursLeft)} over the limit`
                          : ` · ${fmtHeld(held.hoursLeft)} left`}
                      </div>
                    ) : null}
                    {held && held.writtenOff > 0 ? (
                      <div className="phone">
                        {fmtMoney(held.writtenOff)} written off to their debt
                      </div>
                    ) : null}
                  </div>
                  <select
                    className="somo-status-select"
                    value={r.status}
                    onChange={(e) => setStatus(r.id, e.target.value as RiderStatus)}
                  >
                    {RIDER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
