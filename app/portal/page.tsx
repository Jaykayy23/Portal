import { redirect } from 'next/navigation';
import { LANDING_PATH } from '@/lib/types';

/**
 * Where /portal lands: the dashboard, for every seat. One door rather than one
 * per role, because the dashboard describes whatever rows the caller can read
 * and there is no seat it says nothing to. Signing in with no session at all is
 * the layout's problem, not this one's.
 */
export default function PortalIndex() {
  redirect(LANDING_PATH);
}
