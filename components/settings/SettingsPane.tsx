'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { AppSettings, OtherKey, PricingParams, SurchargeOption } from '@/lib/types';

const MAX_LOGO_BYTES = 900 * 1024;

export function SettingsPane({
  settings,
  pricing,
}: {
  settings: AppSettings;
  pricing: PricingParams;
}) {
  const router = useRouter();
  const toast = useToast();

  const [mapsApiKey, setMapsApiKey] = useState(settings.mapsApiKey);
  const [whatsappOtpKey, setWhatsappOtpKey] = useState(settings.whatsappOtpKey);
  const [smsApiKey, setSmsApiKey] = useState(settings.smsApiKey);
  const [otherKeys, setOtherKeys] = useState<OtherKey[]>(settings.otherKeys ?? []);
  const [logoPreview, setLogoPreview] = useState(settings.logoDataUrl);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Surge charges live in pricing_params, not app_settings, but they are edited
  // here because this tab is the admin-only one — merchants read the list to tick
  // the options, and only admin ever sets the amounts.
  const [surcharges, setSurcharges] = useState<SurchargeOption[]>(pricing.surcharges ?? []);
  const [busy, setBusy] = useState<'keys' | 'logo' | 'surcharges' | null>(null);

  async function saveApiKeys(e: React.FormEvent) {
    e.preventDefault();
    setBusy('keys');
    try {
      await api('/settings', {
        method: 'POST',
        body: {
          mapsApiKey: mapsApiKey.trim(),
          whatsappOtpKey: whatsappOtpKey.trim(),
          smsApiKey: smsApiKey.trim(),
          otherKeys: otherKeys.filter((k) => k.name.trim() || k.value.trim()),
        },
      });
      toast('API keys saved for the whole portal');
      // The Maps SDK is loaded by the portal layout from the saved key, so a
      // refresh is what picks up a newly added or removed key.
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
      const { params } = await api<{ params: PricingParams }>('/pricing', {
        method: 'POST',
        body: { surcharges: surcharges.filter((s) => s.label.trim()) },
      });
      // Ids for newly added rows are assigned server-side, so take the saved list
      // back rather than keeping the local one.
      setSurcharges(params.surcharges);
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

  async function saveLogo() {
    if (!logoFile) {
      toast('Choose an image file first');
      return;
    }
    if (logoFile.size > MAX_LOGO_BYTES) {
      toast('Please use a smaller image (under ~900KB)');
      return;
    }
    setBusy('logo');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that image file.'));
        reader.readAsDataURL(logoFile);
      });
      await api('/settings', { method: 'POST', body: { logoDataUrl: dataUrl } });
      setLogoPreview(dataUrl);
      toast('Logo saved for the whole portal');
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(null);
  }

  async function removeLogo() {
    setBusy('logo');
    try {
      await api('/settings', { method: 'POST', body: { logoDataUrl: '' } });
      setLogoPreview('');
      setLogoFile(null);
      toast('Logo removed');
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(null);
  }

  function updateOtherKey(index: number, patch: Partial<OtherKey>) {
    setOtherKeys((keys) => keys.map((k, i) => (i === index ? { ...k, ...patch } : k)));
  }

  return (
    <>
      <div className="somo-card" style={{ marginTop: 0, maxWidth: 520 }}>
        <h3>
          <span className="n">—</span> Branding
        </h3>
        <div className="somo-logo-row">
          <div className="somo-logo-preview">
            {logoPreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoPreview} alt="Current portal logo" />
            ) : (
              'SX'
            )}
          </div>
          <div style={{ flex: 1 }}>
            <input
              className="somo-input"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="somo-btn-row">
          <button className="somo-btn small" onClick={saveLogo} disabled={busy === 'logo'}>
            Save logo
          </button>
          <button
            className="somo-btn ghost small"
            onClick={removeLogo}
            disabled={busy === 'logo' || !logoPreview}
          >
            Remove logo
          </button>
        </div>
        <div className="somo-note">
          Shows in the header and login screen for everyone using this portal. Keep the file small (a
          square icon under ~500KB works best).
        </div>
      </div>

      <form className="somo-card" style={{ maxWidth: 520 }} onSubmit={saveSurcharges}>
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
                  step="0.5"
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

        <button className="somo-btn" type="submit" disabled={busy === 'surcharges'}>
          {busy === 'surcharges' ? 'Saving…' : 'Save surge charges'}
        </button>

        <div className="somo-note">
          Changes apply immediately to new quotes for everyone using this portal. Deliveries already
          filed keep the price they were quoted, so editing or removing a charge never rewrites
          history. The per-km, per-minute and base fares are on the Pricing tab.
        </div>
      </form>

      <form className="somo-card" style={{ maxWidth: 520 }} onSubmit={saveApiKeys}>
        <h3>
          <span className="n">—</span> API keys
          <span className="tag-note">stored server-side</span>
        </h3>

        <label className="somo-field">
          <span>Google Maps API key (Places + Distance Matrix)</span>
          <input
            className="somo-input"
            type="password"
            placeholder="AIza…"
            autoComplete="off"
            value={mapsApiKey}
            onChange={(e) => setMapsApiKey(e.target.value)}
          />
        </label>
        <label className="somo-field">
          <span>WhatsApp OTP / Business API key</span>
          <input
            className="somo-input"
            type="password"
            placeholder="e.g. Meta WhatsApp Business API token"
            autoComplete="off"
            value={whatsappOtpKey}
            onChange={(e) => setWhatsappOtpKey(e.target.value)}
          />
        </label>
        <label className="somo-field">
          <span>SMS API key</span>
          <input
            className="somo-input"
            type="password"
            placeholder="e.g. Twilio / Africa's Talking API key"
            autoComplete="off"
            value={smsApiKey}
            onChange={(e) => setSmsApiKey(e.target.value)}
          />
        </label>

        {otherKeys.map((k, i) => (
          <div className="somo-otherkey-row" key={i}>
            <input
              className="somo-input"
              placeholder="Key name (e.g. Africa's Talking username)"
              value={k.name}
              onChange={(e) => updateOtherKey(i, { name: e.target.value })}
            />
            <div className="value-cell">
              <input
                className="somo-input"
                type="password"
                placeholder="Key value"
                autoComplete="off"
                value={k.value}
                onChange={(e) => updateOtherKey(i, { value: e.target.value })}
              />
              <button
                type="button"
                className="somo-mini-btn"
                aria-label={`Remove ${k.name || 'key'}`}
                onClick={() => setOtherKeys((keys) => keys.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          className="somo-btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setOtherKeys((keys) => [...keys, { name: '', value: '' }])}
        >
          + Add another key
        </button>

        <button className="somo-btn" type="submit" disabled={busy === 'keys'}>
          {busy === 'keys' ? 'Saving…' : 'Save API keys'}
        </button>

        <div className="somo-note">
          These live in the backend&rsquo;s database file, not in the browser — regular users never
          receive them (only the Google Maps key is sent to signed-in browsers, since Maps JS has to
          load client-side; restrict it by HTTP referrer in Google Cloud Console). The WhatsApp/SMS
          keys are stored ready for a provider integration; today, actual message sending still goes
          through the one-tap WhatsApp/SMS links on the Notify button, since sending via a provider
          API requires this app&rsquo;s server to call that provider directly — ask your developer to
          wire that up when you&rsquo;re ready to automate it.
        </div>
      </form>
    </>
  );
}
