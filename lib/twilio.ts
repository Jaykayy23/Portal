// Hard build-time guard: importing this from a Client Component becomes a build
// error rather than a silent leak of the portal's Twilio credentials.
import 'server-only';

// Sending SMS through Twilio's Programmable Messaging REST API.
//
// This is the other half of the seam lib/deliveryMessages.ts was written around:
// that file decides what to say and to whom, this one dials. It consumes exactly
// the OutboundMessage list the Notify modal renders, so a message sent from here
// and a message sent by hand from a wa.me link are the same words — there is no
// second copy of the wording to drift.
//
// --- why fetch and not the twilio SDK ---------------------------------------
//
// The SDK is a large dependency whose main job is constructing one form-encoded
// POST and reading one JSON body back. It also expects credentials at client
// construction time from the environment, which is the wrong shape here: the
// credentials live in app_settings and are edited by an admin at runtime, so a
// client would have to be built per request anyway. Twilio's API is stable
// (2010-04-01, still current) and the surface used here is one endpoint.
//
// --- where the credentials come from ---------------------------------------
//
// app_settings, read with the service-role client — the same path the Maps key
// takes, and the same reason: that table is granted to no public role, so this
// module is the authorisation boundary. Nothing here checks who the caller is.
// The Route Handlers do that before they call in, exactly as they do for
// lib/deliveryLinks.ts.
//
// The secret never travels outward. There is no exported function that returns
// it, and TwilioStatus — the shape the Settings page and the Notify modal
// receive — has no field that could carry it.

import { createAdminClient } from './supabase/admin';
import { senderKind, toE164, type TwilioConfigFields } from './twilioConfig';
import type { OutboundMessage } from './deliveryMessages';

export class TwilioError extends Error {}

/** Twilio's API version. Part of the path, not a header. */
const API_VERSION = '2010-04-01';

/**
 * Long enough for a slow round trip out of Accra, short enough that a hung
 * connection does not hold a Route Handler — and the ops person watching a
 * spinner — open indefinitely. A timeout is reported as a failure to send, which
 * is the honest answer: Twilio may or may not have taken the message.
 */
const REQUEST_TIMEOUT_MS = 12_000;

/** Twilio's hard cap on a single message body. */
const MAX_BODY_CHARS = 1_600;

/** The credentials, assembled. Never returned by anything exported. */
interface TwilioCredentials extends TwilioConfigFields {
  secret: string;
}

/**
 * What the rest of the app is allowed to know about the SMS setup.
 *
 * Deliberately not the credentials. The Notify modal needs one boolean — may I
 * offer a send button? — and one line of text for when the answer is no. Neither
 * the Account SID nor the sender is secret, but neither is any of a merchant's
 * or ops' business either, so nothing but this crosses back.
 */
export interface TwilioStatus {
  enabled: boolean;
  /** Why sending is unavailable, for the modal to show instead of a button. */
  reason: string;
}

const OFF: TwilioStatus = {
  enabled: false,
  reason: 'SMS sending is not set up. An admin can add Twilio credentials under Settings.',
};

/**
 * Reads the credentials, or null when the portal is not configured to send.
 *
 * Null covers three cases that are all the same to a caller: nothing configured,
 * configured but switched off, and switched on but incomplete. The third should
 * be impossible — app_settings_twilio_ready refuses that row — and is checked
 * anyway, because "the constraint was added later than the deploy" is exactly
 * the situation where a send path must fail closed rather than post a half-formed
 * request to a paid API.
 */
async function loadCredentials(): Promise<TwilioCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select(
      'twilio_enabled, twilio_account_sid, twilio_api_key_sid, twilio_auth_secret, twilio_from_number, twilio_messaging_service_sid'
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new TwilioError(error.message);
  if (!data?.twilio_enabled) return null;

  const creds: TwilioCredentials = {
    enabled: true,
    accountSid: data.twilio_account_sid.trim(),
    apiKeySid: data.twilio_api_key_sid.trim(),
    secret: data.twilio_auth_secret,
    fromNumber: data.twilio_from_number.trim(),
    messagingServiceSid: data.twilio_messaging_service_sid.trim(),
  };

  if (!creds.accountSid || !creds.secret || senderKind(creds) === 'none') return null;
  return creds;
}

/**
 * May this portal send an SMS right now?
 *
 * Called on every Notify modal open, so it is one indexed read of a
 * single-row table and returns nothing worth caching across requests — the whole
 * point is that an admin can turn sending on and have the next modal offer it.
 */
export async function twilioStatus(): Promise<TwilioStatus> {
  let creds: TwilioCredentials | null;
  try {
    creds = await loadCredentials();
  } catch (e) {
    // Fails soft, and only here. An app deployed ahead of the Twilio migration
    // asks PostgREST for columns that do not exist yet, and the honest answer to
    // "may I offer a send button?" is no — not a 500 on every Notify modal open.
    // The send paths still throw, because there the caller has asked for
    // something that cannot be done and needs telling.
    console.error('Could not read the SMS configuration.', e instanceof Error ? e.message : e);
    return OFF;
  }

  if (!creds) return OFF;
  return { enabled: true, reason: '' };
}

