import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { landingPathFor } from '@/lib/types';

/**
 * Where /portal lands, which is not the same door for everyone: finance has no
 * business on the New delivery form, so sending them there would open a page
 * whose every control is inert. Signing in with no session at all is the
 * layout's problem, not this one's.
 */
export default async function PortalIndex() {
  redirect(landingPathFor(await getSessionUser()));
}
