import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

/**
 * Browser client. Only needed where the browser talks to Supabase directly —
 * currently just the login form's signInWithPassword call, so the session cookie
 * is established by Supabase itself. All portal data still flows through Route
 * Handlers and Server Components.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