/**
 * HTTP Basic, the way Twilio documents it.
 *
 * The username is the API Key SID when there is one and the Account SID
 * otherwise, which is not a fallback so much as the two credential pairs Twilio
 * accepts on the same endpoint:
 *
 *   SK… : api key secret    scoped, revocable on its own, and what Twilio
 *                           recommends. Revoking it costs nothing else.
 *   AC… : auth token        full account access, and the same token that signs
 *                           webhooks — so rotating it after a leak breaks
 *                           everything else pointed at the account.
 *
 * Both work here. The Settings page explains the difference and the README says
 * to use an API key; treating them as one code path is what keeps that a
 * recommendation rather than a second integration to maintain.
 */
function authHeader(creds: TwilioCredentials): string {
  const username = creds.apiKeySid || creds.accountSid;
  return `Basic ${Buffer.from(`${username}:${creds.secret}`).toString('base64')}`;
}

/** The error body Twilio returns. `code` is the interesting part. */
interface TwilioErrorBody {
  code?: number;
  message?: string;
  more_info?: string;
}

/**
 * Twilio's numeric codes, in the words of whoever has to fix it.
 *
 * Only the ones that are actually somebody's fault and actionable from here.
 * Anything else falls through to Twilio's own message, which is usually decent —
 * this table exists because the few codes below are the ones whose Twilio wording
 * sends people looking in the wrong place.
 */
function explainCode(body: TwilioErrorBody, status: number): string {
  switch (body.code) {
    case 20003:
      return 'Twilio rejected the credentials. Check the Account SID, and that the secret is the API Key Secret for the API Key SID above it (or the Auth Token, if that box is blank).';
    case 20404:
      // Reached with a well-formed but wrong Account SID: the URL contains it, so
      // a typo becomes "no such account" rather than an auth failure.
      return 'Twilio has no account with that Account SID. Check it against the Console home page.';
    case 21211:
      return 'Twilio will not accept that recipient number. Check it on the delivery, rider or account record.';
    case 21408:
      return 'Your Twilio account is not permitted to send to that country. Enable the destination under Messaging → Geo permissions in the Console.';
    case 21606:
    case 21659:
    case 21660:
      return 'The sender is not a number this Twilio account can send from. Check the Twilio number under Settings, or use a Messaging Service.';
    case 21608:
      return 'This is a Twilio trial account, which can only text verified numbers. Verify the recipient in the Console, or upgrade the account.';
    case 21610:
      return 'That recipient has replied STOP to this sender and Twilio will not text them again until they opt back in.';
    case 21612:
      return 'Twilio has no route from that sender to that recipient. A Messaging Service, or a local number, is usually the fix.';
    case 30034:
      return 'The sending number is not registered for A2P 10DLC, which US carriers require. Complete the registration in the Twilio Console.';
    case 63038:
      return 'This Twilio account has hit its daily message limit.';
    default:
      break;
  }

  if (body.message) {
    return body.more_info ? `${body.message} (${body.more_info})` : body.message;
  }
  return `Twilio refused the message (HTTP ${status}).`;
}

/** One send, as reported back to whoever asked for it. */
export interface SmsResult {
  ok: boolean;
  /** Twilio's message SID, for looking the send up in their Console. */
  sid: string;
  /** Twilio's own word for where it has got to: 'queued', 'accepted', 'sent'. */
  status: string;
  /**
   * Billable SMS parts. Surfaced rather than swallowed because it is the only
   * number in the response that costs money, and a long address turning one
   * message into four is invisible otherwise.
   */
  segments: number;
  /** A sentence for the person who pressed send. Empty when ok. */
  error: string;
}

/** Twilio's success body, narrowed to the fields worth reading. */
interface MessageResource {
  sid?: string;
  status?: string;
  num_segments?: string;
}

/**
 * Posts one message.
 *
 * Never throws for a Twilio-side refusal — a bad recipient number on one of
 * three messages should not abandon the other two — so every outcome except a
 * missing configuration comes back as an SmsResult with `ok: false`.
 */
