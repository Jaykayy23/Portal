'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import { describeSender, twilioConfigProblem } from '@/lib/twilioConfig';
import type { TwilioSettings } from '@/lib/types';

/**
 * The Twilio SMS configuration, as its own card.
 *
 * Separate from the API keys card next to it, because the two behave differently
 * in the one way that matters to whoever is filling them in. A key is a value you
 * paste and forget. This is a set of values that only work together, so the form
 * has to be able to say "that Account SID is not an Account SID" and "you have
 * turned sending on with nobody to send from" — and it says both from
 * lib/twilioConfig.ts, which is the same code the Route Handler will use when the
 * save arrives. The browser is not where the rule is enforced; it is where the
 * rule is explained early enough to be useful.
 *
 * Which fields are pre-filled and which start blank is the security line:
 *
 *   the identifiers   arrive with their real values, because an admin has to be
 *                     able to read back an Account SID to spot a mis-paste.
 *   the secret        arrives as a mask and the box starts empty. Blank means
 *                     "keep what is stored", which is only safe because the value
 *                     was never sent here to be echoed back.
 */
export function SmsSettingsCard({ twilio }: { twilio: TwilioSettings }) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = useState(twilio.enabled);
  const [accountSid, setAccountSid] = useState(twilio.accountSid);
  const [apiKeySid, setApiKeySid] = useState(twilio.apiKeySid);
  const [fromNumber, setFromNumber] = useState(twilio.fromNumber);
  const [messagingServiceSid, setMessagingServiceSid] = useState(twilio.messagingServiceSid);

  // Only ever what the admin has typed in this session.
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  // After a save the page refreshes with new values; the typed secret is spent, so
  // it is dropped rather than left in memory. The identifiers are re-seeded from
  // the server so what is on screen is what is stored — including any trimming.
  useEffect(() => {
    setEnabled(twilio.enabled);
    setAccountSid(twilio.accountSid);
    setApiKeySid(twilio.apiKeySid);
    setFromNumber(twilio.fromNumber);
    setMessagingServiceSid(twilio.messagingServiceSid);
    setSecret('');
    setClearSecret(false);
  }, [twilio]);

  const fields = { enabled, accountSid, apiKeySid, fromNumber, messagingServiceSid };

  /**
   * Will a secret be stored once this form is saved? Typing beats a pending
   * removal, so the two cannot contradict each other.
   */
  const secretSet = secret.trim() ? true : !clearSecret && twilio.authSecret.set;

  const problem = twilioConfigProblem(fields, secretSet);

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
          twilio: {
            enabled,
            accountSid,
            apiKeySid,
            fromNumber,
            messagingServiceSid,
            // null clears it, a string replaces it, and undefined is dropped by
            // JSON.stringify — which is the wire format for "leave it alone".
            authSecret: clearSecret ? null : secret.trim() || undefined,
          },
        },
      });
      toast(enabled ? 'SMS sending is on' : 'SMS settings saved — sending is off');
      // The Notify modal asks the server whether it may offer a send button, so
      // a refresh is what makes a newly enabled channel show up there.
      router.refresh();
    } catch (err) {
      toast(errMessage(err), 'danger');
    }
    setBusy(null);
  }

  /**
   * Checks the saved credentials, and texts a number if one is given.
   *
   * Tests what is stored, not what is on screen — so an admin saves first. That
   * is deliberate: a test that accepted the typed secret would be a second route
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
      toast('Twilio answered');
    } catch (err) {
      setTestResult(errMessage(err));
      toast('Twilio test failed', 'danger');
    }
    setBusy(null);
  }

  return (
    <form className="somo-card" onSubmit={save}>
      <h3>
        SMS sending (Twilio)
        <InfoHint label="SMS sending">
          <p>
            With this on, the <strong>Notify</strong> button can send a delivery&rsquo;s alerts
            straight from the portal instead of opening WhatsApp for you to tap send. The wording
            is identical either way — it comes from the same place.
          </p>
          <p>
            Use an <strong>API key</strong> rather than your Auth Token if you can (Twilio Console
            → Account → API keys &amp; tokens). An API key can be revoked on its own; the Auth
            Token is full account access and also signs your webhooks, so replacing it breaks
            everything else pointed at the account.
          </p>
          <p>
            Nothing here reaches a browser except what you see: the SIDs and the sender come back
            so you can check them, and the secret never leaves the server.
          </p>
        </InfoHint>
        <span className="tag-note">{enabled ? 'sending' : 'off'}</span>
      </h3>

      <label className={`somo-check${enabled ? ' checked' : ''}`} style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Send delivery alerts by SMS automatically
      </label>

      <label className="somo-field">
        <span>Account SID</span>
        <input
          className="somo-input"
          placeholder="AC…"
          autoComplete="off"
          spellCheck={false}
          value={accountSid}
          onChange={(e) => setAccountSid(e.target.value)}
        />
      </label>

      <label className="somo-field">
        <span>
          API Key SID — optional
          <InfoHint label="API Key SID">
            <p>
              Leave this blank to authenticate with your account Auth Token instead. Filling it in
              means the secret below is that key&rsquo;s secret, which Twilio shows once, when the
              key is created.
            </p>
          </InfoHint>
        </span>
        <input
          className="somo-input"
          placeholder="SK… — blank to use the Auth Token"
          autoComplete="off"
          spellCheck={false}
          value={apiKeySid}
          onChange={(e) => setApiKeySid(e.target.value)}
        />
      </label>

      <label className="somo-field">
        <span>
          {apiKeySid.trim() ? 'API Key Secret' : 'Auth Token'}
          {twilio.authSecret.set ? (
            <button
              type="button"
              className="somo-inline-link"
              onClick={() => setClearSecret((v) => !v)}
            >
              {clearSecret ? 'keep it after all' : 'remove'}
            </button>
          ) : null}
        </span>
        <input
          className="somo-input"
          type="password"
          autoComplete="off"
          placeholder={
            clearSecret
              ? 'Will be removed when you save'
              : twilio.authSecret.set
                ? `${twilio.authSecret.masked} — leave blank to keep`
                : 'Paste it here'
          }
          value={secret}
          onChange={(e) => {
            if (clearSecret && e.target.value) setClearSecret(false);
            setSecret(e.target.value);
          }}
        />
        {!twilio.authSecret.set && !secret ? (
          <span className="somo-field-note">Not configured</span>
        ) : null}
      </label>

      <label className="somo-field">
        <span>
          Twilio number or sender name
          <InfoHint label="sender">
            <p>
              A Twilio number you own, in full international form — <code>+233201234567</code>.
            </p>
            <p>
              Or a sender name of up to 11 letters and digits, which shows in place of a number.
              Cheaper to brand, but one-way: nobody can reply to it. Every alert the portal sends
              carries a tap-through link rather than asking for a reply, so that costs nothing
              here.
            </p>
          </InfoHint>
        </span>
        <input
          className="somo-input"
          placeholder="+233201234567 or SOMOEXPRESS"
          autoComplete="off"
          spellCheck={false}
          value={fromNumber}
          onChange={(e) => setFromNumber(e.target.value)}
        />
      </label>

      <label className="somo-field">
        <span>
          Messaging Service SID — optional
          <InfoHint label="Messaging Service SID">
            <p>
              A Messaging Service holds a pool of numbers and picks a sensible one per recipient.
              Twilio recommends it once you have more than one number, and it can be re-pointed
              without touching this portal.
            </p>
            <p>Set, it replaces the number above rather than adding to it.</p>
          </InfoHint>
        </span>
        <input
          className="somo-input"
          placeholder="MG… — leave blank to send from the number above"
          autoComplete="off"
          spellCheck={false}
          value={messagingServiceSid}
          onChange={(e) => setMessagingServiceSid(e.target.value)}
        />
      </label>

      {problem ? (
        <div className="somo-note" style={{ marginTop: 0 }}>
          {problem}
        </div>
      ) : (
        <div className="somo-note" style={{ marginTop: 0 }}>
          {describeSender(fields)}.{' '}
          {enabled
            ? 'Alerts will go out from the Notify button.'
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
              Checks the saved credentials against Twilio without sending anything. Add a number
              and it texts that too, so you can tell &ldquo;the credentials are wrong&rdquo; from
              &ldquo;the credentials are fine and this sender cannot reach this phone&rdquo;.
            </p>
            <p>Save first — the test uses what is stored, not what is typed above.</p>
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
        disabled={busy !== null || !twilio.authSecret.set}
      >
        {busy === 'test' ? <Spinner /> : null}
        {busy === 'test' ? 'Asking Twilio…' : testTo.trim() ? 'Test and send' : 'Test connection'}
      </button>

      {testResult ? <div className="somo-note">{testResult}</div> : null}
    </form>
  );
}
