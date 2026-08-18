// Environment validation.
//
// Every page path goes through an auth page or the portal layout, and every API
// path goes through handle(), so checking here catches a misconfigured deploy
// before it turns into an opaque 500 on the login screen.

export const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const;

/** Names of the required variables that are absent or blank. */
export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}
