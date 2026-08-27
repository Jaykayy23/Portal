import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` is not a dependency of this project — Next resolves it at
      // build time, which is the whole trick: importing it from a Client
      // Component is a build error rather than a silent secret leak. Vitest has
      // no such build step, so a test that reaches any server module (lib/sms,
      // lib/autoNotify, lib/supabase/admin) fails to resolve it and the suite
      // dies before a single assertion runs.
      //
      // Pointed at the empty stub Next itself ships for the server graph, so the
      // marker is a no-op here and means exactly what it means in a real build.
      'server-only': fileURLToPath(
        new URL('./node_modules/next/dist/compiled/server-only/empty.js', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
  },
});
