'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { InfoHint } from '@/components/InfoHint';
import { Spinner } from '@/components/Spinner';
import type { PublicAccount, Role } from '@/lib/types';

const ROLE_CHOICES: { value: Role; label: string }[] = [
  { value: 'merchant', label: 'Merchant' },
  { value: 'ops', label: 'Ops team' },
  { value: 'finance', label: 'Finance' },
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
    if (!username.trim()) return toast('Enter a username', 'danger');
    if (!phone.trim()) return toast('Phone number is required', 'danger');
    if (role === 'merchant' && !company.trim()) return toast('Enter the merchant/company name', 'danger');

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
      toast(errMessage(err), 'danger');
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
      toast(errMessage(err), 'danger');
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
      toast(errMessage(err), 'danger');
    }
  }

  return (
    <>
      {/* narrow: this card is nothing but fields, so it takes a readable measure
          rather than the full width of the pane the account table below it uses. */}
      <form className="somo-card narrow" style={{ marginTop: 0 }} onSubmit={createAccount}>
        <h3>
          {merchantsOnly ? 'Create merchant' : 'Create account'}
          <InfoHint label={merchantsOnly ? 'merchant accounts' : 'the four roles'}>
            {merchantsOnly ? (
              <p>
                A <strong>merchant</strong> sees and submits only its own delivery requests, and
                only its own ledger. Ops issue merchant accounts; ops, finance and admin accounts
                come from an admin.
              </p>
            ) : (
              <>
                <p>
                  <strong>Merchant</strong> — their own deliveries, ledger and dashboard, and
                  nothing else.
                </p>
                <p>
                  <strong>Ops</strong> — every delivery, the rider roster, assignments, alerts, and
                  new merchant accounts. Not pricing, not other accounts.
                </p>
                <p>
                  <strong>Finance</strong> — the ledger and dashboard for every merchant, read-only.
                  Settlements are the one thing they write.
                </p>
                <p>
                  <strong>Admin</strong> — everything ops can do, plus pricing, portal settings and
                  full account management.
                </p>
              </>
            )}
          </InfoHint>
          <span className="tag-note">issue login access</span>
        </h3>

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
          {busy ? <Spinner /> : null}
          {busy ? 'Creating…' : merchantsOnly ? 'Create merchant' : 'Create account'}
        </button>
      </form>

      <div className="somo-card">
        <h3>
          {merchantsOnly ? 'Merchant accounts' : 'Existing accounts'}
          <InfoHint label="how passwords are handled">
            <p>
              Supabase Auth stores and verifies passwords; this app never holds one in plain text. A
              password is shown exactly once — right after you create the account
              {merchantsOnly ? '' : ' or reset it'} — so you can hand it over.
            </p>
            {merchantsOnly ? (
              <p>Resetting a merchant password, or deactivating an account, is an admin action.</p>
            ) : null}
          </InfoHint>
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
