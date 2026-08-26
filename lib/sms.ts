// Hard build-time guard: importing this from a Client Component becomes a build
// error rather than a silent leak of the portal's BMS API key.
import 'server-only';

// Sending SMS through BMS (developer.bms.africa, which is mNotify's API).
//
// This is the other half of the seam lib/deliveryMessages.ts was written around:
// that file decides what to say and to whom, this one dials. It consumes exactly
// the OutboundMessage list the Notify modal renders, so a message sent from here
// and a message sent by hand from a wa.me link are the same words — there is no
// second copy of the wording to drift.
//
// --- the API key travels in the query string --------------------------------
//
// Not a choice. BMS takes it as `?key=…` on every request; there is no header
// form and no token exchange. Two consequences worth being deliberate about:
//
//   1. The URL is never logged. Every console.error below is written to name the
//      endpoint and the provider's own error, never the request URL — because on
//      this API the URL *is* the credential. That is why the helper below builds
//      the URL at the point of use rather than holding it in a variable that a
//      later `console.error(url)` could pick up by accident.
//   2. HTTPS still covers it in transit: the query string is inside the encrypted
//      body of the request, so it is visible to BMS and to nothing in between.
//      What it is exposed to is anything that logs URLs at either end.
//
// There is nothing this portal can do about (2) beyond keeping the key out of
// its own logs, which is (1). Worth knowing when deciding how widely to share
// the key.
//
// --- where the credentials come from ----------------------------------------
//
// app_settings, read with the service-role client — the same path the Maps key
// takes, and the same reason: that table is granted to no public role, so this
// module is the authorisation boundary. Nothing here checks who the caller is.
// The Route Handlers do that before they call in, exactly as they do for
// lib/deliveryLinks.ts.
//
// The key never travels outward. There is no exported function that returns it,
// and SmsStatus — the shape the Settings page and the Notify modal receive — has
// no field that could carry it.

import { createAdminClient } from './supabase/admin';
import { smsParts, toBmsRecipient, toGsm7, type SmsConfigFields } from './smsConfig';
import type { OutboundMessage } from './deliveryMessages';

export class SmsError extends Error {}

const API_BASE = 'https://api.mnotify.com/api';

/**
 * Long enough for a slow round trip, short enough that a hung connection does
 * not hold a Route Handler — and the ops person watching a spinner — open
 * indefinitely. A timeout is reported as a failure to send, which is the honest
 * answer: BMS may or may not have taken the message.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * BMS's own cap on a single message. Longer is rejected outright rather than
 * split, so it is checked before anything is posted.
 */
const MAX_BODY_CHARS = 1_600;

/** The credentials, assembled. Never returned by anything exported. */
interface SmsCredentials extends SmsConfigFields {
  apiKey: string;
}

/**
 * What the rest of the app is allowed to know about the SMS setup.
 *
 * Deliberately not the credentials. The Notify modal needs one boolean — may I
 * offer a send button? — and one line of text for when the answer is no. The
 * sender ID is not secret, but it is not a merchant's business either, so
 * nothing but this crosses back.
 */
export interface SmsStatus {
  enabled: boolean;
  /** Why sending is unavailable, for the modal to show instead of a button. */
  reason: string;
}

const OFF: SmsStatus = {
  enabled: false,
  reason: 'SMS sending is not set up. An admin can add BMS credentials under Settings.',
};

/**
 * Reads the credentials, or null when the portal is not configured to send.
 *
 * Null covers three cases that are all the same to a caller: nothing configured,
 * configured but switched off, and switched on but incomplete. The third should
 * be impossible — app_settings_sms_ready refuses that row — and is checked
 * anyway, because "the constraint was added later than the deploy" is exactly
 * the situation where a send path must fail closed rather than post a half-formed
 * request to a paid API.
 */
async function loadCredentials(): Promise<SmsCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('sms_enabled, sms_api_key, sms_sender_id')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new SmsError(error.message);
  if (!data?.sms_enabled) return null;

  const creds: SmsCredentials = {
    enabled: true,
    apiKey: data.sms_api_key.trim(),
    senderId: data.sms_sender_id.trim(),
  };

  if (!creds.apiKey || !creds.senderId) return null;
  return creds;
}

