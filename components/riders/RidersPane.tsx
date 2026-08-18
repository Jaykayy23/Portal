'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { RIDER_STATUSES, type Rider, type RiderStatus } from '@/lib/types';

const EMPTY = { name: '', phone: '', regNumber: '', model: '' };

export function RidersPane({ riders }: { riders: Rider[] }) {
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
    if (!form.name.trim()) return toast('Enter a rider name');
    if (!form.phone.trim()) return toast('Phone number is required for riders');
    if (!form.regNumber.trim()) return toast('Motorbike registration number is required');
    if (!form.model.trim()) return toast('Motorbike model is required');

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
      toast(errMessage(err));
    }
    setBusy(false);
  }

  async function setStatus(id: string, status: RiderStatus) {
    try {
      await api('/riders/' + id, { method: 'PATCH', body: { status } });
      toast('Rider status updated');
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
      router.refresh();
    }
  }

  return (
    <div className="somo-card" style={{ marginTop: 0 }}>
      <h3>
        <span className="n">—</span> Rider roster
        <span className="tag-note">shared, managed by admin/ops</span>
      </h3>

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
            {riders.map((r) => (
              <div className="somo-rider-card" key={r.id}>
                <div>
                  <div className="name">{r.name}</div>
                  <div className="phone">{r.phone}</div>
                  <div className="phone">
                    {r.model || '—'} · {r.regNumber || '—'}
                  </div>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