async function postMessage(creds: TwilioCredentials, to: string, body: string): Promise<SmsResult> {
  const failed = (error: string): SmsResult => ({
    ok: false,
    sid: '',
    status: '',
    segments: 0,
    error,
  });

  const e164 = toE164(to);
  if (!e164) {
    return failed('No usable phone number on file for this recipient.');
  }
  if (!body.trim()) {
    return failed('Nothing to send — the message came out empty.');
  }
  if (body.length > MAX_BODY_CHARS) {
    // Not truncated on purpose: every message this portal sends that is long
    // enough to hit this ends with a tap-through link, and a truncated one would
    // arrive looking complete with the only actionable part cut off.
    return failed(
      `That message is ${body.length} characters and Twilio's limit is ${MAX_BODY_CHARS}. Shorten the addresses on this delivery.`
    );
  }

  const form = new URLSearchParams({
    To: e164,
    Body: body,
    // Rewrites look-alike Unicode to its GSM-7 equivalent before Twilio counts
    // segments. This is a billing fix, not a cosmetic one: the message templates
    // in lib/deliveryMessages.ts use en dashes and curly quotes, and a single
    // non-GSM character drops the segment size from 160 characters to 70 — so
    // one job offer becomes three or four billable parts. The characters look
    // identical on the handset either way.
    SmartEncoded: 'true',
  });

  // A Messaging Service supersedes From rather than accompanying it — Twilio
  // picks the sender out of the service's pool per destination.
  if (creds.messagingServiceSid) {
    form.set('MessagingServiceSid', creds.messagingServiceSid);
  } else {
    // E.164 when it is a number, verbatim when it is an alphanumeric sender ID.
    form.set('From', toE164(creds.fromNumber) || creds.fromNumber);
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.twilio.com/${API_VERSION}/Accounts/${creds.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader(creds),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
  } catch (e) {
    // Includes the timeout. Deliberately vague about the outcome, because that
    // is genuinely unknown: the request may have reached Twilio.
    console.error('Twilio request did not complete.', e instanceof Error ? e.message : e);
    return failed('Could not reach Twilio. The message may not have been sent — check the Twilio Console before re-sending.');
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* Twilio always sends JSON; a body that is not is handled by !res.ok below. */
  }

  if (!res.ok) {
    const body = (payload ?? {}) as TwilioErrorBody;
    // The code and status are Twilio's, and carry nothing of ours — no
    // credential, no recipient — so they are safe in a server log and are the
    // two things worth having when somebody reports "the SMS did not arrive".
    console.error(`Twilio refused a message: HTTP ${res.status}, code ${body.code ?? 'none'}`);
    return failed(explainCode(body, res.status));
  }

  const message = (payload ?? {}) as MessageResource;
  return {
    ok: true,
    sid: message.sid ?? '',
    // 'queued' or 'accepted' at this point. Twilio has taken it; whether the
    // handset ever sees it is a later question this portal does not yet ask —
    // see the status-callback note in the README.
    status: message.status ?? 'queued',
    segments: Number(message.num_segments) || 1,
    error: '',
  };
}

/**
 * Confirms the stored credentials actually work, without sending anything.
 *
 * A GET of the account resource is the cheapest authenticated call Twilio has:
 * it costs nothing, sends no message, and separates the two failures that look
 * identical from the Settings page — "these credentials are wrong" from "these
 * credentials are fine and the recipient or sender is the problem". Worth having
 * as its own button precisely because the alternative is diagnosing it by
 * spending money on messages that do not arrive.
 */
export async function verifyTwilioCredentials(): Promise<{ ok: boolean; detail: string }> {
  const creds = await loadCredentials();
  if (!creds) {
    return {
      ok: false,
      detail:
        'Nothing to test yet — save an Account SID, a secret and a sender, and switch SMS sending on.',
    };
  }

  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/${API_VERSION}/Accounts/${creds.accountSid}.json`, {
      headers: { Authorization: authHeader(creds) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('Twilio credential check did not complete.', e instanceof Error ? e.message : e);
    return { ok: false, detail: 'Could not reach Twilio — check the server’s outbound connection.' };
  }

  const payload = (await res.json().catch(() => null)) as
    | (TwilioErrorBody & { friendly_name?: string; status?: string })
    | null;

  if (!res.ok) {
    console.error(`Twilio credential check failed: HTTP ${res.status}, code ${payload?.code ?? 'none'}`);
    return { ok: false, detail: explainCode(payload ?? {}, res.status) };
  }

  // 'trial' here is worth saying out loud: a trial account sends only to numbers
  // verified in the Console, so credentials that pass this check can still refuse
  // every real rider's number with error 21608.
  const account = payload?.friendly_name ? `“${payload.friendly_name}”` : 'your Twilio account';
  const trial =
    payload?.status === 'trial'
      ? ' This is a trial account, so it can only text numbers verified in the Twilio Console.'
      : '';

  return { ok: true, detail: `Connected to ${account}.${trial}` };
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
 * Sequential rather than parallel, deliberately. A long-code Twilio number is
 * rate-limited to roughly one message a second, and firing three at once earns a
 * queue on Twilio's side instead of a faster send here. Three messages is the
 * most any single delivery event produces.
 *
 * Throws only when the portal cannot send at all. A per-message failure is a
 * result with `ok: false`, so a rider whose number is wrong does not stop the
 * merchant and ops being told.
 */
export async function sendOutbound(messages: OutboundMessage[]): Promise<OutboundSendResult[]> {
  const creds = await loadCredentials();
  if (!creds) throw new TwilioError(OFF.reason);

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
  if (!creds) throw new TwilioError(OFF.reason);
  return postMessage(creds, to, body);
}
