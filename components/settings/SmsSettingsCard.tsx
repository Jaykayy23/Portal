'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import { MAX_SENDER_ID_CHARS, smsConfigProblem } from '@/lib/smsConfig';
import type { SmsSettings } from '@/lib/types';

/**
 * The BMS SMS configuration, as its own card.
 *
 * Separate from the API keys card next to it, because the two behave differently
 * in the one way that matters to whoever is filling them in. A key is a value you
 * paste and forget. This is a pair of values that only work together, so the form
 * has to be able to say "that sender ID is two characters too long" and "you have
 * turned sending on with no key" — and it says both from lib/smsConfig.ts, which
 * is the same code the Route Handler uses when the save arrives. The browser is
 * not where the rule is enforced; it is where the rule is explained early enough
 * to be useful.
 *
 * Which field is pre-filled and which starts blank is the security line:
 *
 *   the sender ID  arrives with its real value, because an admin has to be able
 *                  to read it back and check it against what BMS approved.
 *   the API key    arrives as a mask and the box starts empty. Blank means "keep
 *                  what is stored", which is only safe because the value was
 *                  never sent here to be echoed back.
 */
export function SmsSettingsCard({ sms }: { sms: SmsSettings }) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = useState(sms.enabled);
  const [senderId, setSenderId] = useState(sms.senderId);

  // Only ever what the admin has typed in this session.
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  // After a save the page refreshes with new values; the typed key is spent, so it
  // is dropped rather than left in memory. The sender ID is re-seeded from the
  // server so what is on screen is what is stored, trimming included.
  useEffect(() => {
    setEnabled(sms.enabled);
    setSenderId(sms.senderId);
    setApiKey('');
    setClearKey(false);
  }, [sms]);

  /**
   * Will a key be stored once this form is saved? Typing beats a pending removal,
   * so the two cannot contradict each other.
   */
  const keySet = apiKey.trim() ? true : !clearKey && sms.apiKey.set;

  const problem = smsConfigProblem({ enabled, senderId }, keySet);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Checked again here rather than only by disabling the button, because the
    // button is also reachable by pressing Enter in a field.
    if (problem) {
      toast(problem, 'danger');
      return;
    }

    setBusy('save');
    setTestResult('');
    try {
      await api('/settings', {
        method: 'POST',
        body: {
          sms: {
            enabled,
            senderId,
            // null clears it, a string replaces it, and undefined is dropped by
            // JSON.stringify — which is the wire format for "leave it alone".
            apiKey: clearKey ? null : apiKey.trim() || undefined,
          },
        },
      });
      toast(enabled ? 'SMS sending is on' : 'SMS settings saved — sending is off');
      // The Notify modal asks the server whether it may offer a send button, so a
      // refresh is what makes a newly enabled channel show up there.
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  /**
   * Checks the saved credentials, and texts a number if one is given.
   *
   * Tests what is stored, not what is on screen — so an admin saves first. That is
   * deliberate: a test that accepted the typed key would be a second route
   * carrying a credential over the wire, for no gain over pressing Save.
   */
  async function test() {
    setBusy('test');
    setTestResult('');
    try {
      const { detail } = await api<{ detail: string }>('/sms', {
        method: 'POST',
        body: { to: testTo.trim() || undefined },
      });
      setTestResult(detail);
      toast('BMS answered');
    } catch (err) {
      setTestResult(errMessage(err));
      toast('BMS test failed', 'danger');
    }
    setBusy(null);
  }

  const senderLeft = MAX_SENDER_ID_CHARS - senderId.trim().length;

  return (
    <form className="somo-card" onSubmit={save}>
      <h3>
        SMS sending (BMS)
        <InfoHint label="SMS sending">
          <p>
            With this on, the <strong>Notify</strong> button can send a delivery&rsquo;s alerts
            straight from the portal instead of opening WhatsApp for you to tap send. The wording
            is identical either way — it comes from the same place.
          </p>
          <p>
            Get the API key from the BMS dashboard under <strong>Developer / API</strong>. It is
            the whole credential — there is no second secret — so treat it the way you would a
            password, and generate a fresh one rather than sharing this one.
          </p>
          <p>
            The <strong>sender ID</strong> is the name recipients see instead of a number. BMS has
            to approve it before anything will send, and messages from it are one-way: nobody can
            reply. Every alert carries a tap-through link instead, so that costs nothing here.
          </p>
        </InfoHint>
        <span className="tag-note">{enabled ? 'sending' : 'off'}</span>
      </h3>

      <label className={`somo-check${enabled ? ' checked' : ''}`} style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Send delivery alerts by SMS automatically
      </label>

      <label className="somo-field">
        <span>
          BMS API key
          {sms.apiKey.set ? (
            <button
              type="button"
              className="somo-inline-link"
              onClick={() => setClearKey((v) => !v)}
            >
              {clearKey ? 'keep it after all' : 'remove'}
            </button>
          ) : null}
        </span>
        <input
          className="somo-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            clearKey
              ? 'Will be removed when you save'
              : sms.apiKey.set
                ? `${sms.apiKey.masked} — leave blank to keep`
                : 'Paste it from the BMS dashboard'
          }
          value={apiKey}
          onChange={(e) => {
            if (clearKey && e.target.value) setClearKey(false);
            setApiKey(e.target.value);
          }}
        />
        {!sms.apiKey.set && !apiKey ? (
          <span className="somo-field-note">Not configured</span>
        ) : null}
      </label>

      <label className="somo-field">
        <span>
          Sender ID
          <InfoHint label="sender ID">
            <p>
              Up to {MAX_SENDER_ID_CHARS} characters, starting with a letter — e.g.
              <strong> SomoExpres</strong>. It has to be registered and approved in the BMS
              dashboard first; an unapproved sender is rejected at send time, which looks exactly
              like a broken integration.
            </p>
            <p>
              <strong>Test connection</strong> below checks the approval state for you, so you can
              tell the two apart without spending credits.
            </p>
          </InfoHint>
        </span>
        <input
          className="somo-input"
          placeholder="SomoExpres"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_SENDER_ID_CHARS}
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
        />
        {senderId.trim() ? (
          <span className="somo-field-note">
            {senderLeft} character{senderLeft === 1 ? '' : 's'} left
          </span>
        ) : null}
      </label>

      {problem ? (
        <div className="somo-note" style={{ marginTop: 0 }}>
          {problem}
        </div>
      ) : (
        <div className="somo-note" style={{ marginTop: 0 }}>
          {senderId.trim() ? `Alerts will show as “${senderId.trim()}”. ` : ''}
          {enabled
            ? 'They go out from the Notify button.'
            : 'Sending is off — the Notify button still opens WhatsApp for you to tap send.'}
        </div>
      )}

      <button className="somo-btn" type="submit" disabled={busy !== null || !!problem}>
        {busy === 'save' ? <Spinner /> : null}
        {busy === 'save' ? 'Saving…' : 'Save SMS settings'}
      </button>

      <label className="somo-field" style={{ marginTop: 14 }}>
        <span>
          Test it
          <InfoHint label="testing SMS">
            <p>
              Checks the API key, reads your remaining credit balance, and asks BMS whether the
              sender ID is approved — all without sending anything. Those are the three separate
              ways this can be broken, and they all look the same from the outside.
            </p>
            <p>Add a number and it texts that too. Save first: the test uses what is stored.</p>
          </InfoHint>
        </span>
        <input
          className="somo-input"
          placeholder="Optional — a number to text, e.g. 0201234567"
          autoComplete="off"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
        />
      </label>

      <button
        type="button"
        className="somo-btn ghost small"
        onClick={test}
        disabled={busy !== null || !sms.apiKey.set}
      >
        {busy === 'test' ? <Spinner /> : null}
        {busy === 'test' ? 'Asking BMS…' : testTo.trim() ? 'Test and send' : 'Test connection'}
      </button>

      {testResult ? <div className="somo-note">{testResult}</div> : null}
    </form>
  );
}
