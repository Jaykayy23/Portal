// What a failure is allowed to say out loud.
//
// Two very different things arrive here as "an error", and they have opposite
// audiences:
//
//   ours       The rules this app enforces in Postgres raise whole sentences
//              written for the person on the screen — "Order #4f2a1 has already
//              been settled for that part. Void the earlier settlement first if
//              it was wrong." (see supabase/migrations). Hiding those would be a
//              downgrade: they are the most useful thing the screen can show.
//
//   plumbing   A PostgREST code, a violated constraint name, an expired JWT, a
//              DNS failure, a provider's HTTP status. Written for whoever
//              maintains this portal. A merchant reading one learns nothing
//              except that the software is leaking, and some of it — column
//              names, table names, key states — is a description of the system
//              that no logged-in merchant had any business being handed.
//
// So the rule everywhere below the Route Handlers is: our own sentences pass
// through, and everything else is logged here and replaced with a line the
// caller wrote for the person on the screen.

/** The fields worth reading off a PostgrestError, an AuthError or an Error. */
interface ErrorLike {
  message?: unknown;
  code?: unknown;
}

/**
 * The plain `raise exception` SQLSTATE.
 *
 * Postgres never raises P0001 on its own — it is what a function raises when it
 * is told to and given no errcode, which is what almost every rule in
 * supabase/migrations does. So a P0001 message is by definition one we wrote.
 */
const RAISED_BY_US = 'P0001';

/**
 * SQLSTATEs our functions raise deliberately (`using errcode = …`) but Postgres
 * also raises by itself. A message carrying one of these is ours only if it
 * reads like a sentence rather than like the server talking to itself.
 */
const SHARED_WITH_POSTGRES = new Set([
  'P0002', // no_data_found      — 'Settlement not found.'
  '23503', // foreign_key_violation — 'Unknown rider.'
  '42501', // insufficient_privilege — 'No signed-in user.'
]);

/**
 * Wording that only appears in a message written by Postgres, PostgREST, the
 * Supabase client or the network stack.
 *
 * Deliberately trigger-happy: a rule of ours that gets caught by this reads as a
 * slightly vaguer sentence, while a plumbing message that slips past it is the
 * failure this module exists to prevent. Checked against every message our own
 * migrations raise, none of which match.
 */
const PLUMBING =
  /\bviolat|\bconstraint\b|\brelation\b|\bcolumn\b|schema cache|syntax error|invalid input|permission denied|row-level security|duplicate key|\bJWT\b|\bnull value\b|does not exist|failed to (parse|fetch)|fetch failed|\bECONN|\bETIMEDOUT\b|\bENOTFOUND\b|\bPGRST|\bapi key\b|\bsupabase\b|\buuid\b|\bpostgres/i;

function messageOf(error: unknown): string {
  const message = (error as ErrorLike | null)?.message;
  return typeof message === 'string' ? message.trim() : '';
}

function codeOf(error: unknown): string {
  const code = (error as ErrorLike | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Is this message one of ours, written to be read by the person who triggered
 * it?
 *
 * A failure with no SQLSTATE at all fails this on purpose. It means the error
 * came from somewhere that was never asked to write for an audience — a fetch
 * that never landed, a client-side throw — and "unknown provenance" is not a
 * thing to put in front of a customer.
 */
function isWrittenForUsers(error: unknown, message: string): boolean {
  if (!message) return false;
  const code = codeOf(error);
  if (code === RAISED_BY_US) return true;
  if (!SHARED_WITH_POSTGRES.has(code)) return false;
  return !PLUMBING.test(message);
}

/**
 * Records a failure where it is useful — the server log — and returns nothing.
 *
 * The whole error object goes in: on a PostgREST failure it is `details` and
 * `hint` that make the thing diagnosable, and none of it is going anywhere near
 * a browser.
 */
export function logFailure(context: string, error: unknown): void {
  console.error(`[somoexpress] ${context}:`, error);
}

/**
 * The message to show for a failed operation.
 *
 * `fallback` is what the person sees whenever the underlying error was not
 * written for them, so write it for them: say what did not happen and what to do
 * about it, in the words of someone using the portal rather than someone
 * debugging it.
 */
export function userMessage(context: string, error: unknown, fallback: string): string {
  const message = messageOf(error);
  if (isWrittenForUsers(error, message)) return message;
  logFailure(context, error);
  return fallback;
}
