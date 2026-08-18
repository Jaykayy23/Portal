// Hard build-time guard: importing this from a Client Component becomes a build
// error rather than a silent secret leak.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Service-role client. Bypasses RLS entirely, so it is only for work the
 * portal's own rules have already authorised:
 *
 *   - creating and updating auth users (admin provisions every account)
 *   - reading app_settings, which is granted to no role but service_role
 *   - the pre-login branding read
 *
 * Never import this from a Client Component, and never from anything under a
 * path that ships to the browser. The secret key must not be prefixed
 * NEXT_PUBLIC_ — anything with that prefix is inlined into client bundles.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error(
      'Supabase admin client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY. ' +
        'Copy the secret key from your project dashboard (Project Settings → API keys) ' +
        'into .env — see .env.example.'
    );
  }

  return createClient<Database>(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
