'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import type { PublicAccount, Role } from '@/lib/types';

const ROLE_CHOICES: { value: Role; label: string }[] = [
  { value: 'merchant', label: 'Merchant' },
  { value: 'ops', label: 'Ops team' },
  { value: 'admin', label: 'Admin' },
];

interface Reveal {
  title: string;
  value: string;
}

export function AccountsPane({
  accounts,
  currentUsername,
  viewerRole,
}: {
  accounts: PublicAccount[];
  currentUsername: string;
  viewerRole: Role;
}) {
  const router = useRouter();
  const toast = useToast();

  // Ops provisions merchants and nothing else: no role picker, no reset or
  // deactivate. Both server routes reject anything more, so this is only about
  // not offering an action that can't succeed.
  const merchantsOnly = viewerRole !== 'admin';

  const [role, setRole] = useState<Role>('merchant');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return toast('Enter a username');
    if (!phone.trim()) return toast('Phone number is required');
    if (role === 'merchant' && !company.trim()) return toast('Enter the merchant/company name');

    setBusy(true);
    try {
      const data = await api<{ account: PublicAccount; password: string }>('/accounts', {
        method: 'POST',
        body: {
          username: username.trim(),
          phone: phone.trim(),
          password,
          role,
          companyName: company.trim(),
        },
      });
      setUsername('');
      setPhone('');
      setPassword('');
      setCompany('');
      // Shown once, to whoever set it, so it can be handed over.
      setReveal({
        title: merchantsOnly ? 'Merchant created' : 'Account created',
        value: `${data.account.username} / ${data.password}`,
      });
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
    setBusy(false);
  }

  async function resetPassword(target: string) {
    try {
      const data = await api<{ account: PublicAccount; password: string }>('/accounts/' + encodeURIComponent(target), {
        method: 'PATCH',
        body: { resetPassword: true },
      });
      setReveal({
        title: 'Password reset',
        value: `${data.account.username} / ${data.password}`,
      });
    } catch (err) {
      toast(errMessage(err));
    }
  }

  async function toggleActive(target: string, wantActive: boolean) {
    try {
      await api('/accounts/' + encodeURIComponent(target), {
        method: 'PATCH',
        body: { active: wantActive },
      });
      toast(wantActive ? 'Account reactivated' : 'Account deactivated');
      router.refresh();
    } catch (err) {
      toast(errMessage(err));
    }
  }

  return (
    <>
      <form className="somo-card" style={{ marginTop: 0 }} onSubmit={createAccount}>
        <h3>
          <span className="n">—</span> {merchantsOnly ? 'Create merchant' : 'Create account'}
          <span className="tag-note">issue login access</span>
        </h3>
        <p className="somo-card-intro">
          {merchantsOnly ? (
            <>
              A <strong>merchant</strong> account sees and submits only its own delivery requests.
              Ops accounts create merchants; ops, admin and pricing accounts are issued by an admin.
            </>
          ) : (
            <>
              <strong>Merchant</strong> — sees and submits only their own delivery requests.{' '}
              <strong>Ops team</strong> — sees every delivery, manages the rider roster, assigns
              riders, sends alerts, and creates merchant accounts, but can&rsquo;t touch pricing or
              other accounts. <strong>Admin</strong> — everything Ops can do, plus pricing settings,
              full account management, and portal settings.
            </>
          )}
        </p>

        <div className="somo-row2">
          {!merchantsOnly && (
            <label className="somo-field">
              <span>Role</span>
              <div className="somo-role-choice">
                {ROLE_CHOICES.map((choice) => (
                  <div
                    key={choice.value}
                    className={`somo-role-opt${role === choice.value ? ' selected' : ''}`}
                    onClick={() => setRole(choice.value)}
                  >
                    {choice.label}
                  </div>
                ))}
              </div>
            </label>
          )}
          {role === 'merchant' && (
            <label className="somo-field">
              <span>Company / merchant name</span>
              <input
                className="somo-input"
                placeholder="e.g. Jumia, Mr Wu"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="somo-row2">
          <label className="somo-field">
            <span>Username</span>
            <input
              className="somo-input"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="somo-field">
            <span>Phone number (required)</span>
            <input
              className="somo-input"
              type="tel"
              placeholder="e.g. 024 000 0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </div>

        <label className="somo-field">
          <span>Temporary password</span>
          <input
            className="somo-input"
            type="text"
            placeholder="Leave blank to auto-generate"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="somo-btn small" type="submit" disabled={busy}>
          {busy ? 'Creating…' : merchantsOnly ? 'Create merchant' : 'Create account'}
        </button>
      </form>

      <div className="somo-card">
        <h3>
          <span className="n">—</span> {merchantsOnly ? 'Merchant accounts' : 'Existing accounts'}
        </h3>

        {accounts.length === 0 ? (
          <div className="somo-empty">
            <div className="big">{merchantsOnly ? 'No merchants yet' : 'No accounts yet'}</div>
          </div>
        ) : (
          accounts.map((a) => {
            const isSelf = a.username.toLowerCase() === currentUsername.toLowerCase();
            return (
              <div className="somo-account-card" key={a.username}>
                <div>
                  <div className="name">
                    {a.companyName || a.username}{' '}
                    <span className={`somo-role-tag ${a.role}`} style={{ marginLeft: 6 }}>
                      {a.role}
                    </span>
                  </div>
                  <div className="sub">
                    @{a.username} · {a.phone || 'no phone on file'} ·{' '}
                    {a.active === false ? 'inactive' : 'active'}
                  </div>
                </div>
                {!merchantsOnly && (
                  <div className="right">
                    <button className="somo-mini-btn" onClick={() => resetPassword(a.username)}>
                      Reset password
                    </button>
                    <button
                      className="somo-mini-btn"
                      // The server rejects this too; disabling it just avoids
                      // offering an action that can only fail.
                      disabled={isSelf && a.active !== false}
                      title={
                        isSelf && a.active !== false ? "You can't deactivate your own account." : ''
                      }
                      onClick={() => toggleActive(a.username, a.active === false)}
                    >
                      {a.active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="somo-note">
          Passwords are stored and verified by Supabase Auth and never held by this app in plain text
          — the only time a password is shown is right after you create the account
          {merchantsOnly ? '' : ' or reset it'}, so you can hand it to the account holder.
          {merchantsOnly &&
            ' Resetting a merchant password or deactivating an account is an admin action.'}
        </div>
      </div>

      <Modal
        open={!!reveal}
        title={reveal?.title || ''}
        description="Share this with the account holder — it won't be shown again."
        onClose={() => setReveal(null)}
      >
        <div className="somo-price-box somo-reveal-value">{reveal?.value}</div>
      </Modal>
    </>
  );
}
