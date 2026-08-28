'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { usernameToEmail } from '@/lib/identity';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/Spinner';

/**
 * What a failed sign-in says out loud.
 *
 * Supabase’s own wording is written for whoever wired the client up, and some
 * of it ('Database error querying schema', 'Failed to fetch') would land on the
 * login screen of a merchant who only mistyped something. The three cases below
 * are the ones a person can actually do something about; everything else is a
 * fault on our side, so it goes to the console and they get one plain line.
 *
 * 'Invalid login credentials' covers both an unknown account and a wrong
 * password, which is the right behaviour — it avoids confirming which usernames
 * exist — so the replacement keeps that ambiguity.
 */
function signInMessage(error: { message: string; code?: string; status?: number }): string {
  if (error.message === 'Invalid login credentials') return 'Incorrect username or password.';
  if (error.code === 'user_banned') {
    return 'This account has been deactivated. Ask an administrator to switch it back on.';
  }
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  console.error('[somoexpress] Sign-in failed', error);
  return 'Could not sign you in just now. Please try again.';
}

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
      setError(signInMessage(signInError));
      setBusy(false);
      return;
    }

    // Tells the server a session just started, so the admin's activity log has
    // the line it otherwise cannot have — signing in happens entirely between
    // this browser and Supabase, and no Route Handler sees it.
    //
    // Not awaited, and keepalive so the navigation on the next line does not
    // cancel it in flight. Nothing here is allowed to keep somebody standing at
    // a login screen: if it fails, the sign-in still happened and the log is
    // simply missing a line.
    void fetch('/api/auth/signed-in', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});

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
