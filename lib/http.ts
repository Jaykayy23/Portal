// Route Handler plumbing: the equivalent of the old Express error handler and
// requireAuth/requireRole middleware, in a form that composes with App Router
// handlers.

import { NextResponse } from 'next/server';
import type { Role, SessionUser } from './types';
import { getSessionUser } from './session';
import { missingEnv } from './config';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Response headers the status needs to be actionable, e.g. Retry-After. */
    public headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Wraps a handler body so thrown HttpErrors become proper status codes and
 * anything unexpected becomes a 500 with the detail logged, not leaked.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  // A misconfigured deploy is a 503 with the missing variable names, not an
  // anonymous 500 that only shows up in the server log.
  const missing = missingEnv();
  if (missing.length) {
    return NextResponse.json(
      {
        error: `Server is not configured: missing ${missing.join(', ')}. See .env.example.`,
      },
      { status: 503 }
    );
  }

  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: err.headers }
      );
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong on the server.' }, { status: 500 });
  }
}

/** Throws 401 if not signed in, 403 if signed in without one of `roles`. */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new HttpError(401, 'Session expired or invalid — please log in again.');
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new HttpError(403, 'You do not have access to this.');
  }
  return user;
}

/** Parses a JSON body, treating a missing/invalid one as an empty object. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}

/**
 * The public origin of this deployment, for links that will be opened on someone
 * else's phone rather than followed in the current tab.
 *
 * Behind the Docker reverse proxy the request URL carries the internal host, so
 * the forwarded headers win over it. NEXT_PUBLIC_APP_URL overrides both, which is
 * the only thing that works when the proxy rewrites the host it forwards.
 */
export function absoluteOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const url = new URL(req.url);
  // Both headers are comma-joined lists when more than one proxy is in front.
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();

  const host = forwardedHost || req.headers.get('host') || url.host;
  const proto = forwardedProto || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}
