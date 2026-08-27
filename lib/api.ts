// Browser-side fetch wrapper. Sessions ride in an httpOnly cookie now, so there
// is no token to attach — `credentials: 'same-origin'` is enough and nothing
// sensitive is kept in localStorage.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * What to say when a response carries no message of its own.
 *
 * Every Route Handler in this app answers a failure with `{ error }` written for
 * whoever is reading it, so this is the gap-filler: a proxy timing out, a body
 * that never parsed, a status nothing threw for. The HTTP code is the one thing
 * known for certain at this point, and it is the one thing not worth showing —
 * 'Request failed (503)' tells a merchant nothing they can act on, so it goes to
 * the console and they get a sentence instead.
 */
function statusMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Please log in again.';
  if (status === 403) return 'You do not have access to this.';
  if (status === 404) return 'That is no longer here — refresh and try again.';
  if (status === 429) return 'Too many requests — please wait a moment and try again.';
  if (status >= 500) return 'The portal is having trouble right now. Please try again shortly.';
  return 'That did not go through. Please try again.';
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /**
   * Marks this request as a retry-safe repeat of an earlier one. Reuse the same
   * value when re-sending after a failure whose outcome you don't know: the
   * server replays the first response instead of doing the work twice. Generate
   * a fresh one for a genuinely new action.
   */
  idempotencyKey?: string;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server — check your connection.', 0);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }

  if (!res.ok) {
    const served =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null;
    if (!served) console.error(`[somoexpress] ${opts.method || 'GET'} /api${path} failed: ${res.status}`);
    throw new ApiError(served ?? statusMessage(res.status), res.status);
  }
  return data as T;
}

/**
 * Fetches a file endpoint and hands it to the browser as a download.
 *
 * Separate from api() because the response is a binary body, not JSON — but an
 * error still arrives as the usual `{ error }` JSON, so a failed export shows the
 * same toast as any other failed request rather than dumping JSON into a tab
 * (which is what a plain <a download> would do).
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError('Could not reach the server — check your connection.', 0);
  }

  if (!res.ok) {
    let message = '';
    try {
      const data = await res.json();
      if (data && typeof data === 'object' && typeof data.error === 'string') message = data.error;
    } catch {
      /* not a JSON error body */
    }
    if (!message) console.error(`[somoexpress] GET /api${path} failed: ${res.status}`);
    throw new ApiError(message || statusMessage(res.status), res.status);
  }

  // The server names the file; the fallback covers a proxy that strips the header.
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);

  const url = URL.createObjectURL(await res.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = match?.[1] || fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking immediately is safe: the click has already handed the blob to the
    // browser's download manager.
    URL.revokeObjectURL(url);
  }
}

/**
 * The sentence to show for a failed request.
 *
 * Only an ApiError gets to speak. Its message came off the wire, where the
 * server had already decided what this person may be told; anything else that
 * reaches here is a fault in this file or in the component that called it — a
 * TypeError, a parse failure — and its message is a stack-trace fragment, not a
 * sentence. Those go to the console, where they are useful.
 */
export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  console.error('[somoexpress] Unexpected client error', e);
  return 'Something went wrong. Please try again.';
}
