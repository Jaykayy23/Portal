import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';

/**
 * Request-scoped Supabase client that carries the signed-in user's session.
 *
 * Use this for all normal reads and writes: queries run as that user, so the RLS
 * policies in supabase/migrations are what actually enforce merchant isolation.
 * Reach for createAdminClient() only where the schema deliberately gives no
 * access to `authenticated` (account provisioning, app_settings, branding reads
 * before login).
 *
 * Do not hoist this into a module-level variable — on Fluid compute that would
 * share one user's session across requests. Create it per call.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: the proxy refreshes the session on every request.
          }
        },
      },
    }
  );
}
