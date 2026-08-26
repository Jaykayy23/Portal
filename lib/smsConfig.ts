// The SMS configuration: its shape, what counts as valid, and how a message body
// is prepared for the wire.
//
// Deliberately dependency-free — no database, no admin client, no 'server-only'
// — for the same reason lib/deliveryMessages.ts is. Three callers need parts of
// it and they sit on opposite sides of the wire:
//
//   the Settings form   tells the admin "that sender ID is too long" before
//                       spending a round trip to find out.
//   the Route Handler   checks the same fields again, because a browser is not
//                       where a rule is enforced.
//   the sender          normalises the recipient and the body before posting.
//
// One definition, so no two of them can disagree about which was right.
//
// The sending itself lives in lib/sms.ts, which is server-only. This file never
// sees the API key.

import { isValidPhone, normalizePhone } from './phone';

/**
 * BMS's limit on a sender ID, and the reason it is checked rather than trusted.
 *
 * Eleven is the field width, not a safety margin: a twelfth character is
 * rejected at send time as a validation error, so the whole campaign fails and
 * nobody is told anything. Catching it in the form costs nothing.
 */
export const MAX_SENDER_ID_CHARS = 11;

/**
 * A sender ID is a name, not a number — BMS has no equivalent of a Twilio
 * number, so there is no reply path at all. Letters, digits, spaces, hyphens and
 * underscores, starting with a letter, which is what carriers will route.
 */
const SENDER_ID = /^[A-Za-z][A-Za-z0-9 _-]*$/;

/** The configuration as the app holds it. The key is not in here. */
export interface SmsConfigFields {
  enabled: boolean;
  senderId: string;
}

/**
 * The recipient in the form BMS wants.
 *
 * BMS is a Ghanaian provider and its own delivery reports echo numbers back as
 * `233241234567` — no plus — so that is what is sent, and it happens to be
 * exactly what lib/phone.ts already produces. The documented request examples
 * use the local `0241234567` form instead; both are accepted, and picking the
 * international one means a number that is already stored in full international
 * form is not silently re-interpreted as Ghanaian.
 *
 * '' when there is no usable number, which the send path reports per message
 * rather than posting and paying for a rejection.
 */
export function toBmsRecipient(raw: string | null | undefined): string {
  return isValidPhone(raw) ? normalizePhone(raw) : '';
}

/**
 * Typography that costs money.
 *
 * An SMS is 160 characters per part in GSM-7. One character outside that
 * alphabet forces the *whole* message into UCS-2, where a part is 70 characters
 * — so a single curly apostrophe turns a 300-character job offer from two parts
 * into five, at the same per-part price.
 *
 * The portal's own templates are full of exactly those characters: en and em
 * dashes, curly quotes, ellipses. Twilio has a `SmartEncoded` flag that does
 * this substitution server-side; BMS has nothing equivalent, so it has to happen
 * here. Every replacement is visually near-identical on a handset.
 */
const GSM7_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/[–—―]/g, '-'], // en dash, em dash, horizontal bar
  [/[‘’‚‛′]/g, "'"], // curly single quotes, prime
  [/[“”„‟″]/g, '"'], // curly double quotes
  [/…/g, '...'], // ellipsis
  [/[    ]/g, ' '], // non-breaking and thin spaces
  [/[•·]/g, '-'], // bullet, middle dot
  [/⁄/g, '/'], // fraction slash
  [/₦/g, 'NGN'], // naira — not in GSM-7, unlike the cedi's plain "GHS"
  [/™/g, 'TM'],
  [/®/g, '(R)'],
  [/→/g, '->'],
];

/**
 * Rewrites look-alike characters to their GSM-7 equivalents.
 *
 * Only the substitutions above. Anything else is left exactly as typed —
 * a merchant called "Zoë" or a Chinese shop name keeps its spelling and the
 * message costs what it costs. Mangling somebody's name into "Zo?" to save a
 * credit is the wrong trade, and the characters this portal *generates* are all
 * in the list, which is where the saving actually comes from.
 */
export function toGsm7(text: string): string {
  return GSM7_SUBSTITUTIONS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
}

/** The GSM-7 alphabet, including the escape-table characters. */
const GSM7_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
  '^{}\\[~]|€';

/** Characters that take two GSM-7 septets rather than one. */
const GSM7_EXTENDED = '^{}\\[~]|€';

/**
 * How many parts a message will actually be billed as.
 *
 * Surfaced to whoever presses send, because it is the only number in the flow
 * that costs money and a long drop-off address turning one alert into four is
 * otherwise invisible until the credit runs out. BMS reports `credit_used` after
 * the fact; this is the same figure before.
 */
export function smsParts(text: string): number {
  if (!text) return 0;

  // A single non-GSM character sets the encoding for the whole message. Counted
  // over code points rather than UTF-16 units so an emoji is one character, not
  // the two halves of a surrogate pair.
  const chars = [...text];
  const isGsm7 = chars.every((c) => GSM7_CHARS.includes(c));

  if (!isGsm7) {
    // UCS-2: 70 characters alone, 67 once concatenation headers are added.
    return chars.length <= 70 ? 1 : Math.ceil(chars.length / 67);
  }

  const septets = chars.reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0);
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

/** Is this configuration complete enough to send with? */
export function isSendable(fields: SmsConfigFields, keySet: boolean): boolean {
  return keySet && !!fields.senderId.trim();
}

/**
 * What is wrong with this configuration, in a sentence an admin can act on, or
 * null when nothing is.
 *
 * A blank configuration is not an error: that is an integration nobody has set
 * up, and it is the shipped default. Only `enabled` turns "incomplete" into
 * something worth refusing — which is what app_settings_sms_ready says in the
 * one place it cannot be bypassed.
 *
 * `keySet` is passed in rather than read, because the two callers who can answer
 * it are on opposite sides of the wire: the browser knows a key is stored from
 * the mask it was given, the server knows because it holds the value.
 */
export function smsConfigProblem(fields: SmsConfigFields, keySet: boolean): string | null {
  const senderId = fields.senderId.trim();

  if (senderId.length > MAX_SENDER_ID_CHARS) {
    return `“${senderId}” is ${senderId.length} characters — BMS allows at most ${MAX_SENDER_ID_CHARS}. A longer one is rejected at send time, not shortened.`;
  }
  if (senderId && !SENDER_ID.test(senderId)) {
    return 'A sender ID has to start with a letter and use only letters, digits, spaces, hyphens or underscores.';
  }

  if (!fields.enabled) return null;

  // Past here the admin has asked for sending to be *on*, so staying quiet about
  // a missing piece would mean alerts that never arrive and nothing to say why.
  if (!keySet) {
    return 'Add your BMS API key before turning SMS sending on. It is under Developer / API in the BMS dashboard.';
  }
  if (!senderId) {
    return 'Add the sender ID BMS approved for you — a message needs a name to come from.';
  }
  return null;
}
