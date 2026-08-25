'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { usernameToEmail } from '@/lib/identity';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/Spinner';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = 'login-error';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);

    // Sign in from the browser so the Supabase SDK sets and manages its own
    // session cookies. Doing this server-side would leave the client unaware of
    // the session until the next full load.
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      // The synthetic address is an implementation detail — people type a username.
      email: usernameToEmail(username),
      password,
    });

    if (signInError) {
      // Supabase returns the same "Invalid login credentials" for an unknown
      // account and a wrong password, which is the right behaviour — it avoids
      // confirming which usernames exist.
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Incorrect username or password.'
          : signInError.message
      );
      setBusy(false);
      return;
    }

    toast('Signed in');
    router.replace(nextPath);
    // Makes the server re-render with the new session cookie visible.
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <h1>Log in</h1>
      <div
        className={`somo-auth-error${error ? ' show' : ''}`}
        id={errorId}
        role="alert"
      >
        {error}
      </div>
      <label className="somo-field">
        <span>Username</span>
        <input
          className="somo-input"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="somo-btn" type="submit" disabled={busy}>
        {busy ? <Spinner /> : null}
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
