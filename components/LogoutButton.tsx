'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Spinner } from '@/components/Spinner';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // Clearing the httpOnly cookie has to happen server-side, so log out is
        // a request rather than a localStorage delete.
        try {
          await api('/auth/logout', { method: 'POST' });
        } catch {
          /* Even if the request fails, send them to the login screen. */
        }
        router.replace('/login');
        router.refresh();
      }}
    >
      {busy ? <Spinner size={12} /> : null}
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  );
}
