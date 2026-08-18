// Route Handler plumbing: the equivalent of the old Express error handler and
// requireAuth/requireRole middleware, in a form that composes with App Router
// handlers.

import { NextResponse } from 'next/server';
import type { Role, SessionUser } from './types';
import { getSessionUser } from './session';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
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
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}
