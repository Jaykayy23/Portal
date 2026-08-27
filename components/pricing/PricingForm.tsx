'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { api, errMessage } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
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
  // The two flat fees each get their own form for the same reason: an admin
  // changing what the portal charges to book should not have to re-submit the
  // fare table to do it, and a mistake in one box cannot take the others down.
  const [bookingFee, setBookingFee] = useState(String(params.bookingFee ?? 0));
  const [platformFee, setPlatformFee] = useState(String(params.platformFee ?? 0));
  const [busy, setBusy] = useState<'fares' | 'surcharges' | 'booking' | 'platform' | null>(null);

  // The minimum fare floors the fare; the two fees sit outside it. So the least
  // any delivery can ever cost is all three added up, and that figure appears
  // nowhere on this tab unless it is worked out here — which is the whole reason
  // the readout exists, since "Minimum fare: 25" reads like the answer.
  const floorParts = [
    parseFloat(form.minFare) || 0,
    parseFloat(bookingFee) || 0,
    parseFloat(platformFee) || 0,
  ];
  const smallestQuote = floorParts.reduce((a, b) => a + b, 0);
  // Three boxes across three forms feed this, so it can easily be showing the
  // consequence of an edit nobody has saved. Half a pesewa of tolerance, because
  // the columns store two decimal places and a typed 25.005 is stored as 25.01.
  const savedSmallestQuote =
    (params.minFare || 0) + (params.bookingFee || 0) + (params.platformFee || 0);
  const unsaved = Math.abs(smallestQuote - savedSmallestQuote) >= 0.005;

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
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  /**
   * The booking fee and the platform fee are the same form twice over — one
   * amount, one save — so they share a handler rather than being copied.
   */
  async function saveFee(e: React.FormEvent, which: 'booking' | 'platform') {
    e.preventDefault();
    setBusy(which);
    const isBooking = which === 'booking';
    const typed = parseFloat(isBooking ? bookingFee : platformFee) || 0;
    try {
      const { params: saved } = await api<{ params: PricingParams }>('/pricing', {
        method: 'POST',
        body: isBooking ? { bookingFee: typed } : { platformFee: typed },
      });
      // Show what was stored rather than what was typed: the server rounds to the
      // pesewa, and a box still reading 5.005 would be claiming otherwise.
      const set = isBooking ? setBookingFee : setPlatformFee;
      set(String(isBooking ? saved.bookingFee : saved.platformFee));
      toast(`${isBooking ? 'Booking' : 'Platform'} fee saved for all merchants`);
      // Every new quote carries it from here on, so the New delivery tab has to
      // re-read the parameters it was server-rendered with.
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
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
      toast(errMessage(err), 'danger');
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
          Pricing parameters
          <InfoHint label="pricing parameters">
            <p>
              Price ={' '}
              <strong>
                max(minimum fare, base + rate × km + per-minute × minutes)
              </strong>{' '}
              + surge charges + booking fee + platform fee.
            </p>
            <p>
              Driving time comes from Google Maps at the moment of quoting, so two runs of the same
              distance price differently when one of them sits in traffic. Set the per-minute rate
              to 0 to quote on distance alone.
            </p>
            <p>
              The minimum fare floors the <em>fare</em>, not the invoice: the surge charges and the
              two fees are added after it, so the least a delivery can cost is the minimum fare plus
              the booking and platform fees. That figure is shown below as you edit.
            </p>
            <p>
              What these rules produce is the charged price, not a starting point — nobody can type
              a different one. Edits are admin-only and apply to new quotes portal-wide at once.
            </p>
            <p>
              The ops phone is where the delivery log&rsquo;s <strong>Notify</strong> button points
              its one-tap WhatsApp and SMS alerts.
            </p>
          </InfoHint>
          <span className="tag-note">admin only</span>
        </h3>

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
        <div className="somo-price-box">
          <div className="somo-price-row">
            <span className="l">
              Smallest possible quote{unsaved ? ' (unsaved)' : ''}
            </span>
            <span className="v">{fmtMoney(smallestQuote)}</span>
          </div>
          <div className="somo-divider" />
          <div className="somo-price-row">
            <span className="l">Minimum fare + booking fee + platform fee</span>
            <span className="v">
              {floorParts.map((n) => n.toFixed(2)).join(' + ')}
            </span>
          </div>
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
          {busy === 'fares' ? <Spinner /> : null}
          {busy === 'fares' ? 'Saving…' : 'Save pricing parameters'}
        </button>
      </form>

      <form
        className="somo-card"
        style={{ maxWidth: 480 }}
        onSubmit={(e) => saveFee(e, 'booking')}
      >
        <h3>
          Booking fee
          <InfoHint label="booking fee">
            <p>
              A flat charge added once to every delivery for placing the booking, on top of the
              fare and any surge charges.
            </p>
            <p>
              The minimum fare does not cover it — placing a booking costs the same whether the run
              is 1km or 30km, so the fee is the same either way.
            </p>
            <p>
              Set it to 0 to charge nothing for booking; it then disappears from the quote entirely.
              Deliveries already filed keep the price they were quoted.
            </p>
          </InfoHint>
          <span className="tag-note">admin only</span>
        </h3>

        <label className="somo-field">
          <span>Booking fee (GHS)</span>
          <input
            className="somo-input"
            type="number"
            min="0"
            step="0.01"
            value={bookingFee}
            onChange={(e) => setBookingFee(e.target.value)}
          />
        </label>

        <button className="somo-btn ghost" type="submit" disabled={busy === 'booking'}>
          {busy === 'booking' ? <Spinner /> : null}
          {busy === 'booking' ? 'Saving…' : 'Save booking fee'}
        </button>
      </form>

      <form
        className="somo-card"
        style={{ maxWidth: 480 }}
        onSubmit={(e) => saveFee(e, 'platform')}
      >
        <h3>
          Platform fee
          <InfoHint label="platform fee">
            <p>
              A flat charge added once to every delivery for running the portal — dispatch,
              tracking and the alerts that go with it.
            </p>
            <p>
              Like the booking fee it sits outside the minimum fare, so it is worth the same on
              every run, and it is charged whether or not any surge charge is ticked.
            </p>
            <p>
              Set it to 0 to charge nothing; it then disappears from the quote entirely. Edits apply
              to new quotes portal-wide at once.
            </p>
          </InfoHint>
          <span className="tag-note">admin only</span>
        </h3>

        <label className="somo-field">
          <span>Platform fee (GHS)</span>
          <input
            className="somo-input"
            type="number"
            min="0"
            step="0.01"
            value={platformFee}
            onChange={(e) => setPlatformFee(e.target.value)}
          />
        </label>

        <button className="somo-btn ghost" type="submit" disabled={busy === 'platform'}>
          {busy === 'platform' ? <Spinner /> : null}
          {busy === 'platform' ? 'Saving…' : 'Save platform fee'}
        </button>
      </form>

      <form className="somo-card" style={{ maxWidth: 480 }} onSubmit={saveSurcharges}>
        <h3>
          Surge charges
          <InfoHint label="surge charges">
            <p>
              The optional extras merchants can tick on a new delivery. Each ticked charge is added
              on top of the computed fare.
            </p>
            <p>
              Edits apply to new quotes at once. Deliveries already filed keep the price they were
              quoted, so editing or removing a charge never rewrites history.
            </p>
          </InfoHint>
          <span className="tag-note">admin only</span>
        </h3>

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
                  <X size={14} strokeWidth={2.25} aria-hidden="true" />
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
          <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
          Add a surge charge
        </button>

        <button className="somo-btn ghost" type="submit" disabled={busy === 'surcharges'}>
          {busy === 'surcharges' ? <Spinner /> : null}
          {busy === 'surcharges' ? 'Saving…' : 'Save surge charges'}
        </button>
      </form>
    </>
  );
}
