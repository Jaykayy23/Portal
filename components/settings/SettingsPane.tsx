'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import { SmsSettingsCard } from '@/components/settings/SmsSettingsCard';
import type { AppSettings, DeliveryOptions, MaskedSecret } from '@/lib/types';

const MAX_LOGO_BYTES = 900 * 1024;

/**
 * One extra key as the form holds it: the name and mask come from the server, the
 * value is only ever what the admin has typed in this session.
 */
interface KeyRow {
  name: string;
  /** Blank means "leave whatever is stored alone". */
  value: string;
  masked: string;
  set: boolean;
}

function rowsFrom(settings: AppSettings): KeyRow[] {
  return (settings.otherKeys ?? []).map((k) => ({
    name: k.name,
    value: '',
    masked: k.masked,
    set: k.set,
  }));
}

/** What to show in an empty secret field. */
function placeholderFor(secret: MaskedSecret, hint: string): string {
  return secret.set ? `${secret.masked} — leave blank to keep` : hint;
}

/**
 * One secret field: an empty box, the mask as its placeholder, and a way to say
 * "remove this" out loud.
 *
 * The input never holds the stored value, so there is nothing to accidentally
 * submit unchanged and nothing for devtools to read. Blank means keep.
 */
function SecretField({
  label,
  hint,
  secret,
  value,
  onChange,
  cleared,
  onToggleClear,
}: {
  label: string;
  hint: string;
  secret: MaskedSecret;
  value: string;
  onChange: (next: string) => void;
  cleared: boolean;
  onToggleClear: () => void;
}) {
  return (
    <label className="somo-field">
      <span>
        {label}
        {secret.set ? (
          <button type="button" className="somo-inline-link" onClick={onToggleClear}>
            {cleared ? 'keep it after all' : 'remove'}
          </button>
        ) : null}
      </span>
      <input
        className="somo-input"
        type="password"
        // Typing overrides a pending removal, so the two cannot contradict.
        placeholder={cleared ? 'Will be removed when you save' : placeholderFor(secret, hint)}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          if (cleared && e.target.value) onToggleClear();
          onChange(e.target.value);
        }}
      />
      {!secret.set && !value ? <span className="somo-field-note">Not configured</span> : null}
    </label>
  );
}

