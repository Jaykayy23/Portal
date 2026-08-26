// Twilio Programmable Messaging: the shape of the configuration, and what counts
// as valid.
//
// Deliberately dependency-free — no database, no admin client, no 'server-only'
// — for the same reason lib/deliveryMessages.ts is. Two callers need this and
// they sit on opposite sides of the wire:
//
//   the Settings form   tells the admin "that is not an Account SID" before
//                       spending a round trip to find out.
//   the Route Handler   checks the same fields again, because a browser is not
//                       where a rule is enforced.
//
// One definition, so the two can never disagree about which of them was right.
//
// The sending itself lives in lib/twilio.ts, which is server-only. This file
// knows nothing about the credentials — only about their shape.

import { isValidPhone, normalizePhone } from './phone';

/**
 * Twilio resource ids: a two-letter prefix naming the resource, then 32 hex
 * characters. The prefix is the whole point of checking them.
 *
 * An Account SID pasted into the API Key SID box is the mistake worth catching.
 * It authenticates perfectly well — AccountSid:AuthToken is a valid credential
 * pair — and then fails at the moment of sending with Twilio's own
 * "authentication error", which sends whoever is debugging it to look at the
 * secret rather than at the box above it.
 */
const SID_PATTERN = {
  account: /^AC[0-9a-fA-F]{32}$/,
  apiKey: /^SK[0-9a-fA-F]{32}$/,
  messagingService: /^MG[0-9a-fA-F]{32}$/,
} as const;

/**
 * An alphanumeric sender ID: the sender shows as a word rather than a number.
 *
 * Worth supporting rather than insisting on E.164, because it is how most
 * Ghanaian bulk traffic is actually branded — a rider gets "SOMOEXPRESS", not a
 * number they have to recognise. Twilio's rule is 1–11 characters starting with
 * a letter.
 *
 * The trade-off is that it is one-way: nobody can reply to an alphanumeric
 * sender. Every message this portal sends carries a tap-through link rather than
 * asking for a text back, so that costs nothing here — but it is why a Twilio
 * number is still the safer default, and the Settings page says so.
 */
const ALPHANUMERIC_SENDER = /^[A-Za-z][A-Za-z0-9 ]{0,10}$/;

export function isAccountSid(value: string): boolean {
  return SID_PATTERN.account.test(value.trim());
}

export function isApiKeySid(value: string): boolean {
  return SID_PATTERN.apiKey.test(value.trim());
}

export function isMessagingServiceSid(value: string): boolean {
  return SID_PATTERN.messagingService.test(value.trim());
}

/**
 * A number in the form Twilio's API wants, or '' when it is not a number at all.
 *
 * Twilio requires E.164 with the leading '+'. lib/phone.ts already owns the
 * house rule for turning what people type into digits — 0-prefixed locals become
 * +233 — and this is that result with the plus put back, so the number a rider
 * is texted is the same one the portal would have opened WhatsApp with.
 */
export function toE164(raw: string | null | undefined): string {
  return isValidPhone(raw) ? `+${normalizePhone(raw)}` : '';
}

/** Which of the two sender fields Twilio will actually use, and how it reads. */
export type SenderKind = 'messaging-service' | 'number' | 'alphanumeric' | 'none';

/**
 * The configuration as the app holds it, minus the secret. The shape that
 * carries the secret lives in lib/twilio.ts and never travels outward.
 */
export interface TwilioConfigFields {
  enabled: boolean;
  accountSid: string;
  apiKeySid: string;
  fromNumber: string;
  messagingServiceSid: string;
}

type SenderFields = Pick<TwilioConfigFields, 'fromNumber' | 'messagingServiceSid'>;

/**
 * How the sender resolves, given both fields.
 *
 * A Messaging Service wins when both are set, and that is Twilio's own
 * recommendation rather than an arbitrary tie-break: the service holds a pool of
 * numbers, picks a sensible one per destination, and can be re-pointed without
 * anybody touching this portal. A bare `From` is the simpler thing that works on
 * day one.
 */
