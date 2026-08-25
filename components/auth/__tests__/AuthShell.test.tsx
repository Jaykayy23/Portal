import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthShell } from '@/components/auth/AuthShell';

vi.mock('@/components/BrandMark', () => ({ BrandMark: () => <span>SX</span> }));

describe('AuthShell', () => {
  it('identifies authentication content as the primary page landmark', () => {
    render(
      <AuthShell logoDataUrl="">
        <h1>Log in</h1>
      </AuthShell>
    );

    expect(screen.getByRole('main').textContent).toContain('Log in');
  });
});