/**
 * May this portal send an SMS right now?
 *
 * Called on every Notify modal open, so it is one indexed read of a single-row
 * table and nothing is cached across requests — the whole point is that an admin
 * can turn sending on and have the next modal offer it.
 */
export async function smsStatus(): Promise<SmsStatus> {
  try {
    return (await loadCredentials()) ? { enabled: true, reason: '' } : OFF;
  } catch (e) {
    // Fails soft, and only here. An app deployed ahead of the SMS migration asks
    // PostgREST for columns that do not exist yet, and the honest answer to "may
    // I offer a send button?" is no — not a 500 on every Notify modal open. The
    // send paths still throw, because there the caller has asked for something
    // that cannot be done and needs telling.
    console.error('Could not read the SMS configuration.', e instanceof Error ? e.message : e);
    return OFF;
  }
}

/**
 * One request to BMS.
 *
 * The URL — which carries the key — is built here and goes out of scope
 * immediately. Callers get the parsed body and never hold anything that could be
 * logged by accident.
 */
async function call(
  apiKey: string,
  path: string,
  init?: { method: 'POST'; body: unknown }
): Promise<{ ok: boolean; status: number; payload: BmsEnvelope }> {
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: init ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = ((await res.json().catch(() => null)) ?? {}) as BmsEnvelope;
  return { ok: res.ok, status: res.status, payload };
}

/**
 * Every BMS response has this outer shape. `status` is the one to read: the API
 * answers HTTP 200 with `status: "error"` for some failures, so `res.ok` alone
 * is not the question.
 */
interface BmsEnvelope {
  status?: string;
  code?: string;
  message?: string;
  balance?: number;
  bonus?: number;
  summary?: {
    _id?: string;
    total_sent?: number;
    contacts?: number;
    total_rejected?: number;
    credit_used?: number;
    credit_left?: number;
    /** senderid/status returns the approval state under this key. */
    status?: string;
    'sender name'?: string;
  };
}

/**
 * BMS's failures, in the words of whoever has to fix them.
 *
 * The published docs only document the success code (2000), so this leans on the
 * HTTP status and the provider's own `message` and adds a sentence only where the
 * likely cause is something an admin can act on and the raw message would not say
 * so. Anything unrecognised falls through to BMS's wording, which is better than
 * inventing a diagnosis.
 */
function explain(status: number, payload: BmsEnvelope, fallback: string): string {
  if (status === 401 || status === 403) {
    return 'BMS rejected the API key. Copy it again from the BMS dashboard — the key is the whole credential, so a partial paste fails exactly like a wrong one.';
  }
  if (status === 429) {
    return 'BMS is rate limiting this account. Wait a moment before sending again.';
  }
  if (status >= 500) {
    return 'BMS is not responding properly right now. The message was not sent — use the WhatsApp or SMS button instead.';
  }
  const message = payload.message?.trim();
  if (message) {
    // Their validation messages are usable as-is; the code is worth appending
    // because it is what BMS support will ask for.
    return payload.code && payload.code !== '2000' ? `${message} (BMS code ${payload.code})` : message;
  }
  return fallback;
}

/** One send, as reported back to whoever asked for it. */
export interface SmsResult {
  ok: boolean;
  /**
   * BMS's campaign id (`summary._id`). Worth carrying: it is what a delivery
   * report is looked up by, and what BMS support will ask for.
   */
  campaignId: string;
  /** Billable parts this message cost. */
  parts: number;
  /** SMS credits left on the account after this send, or -1 when not reported. */
  creditLeft: number;
  /** A sentence for the person who pressed send. Empty when ok. */
  error: string;
}

/**
 * Posts one message.
 *
 * Never throws for a provider-side refusal — a bad recipient number on one of
 * three messages should not abandon the other two — so every outcome except a
 * missing configuration comes back as an SmsResult with `ok: false`.
 */
