import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SetupForm } from '@/components/auth/SetupForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('@/lib/api', () => ({ api: vi.fn(), errMessage: (error: Error) => error.message }));
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
}));

describe('SetupForm validation', () => {
  it('announces the validation error and identifies the page task', async () => {
    const user = userEvent.setup();
    render(<SetupForm />);

    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Create the admin account' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Enter a username and password.');
    expect(screen.getByRole('textbox', { name: 'Admin username' }).getAttribute('aria-invalid')).toBe(
      'true'
    );
  });
});