export function SettingsPane({
  settings,
  options,
}: {
  settings: AppSettings;
  options: DeliveryOptions;
}) {
  const router = useRouter();
  const toast = useToast();

  // All three start empty and stay empty unless the admin types. The stored
  // values are not here to be edited, because they were never sent.
  const [mapsApiKey, setMapsApiKey] = useState('');
  const [whatsappOtpKey, setWhatsappOtpKey] = useState('');
  const [smsApiKey, setSmsApiKey] = useState('');
  // Which fields the admin has asked to empty. Blank means "keep", so wanting a
  // key gone has to be said out loud.
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [otherKeys, setOtherKeys] = useState<KeyRow[]>(() => rowsFrom(settings));
  const [logoPreview, setLogoPreview] = useState(settings.logoDataUrl);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // What merchants pick from on the New delivery form. Stored in
  // delivery_options, not app_settings — every signed-in role has to read it.
  const [itemCategories, setItemCategories] = useState<string[]>(options.itemCategories ?? []);
  const [busy, setBusy] = useState<'keys' | 'logo' | 'categories' | null>(null);

  // After a save the page refreshes and arrives with new masks; the typed values
  // are spent, so they are dropped rather than left sitting in memory. Safe to key
  // off the whole prop: this page has no background refresh to interrupt typing.
  useEffect(() => {
    setMapsApiKey('');
    setWhatsappOtpKey('');
    setSmsApiKey('');
    setCleared({});
    setOtherKeys(rowsFrom(settings));
  }, [settings]);

  /** A field the admin left blank is omitted entirely; cleared sends null. */
  function secretPatch(typed: string, field: string): string | null | undefined {
    if (cleared[field]) return null;
    const trimmed = typed.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  function toggleClear(field: string) {
    setCleared((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  async function saveApiKeys(e: React.FormEvent) {
    e.preventDefault();
    setBusy('keys');
    try {
      await api('/settings', {
        method: 'POST',
        body: {
          // JSON.stringify drops undefined, which is exactly the wire format for
          // "not mentioned, do not touch".
          mapsApiKey: secretPatch(mapsApiKey, 'maps'),
          whatsappOtpKey: secretPatch(whatsappOtpKey, 'whatsapp'),
          smsApiKey: secretPatch(smsApiKey, 'sms'),
          otherKeys: otherKeys
            .filter((k) => k.name.trim())
            .map((k) => ({ name: k.name.trim(), value: k.value })),
        },
      });
      toast('API keys saved for the whole portal');
      // The Maps SDK is loaded by the portal layout from the saved key, so a
      // refresh is what picks up a newly added or removed key.
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  async function saveItemCategories(e: React.FormEvent) {
    e.preventDefault();
    setBusy('categories');
    try {
      const { options: saved } = await api<{ options: DeliveryOptions }>('/delivery-options', {
        method: 'POST',
        body: { itemCategories },
      });
      // Blank rows are dropped server-side, so take the saved list back rather
      // than keeping the local one.
      setItemCategories(saved.itemCategories);
      toast('Item categories saved for the whole portal');
      // The New delivery form is server-rendered with these options.
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  function updateItemCategory(index: number, label: string) {
    setItemCategories((rows) => rows.map((r, i) => (i === index ? label : r)));
  }

  async function saveLogo() {
    if (!logoFile) {
      toast('Choose an image file first', 'danger');
      return;
    }
    if (logoFile.size > MAX_LOGO_BYTES) {
      toast('Please use a smaller image (under ~900KB)', 'danger');
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
      toast(errMessage(err), 'danger');
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
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  function updateOtherKey(index: number, patch: Partial<KeyRow>) {
    setOtherKeys((keys) => keys.map((k, i) => (i === index ? { ...k, ...patch } : k)));
  }

  return (
    // Branding spans the top; the feature cards below it go two to a row on a wide
    // screen, so the whole of Settings is visible without scrolling. One column on
    // narrow ones.
    <div className="somo-settings-grid">
      <div className="somo-card span-full">
        <h3>
          Branding
          <InfoHint label="branding">
            <p>
              The logo shows in the portal header and on the login screen, for everyone. A square
              icon under ~500KB works best.
            </p>
          </InfoHint>
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
            {busy === 'logo' ? <Spinner /> : null}
            {busy === 'logo' ? 'Saving…' : 'Save logo'}
          </button>
          <button
            className="somo-btn ghost small"
            onClick={removeLogo}
            disabled={busy === 'logo' || !logoPreview}
          >
            Remove logo
          </button>
        </div>
      </div>

      <form className="somo-card" onSubmit={saveItemCategories}>
        <h3>
          Item categories
          <InfoHint label="item categories">
            <p>
              What merchants choose from when they say what they are sending. The choice is
              recorded on the delivery and carried into the rider&rsquo;s alert.
            </p>
            <p>
              Deliveries already filed keep the category they were logged with, renaming included,
              so editing this list never rewrites history.
            </p>
          </InfoHint>
          <span className="tag-note">New delivery form</span>
        </h3>

        {itemCategories.length === 0 ? (
          <div className="somo-note" style={{ marginTop: 0 }}>
            No item categories — the field disappears from the New delivery form until you add
            one.
          </div>
        ) : (
          itemCategories.map((label, i) => (
            <div className="somo-listrow" key={i}>
              <input
                className="somo-input"
                placeholder="e.g. Food, Medication, Documents"
                value={label}
                onChange={(e) => updateItemCategory(i, e.target.value)}
              />
              <button
                type="button"
                className="somo-mini-btn"
                aria-label={`Remove ${label || 'item category'}`}
                onClick={() => setItemCategories((rows) => rows.filter((_, j) => j !== i))}
              >
                <X size={14} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>
          ))
        )}

        <button
          type="button"
          className="somo-btn ghost small"
          style={{ marginBottom: 14 }}
          onClick={() => setItemCategories((rows) => [...rows, ''])}
        >
          <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
          Add an item category
        </button>

        <button className="somo-btn" type="submit" disabled={busy === 'categories'}>
          {busy === 'categories' ? <Spinner /> : null}
          {busy === 'categories' ? 'Saving…' : 'Save item categories'}
        </button>
      </form>

      <form className="somo-card" onSubmit={saveApiKeys}>
        <h3>
          API keys
          <InfoHint label="API keys">
            <p>
              These live in the database, not in the browser. The Google Maps key is the one
              exception — Maps JS runs client-side, so signed-in browsers receive it. Restrict it by
              HTTP referrer in the Google Cloud Console.
            </p>
            <p>
              Twilio has its own card — SMS is wired up, so its credentials need somewhere they
              can be checked and switched on. The keys here are stored for integrations that are
              not: WhatsApp alerts still go out through the one-tap links on the delivery
              log&rsquo;s <strong>Notify</strong> button.
            </p>
          </InfoHint>
          <span className="tag-note">stored server-side</span>
        </h3>

<SecretField
          label="Google Maps API key (Places + Distance Matrix)"
          hint="AIza…"
          secret={settings.mapsApiKey}
          value={mapsApiKey}
          onChange={setMapsApiKey}
          cleared={!!cleared.maps}
          onToggleClear={() => toggleClear('maps')}
        />
        <SecretField
          label="WhatsApp OTP / Business API key"
          hint="e.g. Meta WhatsApp Business API token"
          secret={settings.whatsappOtpKey}
          value={whatsappOtpKey}
          onChange={setWhatsappOtpKey}
          cleared={!!cleared.whatsapp}
          onToggleClear={() => toggleClear('whatsapp')}
        />
        <SecretField
          label="SMS API key — another provider"
          hint="e.g. Africa's Talking. Twilio goes in its own card."
          secret={settings.smsApiKey}
          value={smsApiKey}
          onChange={setSmsApiKey}
          cleared={!!cleared.sms}
          onToggleClear={() => toggleClear('sms')}
        />

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
                placeholder={k.set ? `${k.masked} — leave blank to keep` : 'Key value'}
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
          onClick={() =>
            setOtherKeys((keys) => [...keys, { name: '', value: '', masked: '', set: false }])
          }
        >
          <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
          Add another key
        </button>

        <button className="somo-btn" type="submit" disabled={busy === 'keys'}>
          {busy === 'keys' ? <Spinner /> : null}
          {busy === 'keys' ? 'Saving…' : 'Save API keys'}
        </button>
      </form>

      <SmsSettingsCard twilio={settings.twilio} />
    </div>
  );
}