async function postMessage(creds: SmsCredentials, to: string, rawBody: string): Promise<SmsResult> {
  const failed = (error: string): SmsResult => ({
    ok: false,
    campaignId: '',
    parts: 0,
    creditLeft: -1,
    error,
  });

  const recipient = toBmsRecipient(to);
  if (!recipient) {
    return failed('No usable phone number on file for this recipient.');
  }

  // Substituted before anything else measures or sends it, so the length check,
  // the part count and the wire body all agree on one string.
  const body = toGsm7(rawBody);
  if (!body.trim()) {
    return failed('Nothing to send — the message came out empty.');
  }
  if (body.length > MAX_BODY_CHARS) {
    // Not truncated on purpose: every message this portal sends that is long
    // enough to hit this ends with a tap-through link, and a truncated one would
    // arrive looking complete with the only actionable part cut off.
    return failed(
      `That message is ${body.length} characters and the limit is ${MAX_BODY_CHARS}. Shorten the addresses on this delivery.`
    );
  }

  let response: Awaited<ReturnType<typeof call>>;
  try {
    response = await call(creds.apiKey, '/sms/quick', {
      method: 'POST',
      body: {
        // An array even for one number: this is the bulk endpoint, and it is the
        // only "send now" endpoint BMS has.
        recipient: [recipient],
        sender: creds.senderId,
        message: body,
        is_schedule: false,
        schedule_date: '',
        // `sms_type: 'otp'` is deliberately absent. BMS charges an extra 0.035
        // per campaign for it and warns that including it on non-OTP traffic
        // causes validation errors. None of these messages is a one-time code.
      },
    });
  } catch (e) {
    // Includes the timeout. Deliberately vague about the outcome, because that is
    // genuinely unknown: the request may have reached BMS.
    console.error('BMS send did not complete.', e instanceof Error ? e.message : e);
    return failed(
      'Could not reach BMS. The message may not have been sent — check the BMS dashboard before re-sending.'
    );
  }

  const { ok, status, payload } = response;

  if (!ok || payload.status !== 'success') {
    // The HTTP status and BMS's own code carry nothing of ours — no key, no
    // recipient — so they are safe in a server log, and they are the two things
    // worth having when somebody reports "the SMS did not arrive".
    console.error(`BMS refused a send: HTTP ${status}, code ${payload.code ?? 'none'}`);
    return failed(explain(status, payload, 'BMS would not accept the message.'));
  }

  const summary = payload.summary ?? {};
  const creditLeft = typeof summary.credit_left === 'number' ? summary.credit_left : -1;

  // A campaign can succeed as a whole and still reject the only number in it —
  // an unrouteable prefix, a blacklisted subscriber. `status: "success"` is about
  // the request, not the recipient, so this is checked separately or a failed
  // send would report as delivered.
  if ((summary.total_rejected ?? 0) > 0 && (summary.total_sent ?? 0) === 0) {
    return {
      ...failed(
        'BMS accepted the request but rejected this number. Check it is a live Ghanaian mobile number, then look the campaign up in the BMS dashboard.'
      ),
      campaignId: summary._id ?? '',
      creditLeft,
    };
  }

  return {
    ok: true,
    campaignId: summary._id ?? '',
    // BMS reports what it charged; our own count is the fallback when it does
    // not, and the two agreeing is a decent sign the GSM-7 substitution worked.
    parts: summary.credit_used ?? smsParts(body),
    creditLeft,
    error: '',
  };
}

/**
 * Confirms the stored credentials work, without sending anything.
 *
 * Two free calls, because there are two independent things to be wrong and they
 * fail identically from the Settings page — a message that simply never arrives:
 *
 *   the balance check    proves the API key is accepted, and says how many
 *                        credits are left, which is the other thing that makes
 *                        sending stop dead.
 *   the sender ID check  proves BMS has approved the name. An unapproved sender
 *                        is the failure that looks most like a broken
 *                        integration, because the credentials are fine.
 *
 * Worth having as its own button precisely because the alternative is diagnosing
 * it by spending credits on messages nobody receives.
 */
