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
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
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

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
