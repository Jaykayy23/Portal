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
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
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
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data === 'object' && typeof data.error === 'string') message = data.error;
    } catch {
      /* not a JSON error body */
    }
    throw new ApiError(message, res.status);
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

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