export async function verifySmsCredentials(): Promise<{ ok: boolean; detail: string }> {
  const creds = await loadCredentials();
  if (!creds) {
    return {
      ok: false,
      detail: 'Nothing to test yet — save an API key and a sender ID, and switch SMS sending on.',
    };
  }

  let balance: Awaited<ReturnType<typeof call>>;
  try {
    balance = await call(creds.apiKey, '/balance/sms');
  } catch (e) {
    console.error('BMS balance check did not complete.', e instanceof Error ? e.message : e);
    return { ok: false, detail: 'Could not reach BMS — check the server’s outbound connection.' };
  }

  if (!balance.ok || balance.payload.status !== 'success') {
    console.error(`BMS balance check failed: HTTP ${balance.status}, code ${balance.payload.code ?? 'none'}`);
    return { ok: false, detail: explain(balance.status, balance.payload, 'BMS rejected the API key.') };
  }

  const credits = balance.payload.balance ?? 0;
  const bonus = balance.payload.bonus ?? 0;
  const wallet = `${credits} SMS credit${credits === 1 ? '' : 's'}${bonus > 0 ? ` plus ${bonus} bonus` : ''}`;

  // The sender ID is checked second and never fails the whole test: the key is
  // demonstrably good at this point, and "approved" is a state BMS controls on
  // its own schedule. Reporting it as a warning is more useful than a red cross
  // on a configuration that is otherwise right.
  let approval = '';
  try {
    const sender = await call(creds.apiKey, '/senderid/status', {
      method: 'POST',
      body: { sender_name: creds.senderId },
    });

    const state = sender.payload.summary?.status;
    if (sender.ok && sender.payload.status === 'success' && state) {
      approval =
        state.toLowerCase() === 'approved'
          ? ` Sender ID “${creds.senderId}” is approved.`
          : ` Sender ID “${creds.senderId}” is ${state} — until BMS approves it, sends will be rejected.`;
    } else {
      approval = ` BMS did not recognise the sender ID “${creds.senderId}” — register it in the dashboard.`;
    }
  } catch {
    // A failure here says nothing about the key, so it says nothing at all.
    approval = '';
  }

  if (credits === 0 && bonus === 0) {
    return {
      ok: false,
      detail: `The API key works, but the account has no SMS credits left — nothing will send until it is topped up.${approval}`,
    };
  }

  return { ok: true, detail: `Connected to BMS with ${wallet}.${approval}` };
}

/** One OutboundMessage, and what became of it. */
export interface OutboundSendResult extends SmsResult {
  /** OutboundMessage.id — what the Notify modal keys its rows on. */
  id: string;
  who: string;
  phone: string;
}

/**
 * Sends a list of composed messages.
 *
 * Sequential rather than parallel, deliberately: three messages is the most any
 * one delivery event produces, and firing them at once earns a rate limit rather
 * than a faster send. Sending them in order also means the credit balance in the
 * last result is the account's actual remaining balance.
 *
 * Throws only when the portal cannot send at all. A per-message failure is a
 * result with `ok: false`, so a rider whose number is wrong does not stop the
 * merchant and ops being told.
 */
export async function sendOutbound(messages: OutboundMessage[]): Promise<OutboundSendResult[]> {
  const creds = await loadCredentials();
  if (!creds) throw new SmsError(OFF.reason);

  const results: OutboundSendResult[] = [];
  for (const message of messages) {
    const result = await postMessage(creds, message.phone, message.text);
    results.push({ ...result, id: message.id, who: message.who, phone: message.phone });
  }
  return results;
}

/**
 * One message to one number, for the admin's own test send from Settings.
 *
 * Separate from sendOutbound() because it is not a delivery alert: there is no
 * OutboundMessage behind it and nothing in the log it belongs to.
 */
export async function sendTestSms(to: string, body: string): Promise<SmsResult> {
  const creds = await loadCredentials();
  if (!creds) throw new SmsError(OFF.reason);
  return postMessage(creds, to, body);
}
