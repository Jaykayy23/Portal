'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { PricingParams, SurchargeOption } from '@/lib/types';

export function PricingForm({ params }: { params: PricingParams }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    base: String(params.base),
    rate: String(params.rate),
    perMin: String(params.perMin),
    minFare: String(params.minFare),
    opsPhone: params.opsPhone || '',
  });
  // Surge charges are stored in pricing_params alongside the fares, and they are
  // part of the same recommended price, so they belong on this tab. They save
  // separately because the amounts are edited row by row.
  const [surcharges, setSurcharges] = useState<SurchargeOption[]>(params.surcharges ?? []);
  const [busy, setBusy] = useState<'fares' | 'surcharges' | null>(null);

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('fares');
    try {
      await api('/pricing', {
        method: 'POST',
        body: {
          base: parseFloat(form.base) || 0,
          rate: parseFloat(form.rate) || 0,
          perMin: parseFloat(form.perMin) || 0,
          minFare: parseFloat(form.minFare) || 0,
          opsPhone: form.opsPhone.trim(),
        },
      });
      toast('Pricing parameters saved for all merchants');
      // New quotes everywhere use these immediately; refresh so the New delivery
      // tab picks them up too.
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(null);
  }

  async function saveSurcharges(e: React.FormEvent) {
    e.preventDefault();
    setBusy('surcharges');
    try {
      const { params: saved } = await api<{ params: PricingParams }>('/pricing', {
        method: 'POST',
        body: { surcharges: surcharges.filter((s) => s.label.trim()) },
      });
      // Ids for newly added rows are assigned server-side, so take the saved list
      // back rather than keeping the local one.
      setSurcharges(saved.surcharges);
      toast('Surge charges saved for the whole portal');
      // The New delivery form is server-rendered with these options.
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(null);
  }

  function updateSurcharge(index: number, patch: Partial<SurchargeOption>) {
    setSurcharges((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <form className="somo-card" style={{ marginTop: 0, maxWidth: 480 }} onSubmit={save}>
        <h3>
          <span className="n">03</span> Pricing parameters
        </h3>
        <p className="somo-card-intro">
          Editable by admin. Changes apply immediately to new quotes for everyone using this portal.
        </p>

        <div className="somo-row2">
          <label className="somo-field">
            <span>Base fare (GHS)</span>
            <input className="somo-input" type="number" min="0" step="0.01" {...field('base')} />
          </label>
          <label className="somo-field">
            <span>Rate per km (GHS)</span>
            <input className="somo-input" type="number" min="0" step="0.01" {...field('rate')} />
          </label>
        </div>
        <div className="somo-row2">
          <label className="somo-field">
            <span>Rate per minute (GHS)</span>
            <input className="somo-input" type="number" min="0" step="0.01" {...field('perMin')} />
          </label>
          <label className="somo-field">
            <span>Minimum fare (GHS)</span>
            <input className="somo-input" type="number" min="0" step="0.01" {...field('minFare')} />
          </label>
        </div>
        <label className="somo-field">
          <span>Ops team alert phone number (WhatsApp/SMS)</span>
          <input
            className="somo-input"
            type="tel"
            placeholder="e.g. 024 000 0000"
            {...field('opsPhone')}
          />
        </label>

        <button
          className="somo-btn ghost"
          type="submit"
          style={{ marginTop: 6 }}
          disabled={busy === 'fares'}
        >
          {busy === 'fares' ? 'Saving…' : 'Save pricing parameters'}
        </button>

        <div className="somo-note">
          Delivery price = max(minimum fare, base fare + rate × distance + rate per minute ×
          estimated driving time) + surge charges. The surge charge list and its amounts are set
          below.
          <br />
          The driving time comes from Google Maps at the moment of quoting, so two runs of the same
          distance price differently when one of them sits in traffic. Set the per-minute rate to 0
          to quote on distance alone.
          <br />
          This is the price, not a starting point: the figure these rules produce is what the
          delivery is logged and charged at. Nobody can type a different one.
          <br />
          The ops phone number is used to generate one-tap WhatsApp/SMS alerts — see the
          &ldquo;Notify&rdquo; button on each row in the delivery log.
        </div>
      </form>

      <form className="somo-card" style={{ maxWidth: 480 }} onSubmit={saveSurcharges}>
        <h3>
          <span className="n">—</span> Surge charges
          <span className="tag-note">admin only</span>
        </h3>
        <p className="somo-card-intro">
          The optional extras merchants can tick on a new delivery. Each ticked charge is added on
          top of the recommended price.
        </p>

        {surcharges.length === 0 ? (
          <div className="somo-note" style={{ marginTop: 0 }}>
            No surge charges — the option disappears from the New delivery form until you add one.
          </div>
        ) : (
          surcharges.map((s, i) => (
            <div className="somo-otherkey-row" key={s.id || i}>
              <input
                className="somo-input"
                placeholder="Name (e.g. Same-day rush)"
                value={s.label}
                onChange={(e) => updateSurcharge(i, { label: e.target.value })}
              />
              <div className="value-cell">
                <input
                  className="somo-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount (GHS)"
                  value={String(s.amount)}
                  onChange={(e) => updateSurcharge(i, { amount: parseFloat(e.target.value) || 0 })}
                />
                <button
                  type="button"
                  className="somo-mini-btn"
                  aria-label={`Remove ${s.label || 'surge charge'}`}
                  onClick={() => setSurcharges((rows) => rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}

        <button
          type="button"
          className="somo-btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setSurcharges((rows) => [...rows, { id: '', label: '', amount: 0 }])}
        >
          + Add a surge charge
        </button>

        <button className="somo-btn ghost" type="submit" disabled={busy === 'surcharges'}>
          {busy === 'surcharges' ? 'Saving…' : 'Save surge charges'}
        </button>

        <div className="somo-note">
          Changes apply immediately to new quotes for everyone using this portal. Deliveries already
          filed keep the price they were quoted, so editing or removing a charge never rewrites
          history.
        </div>
      </form>
    </>
  );
}
