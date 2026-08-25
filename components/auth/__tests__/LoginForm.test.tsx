import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/auth/LoginForm';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithPassword: vi.fn() },
  }),
}));

describe('LoginForm validation', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it('announces missing credentials and connects the error to both fields', async () => {
    const user = userEvent.setup();
    render(<LoginForm nextPath="/portal/log" />);

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const error = screen.getByRole('alert');
    const username = screen.getByRole('textbox', { name: 'Username' });
    const password = screen.getByLabelText('Password');
    expect(error.textContent).toBe('Enter your username and password.');
    expect(username.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(username.getAttribute('aria-describedby')).toBe(error.id);
    expect(password.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('uses a level-one heading for the page task', () => {
    render(<LoginForm nextPath="/portal/log" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeTruthy();
  });
});
