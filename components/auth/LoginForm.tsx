'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { PublicAccount } from '@/lib/types';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ user: PublicAccount }>('/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      });
      toast(`Welcome back, ${data.user.companyName}`);
      // The session cookie is set by the response, so a refresh is what makes
      // the server-rendered portal see it.
      router.replace(nextPath);
      router.refresh();
    } catch (e) {
      setError(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Log in</h2>
      <p className="sub-text">
        Use the username and password issued to you. Merchant and ops accounts are created by your
        SomoExpress admin.
      </p>
      <div className={`somo-auth-error${error ? ' show' : ''}`}>{error}</div>
      <label className="somo-field">
        <span>Username</span>
        <input
          className="somo-input"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="somo-field">
        <span>Password</span>
        <input
          className="somo-input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="somo-btn" type="submit" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
