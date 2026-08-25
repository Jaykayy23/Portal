import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Modal } from '@/components/Modal';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settlement</button>
      <Modal
        open={open}
        title="Record settlement"
        description="Confirm the amount received."
        onClose={() => setOpen(false)}
      >
        <label>
          Amount
          <input aria-label="Amount" />
        </label>
      </Modal>
    </>
  );
}

describe('Modal keyboard behavior', () => {
  it('moves focus inside, contains tab navigation, and restores the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole('button', { name: 'Open settlement' });
    await user.click(opener);

    const amount = screen.getByRole('textbox', { name: 'Amount' });
    const close = screen.getByRole('button', { name: 'Done' });
    expect(document.activeElement).toBe(amount);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('uses its visible title and description as the accessible name and description', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open settlement' }));

    expect(
      screen.getByRole('dialog', {
        name: 'Record settlement',
        description: 'Confirm the amount received.',
      })
    ).toBeTruthy();
  });

  it('does not reset focus when a parent passes a new close callback', () => {
    const firstClose = () => undefined;
    const secondClose = () => undefined;
    const { rerender } = render(
      <Modal open title="Record settlement" onClose={firstClose}>
        <input aria-label="Amount" />
        <button>Review breakdown</button>
      </Modal>
    );

    const review = screen.getByRole('button', { name: 'Review breakdown' });
    review.focus();
    rerender(
      <Modal open title="Record settlement" onClose={secondClose}>
        <input aria-label="Amount" />
        <button>Review breakdown</button>
      </Modal>
    );

    expect(document.activeElement).toBe(review);
  });
});
