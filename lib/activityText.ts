// The activity log, in words.
//
// Every row of user_activity is an action name plus a small blob of context, and
// this turns the pair into the sentence an admin reads. Pure and dependency-free
// on purpose: the writing side (lib/activity.ts) reaches createAdminClient() and
// so may never be imported by a Client Component, while the pane that renders
// these rows is one. Same split as lib/deliveryMessages.ts against lib/autoNotify.ts.
//
// Two rules the sentences follow, because an audit line is read by someone who
// was not there:
//
//   name the thing, not its id   "#4F2A1", "Yaw Mensah", "ama" — an admin
//                                scanning for what went wrong is matching
//                                against what they already know, and a uuid is
//                                not that. The ids are in the row if needed.
//   say what changed             "moved #4F2A1 from Requested to Approved", not
//                                "updated #4F2A1". A line that does not say what
//                                changed makes the reader open the record to
//                                find out, which is the work the log exists to
//                                save.
//
// The subject is always the actor and is rendered separately, so every sentence
// here starts with a verb in the past tense and never repeats the name.

import type { ActivityEntry } from './types';

/**
 * Every action the portal records, grouped the way the filter offers them.
 *
 * Dotted `noun.verb`, and the noun matches the screen the action happens on so
 * the filter reads like the nav. Adding one is an application change only — the
 * column is plain text, deliberately not an enum, so a new action never needs a
 * migration to land before the code that writes it.
 */
export const ACTIVITY_GROUPS = {
  'Sign-in': ['auth.signed_in', 'auth.signed_out'],
  Deliveries: [
    'delivery.created',
    'delivery.status_changed',
    'delivery.rider_assigned',
    'delivery.rider_cleared',
    'delivery.pickup_confirmed',
    'delivery.link_issued',
    'delivery.alert_sent',
    'delivery.exported',
  ],
  Money: ['settlement.recorded', 'settlement.voided', 'ledger.exported'],
  Accounts: [
    'account.created',
    'account.deactivated',
    'account.reactivated',
    'account.password_reset',
  ],
  Riders: ['rider.created', 'rider.status_changed'],
  Configuration: [
    'pricing.updated',
    'settings.updated',
    'delivery_options.updated',
    'sms.test_sent',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;

export type ActivityAction =
  (typeof ACTIVITY_GROUPS)[ActivityGroup][number];

export const ACTIVITY_ACTIONS: ActivityAction[] = Object.values(ACTIVITY_GROUPS).flat();

const IS_KNOWN_ACTION = new Set<string>(ACTIVITY_ACTIONS);

export function isActivityAction(value: string): value is ActivityAction {
  return IS_KNOWN_ACTION.has(value);
}

/** Reads a string off `details` without trusting that it is one. */
function text(details: ActivityEntry['details'], key: string): string {
  const value = details?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function count(details: ActivityEntry['details'], key: string): number {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * "3 rows" / "1 row" — the plural nobody should be writing out by hand twice.
 *
 * `many` is for the nouns an 's' does not fix. Only 'categories' needs it today,
 * which is exactly why it is a parameter and not a special case in one branch.
 */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The subject of the sentence: who did it, as they were called at the time. */
export function actorName(entry: ActivityEntry): string {
  return entry.actorUsername || 'Someone no longer on the portal';
}

/**
 * What this row says, as a sentence with the actor left off the front.
 *
 * The fallback matters more than it looks. An entry whose action this build does
 * not recognise is a row written by a newer deploy, or one whose details never
 * arrived — and the honest thing to show is the action name, not to drop the
 * line. A missing line in an audit log is worse than an ugly one.
 */
export function describeActivity(entry: ActivityEntry): string {
  const d = entry.details;
  const what = entry.entityLabel;

  switch (entry.action) {
    case 'auth.signed_in':
      return 'signed in';
    case 'auth.signed_out':
      return 'signed out';

    case 'delivery.created':
      return `filed ${what} for ${text(d, 'merchant')}`;
    case 'delivery.status_changed':
      return `moved ${what} from ${text(d, 'from')} to ${text(d, 'to')}`;
    case 'delivery.rider_assigned':
      return `assigned ${text(d, 'rider')} to ${what}`;
    case 'delivery.rider_cleared':
      return `took ${text(d, 'rider') || 'the rider'} off ${what}`;
    case 'delivery.pickup_confirmed':
      return `confirmed pickup of ${what}`;
    case 'delivery.link_issued':
      return `issued a ${text(d, 'purpose')} link for ${what}`;
    case 'delivery.alert_sent':
      // Only ever a hand re-send: the automatic ones have no user behind them
      // and are recorded in delivery_notifications, not here.
      return `re-sent the ${text(d, 'event')} alert for ${what}`;
    case 'delivery.exported':
      return `exported ${plural(count(d, 'rows'), 'delivery', 'deliveries')}`;

    // Named by the settlement's own short id rather than by the counterparty.
    // The rider's or merchant's name is not in hand at the point this is
    // written, and going to fetch it would put a query on the log path for a
    // word — the id is what the remittance book is searched by anyway.
    case 'settlement.recorded':
      return `recorded settlement ${what} — ${plural(count(d, 'lines'), 'delivery', 'deliveries')}`;
    case 'settlement.voided':
      return `voided settlement ${what} — ${text(d, 'reason')}`;
    case 'ledger.exported':
      return `exported the ledger — ${plural(count(d, 'rows'), 'row')}`;

    case 'account.created':
      return `created the ${text(d, 'role')} account ${what}`;
    case 'account.deactivated':
      return `deactivated ${what}`;
    case 'account.reactivated':
      return `reactivated ${what}`;
    case 'account.password_reset':
      return `reset the password for ${what}`;

    case 'rider.created':
      return `added rider ${what}`;
    case 'rider.status_changed':
      return `set ${what} to ${text(d, 'to')}`;

    case 'pricing.updated':
      return `changed pricing — ${text(d, 'fields') || 'no field named'}`;
    case 'settings.updated':
      return `changed settings — ${text(d, 'fields') || 'no field named'}`;
    case 'delivery_options.updated':
      return `changed the item categories — ${plural(count(d, 'categories'), 'category', 'categories')} now offered`;
    case 'sms.test_sent':
      return `sent a test SMS to ${what}`;

    default:
      return `did "${entry.action}"${what ? ` on ${what}` : ''}`;
  }
}

/**
 * Field names as a phrase: ['base', 'perMin'] -> "base, per min".
 *
 * A generic transform rather than a hand-written label per field. A label map
 * would read a shade better and would silently fall out of date the first time
 * somebody adds a pricing field and does not think about the audit log — and a
 * field the log cannot name is worse than one it names awkwardly.
 */
export function humanFields(keys: string[]): string {
  return keys
    .map((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase())
    .join(', ');
}

/**
 * A label for the action itself, for the filter dropdown and the row's tag.
 *
 * Derived rather than a second table keyed by action: a hand-written label per
 * action is one more thing to forget when adding one, and 'delivery.rider_assigned'
 * already reads as "rider assigned" once the noun and the underscores are gone.
 */
export function actionLabel(action: string): string {
  const verb = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  const words = verb.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