export function senderKind(fields: SenderFields): SenderKind {
  if (fields.messagingServiceSid.trim()) return 'messaging-service';

  const from = fields.fromNumber.trim();
  if (!from) return 'none';
  return toE164(from) ? 'number' : 'alphanumeric';
}

/** One line naming who a recipient will see the message from. For the UI. */
export function describeSender(fields: SenderFields): string {
  switch (senderKind(fields)) {
    case 'messaging-service':
      return 'Messaging Service — Twilio picks the number from its pool';
    case 'number':
      return `From ${toE164(fields.fromNumber)}`;
    case 'alphanumeric':
      return `From “${fields.fromNumber.trim()}” — a name, so nobody can reply`;
    case 'none':
      return 'No sender set';
  }
}

/**
 * Is this configuration complete enough to send with?
 *
 * `secretSet` is passed in rather than read, because the two callers who can
 * answer it are on opposite sides of the wire: the browser knows a secret is
 * stored from the mask it was given, the server knows because it holds the
 * value. Neither needs the other's answer.
 */
export function isSendable(fields: TwilioConfigFields, secretSet: boolean): boolean {
  return !!fields.accountSid.trim() && secretSet && senderKind(fields) !== 'none';
}

/**
 * What is wrong with this configuration, in a sentence an admin can act on, or
 * null when nothing is.
 *
 * Order matters. Shape complaints come first and only for fields that were
 * actually filled in, so a half-finished form is corrected on what is in it
 * rather than being handed five objections at once.
 *
 * A blank configuration is not an error: that is an integration nobody has set
 * up, and it is the shipped default. Only `enabled` turns "incomplete" into
 * something worth refusing — which is exactly what the app_settings_twilio_ready
 * constraint says in the database, in the one place it cannot be bypassed.
 */
export function twilioConfigProblem(
  fields: TwilioConfigFields,
  secretSet: boolean
): string | null {
  const accountSid = fields.accountSid.trim();
  const apiKeySid = fields.apiKeySid.trim();

  if (accountSid && !isAccountSid(accountSid)) {
    return 'That does not look like an Account SID — it starts with "AC" and is 34 characters long. It is on the Twilio Console home page.';
  }
  if (apiKeySid && !isApiKeySid(apiKeySid)) {
    // Called out by name, because pasting the Account SID here is the likely
    // slip and the failure it causes points somewhere else entirely.
    return isAccountSid(apiKeySid)
      ? 'That is the Account SID, not an API Key SID. An API Key SID starts with "SK" — or leave this box blank and use your account Auth Token as the secret.'
      : 'That does not look like an API Key SID — it starts with "SK" and is 34 characters long.';
  }
  if (fields.messagingServiceSid.trim() && !isMessagingServiceSid(fields.messagingServiceSid)) {
    return 'That does not look like a Messaging Service SID — it starts with "MG" and is 34 characters long.';
  }

  const from = fields.fromNumber.trim();
  if (
    from &&
    senderKind({ fromNumber: from, messagingServiceSid: '' }) === 'alphanumeric' &&
    !ALPHANUMERIC_SENDER.test(from)
  ) {
    return `“${from}” is not a usable sender. Use a Twilio number (e.g. +233201234567), or a sender name of up to 11 letters and digits starting with a letter.`;
  }

  if (!fields.enabled) return null;

  // Past here the admin has asked for sending to be *on*, so staying quiet about
  // a missing piece would mean alerts that never arrive and nothing to say why.
  if (!accountSid) {
    return 'Add your Twilio Account SID before turning SMS sending on.';
  }
  if (!secretSet) {
    return apiKeySid
      ? 'Add the API Key Secret before turning SMS sending on. Twilio shows it once, when the key is created.'
      : 'Add your Auth Token (or an API Key SID and Secret) before turning SMS sending on.';
  }
  if (senderKind(fields) === 'none') {
    return 'Add a Twilio number or a Messaging Service SID — a message needs somebody to come from.';
  }
  return null;
}
