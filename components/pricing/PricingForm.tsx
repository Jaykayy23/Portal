'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { PricingParams } from '@/lib/types';

export function PricingForm({ params }: { params: PricingParams }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    base: String(params.base),
    rate: String(params.rate),
    perMin: String(params.perMin),
    minFare: String(params.minFare),
    minPct: String(params.minPct),
    opsPhone: params.opsPhone || '',
  });
  const [busy, setBusy] = useState(false);

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/pricing', {
        method: 'POST',
        body: {
          base: parseFloat(form.base) || 0,
          rate: parseFloat(form.rate) || 0,
          perMin: parseFloat(form.perMin) || 0,
          minFare: parseFloat(form.minFare) || 0,
          minPct: parseFloat(form.minPct) || 0,
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
    setBusy(false);
  }

  return (
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
          <input className="somo-input" type="number" min="0" step="0.5" {...field('base')} />
        </label>
        <label className="somo-field">
          <span>Rate per km (GHS)</span>
          <input className="somo-input" type="number" min="0" step="0.5" {...field('rate')} />
        </label>
      </div>
      <div className="somo-row2">
        <label className="somo-field">
          <span>Rate per minute (GHS)</span>
          <input className="somo-input" type="number" min="0" step="0.5" {...field('perMin')} />
        </label>
        <label className="somo-field">
          <span>Minimum fare (GHS)</span>
          <input className="somo-input" type="number" min="0" step="0.5" {...field('minFare')} />
        </label>
      </div>
      <div className="somo-row2">
        <label className="somo-field">
          <span>Min. negotiable (% of recommended)</span>
          <input
            className="somo-input"
            type="number"
            min="0"
            max="100"
            step="1"
            {...field('minPct')}
          />
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

      <button className="somo-btn ghost" type="submit" style={{ marginTop: 6 }} disabled={busy}>
        {busy ? 'Saving…' : 'Save pricing parameters'}
      </button>

      <div className="somo-note">
        Recommended price = max(minimum fare, base fare + rate × distance + rate per minute ×
        estimated driving time) + surge charges. The surge charge list and its amounts are set on the
        Settings tab.
        <br />
        The driving time comes from Google Maps at the moment of quoting, so two runs of the same
        distance price differently when one of them sits in traffic. Set the per-minute rate to 0 to
        quote on distance alone.
        <br />
        Minimum negotiable = recommended price × min. negotiable %.
        <br />
        The ops phone number is used to generate one-tap WhatsApp/SMS alerts — see the
        &ldquo;Notify&rdquo; button on each row in the delivery log.
      </div>
    </form>
  );
}
