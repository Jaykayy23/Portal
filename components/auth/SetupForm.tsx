'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { usernameToEmail } from '@/lib/identity';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/Spinner';
import type { PublicAccount } from '@/lib/types';

export function SetupForm() {
  const router = useRouter();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const errorId = 'setup-error';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInvalid([]);
    if (!username.trim() || !password) {
      setError('Enter a username and password.');
      setInvalid(['username', 'password']);
      return;
    }
    if (!phone.trim()) {
      setError('Phone number is required for admin accounts.');
      setInvalid(['phone']);
      return;
    }
    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      setInvalid(['password']);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      setInvalid(['password', 'confirm']);
      return;
    }
    setBusy(true);

    try {
      // Creating the auth user needs the service-role key, so it happens on the
      // server. That does not establish a session, so we sign in right after.
      await api<{ user: PublicAccount }>('/auth/setup', {
        method: 'POST',
        body: { username: username.trim(), phone: phone.trim(), password },
      });

      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (signInError) {
        // The account exists at this point, so send them to log in rather than
        // leaving them stuck on a screen that will now refuse to run again.
        console.error('[somoexpress] Sign-in after setup failed', signInError);
        setError(
          'Admin account created, but signing you in did not work. Log in with the username and password you just chose.'
        );
        setInvalid(['username', 'password']);
        setBusy(false);
        return;
      }

      toast('Admin account created');
      router.replace('/portal');
      router.refresh();
    } catch (e) {
      setError(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Create the admin account</h1>
      <p className="sub-text">
        No accounts exist yet on this portal. Set up the first admin login — you&rsquo;ll use it to
        create merchant and ops accounts afterward.
      </p>
      <div
        className={`somo-auth-error${error ? ' show' : ''}`}
        id={errorId}
        role="alert"
      >
        {error}
      </div>
      <label className="somo-field">
        <span>Admin username</span>
        <input
          className="somo-input"
          placeholder="e.g. ops.admin"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={invalid.includes('username') || undefined}
          aria-describedby={invalid.includes('username') ? errorId : undefined}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="somo-field">
        <span>Phone number (required)</span>
        <input
          className="somo-input"
          type="tel"
          autoComplete="tel"
          aria-invalid={invalid.includes('phone') || undefined}
          aria-describedby={invalid.includes('phone') ? errorId : undefined}
          placeholder="e.g. 024 000 0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="somo-field">
        <span>Password (at least 8 characters)</span>
        <input
          className="somo-input"
          type="password"
          placeholder="Choose a password"
          autoComplete="new-password"
          aria-invalid={invalid.includes('password') || undefined}
          aria-describedby={invalid.includes('password') ? errorId : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="somo-field">
        <span>Confirm password</span>
        <input
          className="somo-input"
          type="password"
          placeholder="Repeat password"
          autoComplete="new-password"
          aria-invalid={invalid.includes('confirm') || undefined}
          aria-describedby={invalid.includes('confirm') ? errorId : undefined}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <button className="somo-btn" type="submit" disabled={busy}>
        {busy ? <Spinner /> : null}
        {busy ? 'Creating…' : 'Create admin account'}
      </button>
    </form>
  );
}
