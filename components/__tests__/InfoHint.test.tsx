import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { InfoHint } from '@/components/InfoHint';

// The hardest place a hint sits: inside a <label>, whose click-forwarding and
// uppercase type both have to be kept off it.
function Harness() {
  return (
    <label className="somo-field">
      <span>
        Estimated driving time (min)
        <InfoHint label="estimated driving time">
          <p>Priced per minute, so a slow route through traffic costs more.</p>
        </InfoHint>
      </span>
      <input aria-label="Estimated driving time" />
    </label>
  );
}

const NAME = 'More about estimated driving time';

function bubble(): HTMLElement {
  const trigger = screen.getByRole('button', { name: NAME });
  const id = trigger.getAttribute('aria-controls');
  const el = document.getElementById(id ?? '');
  if (!el) throw new Error('the trigger points at no bubble');
  return el;
}

describe('InfoHint', () => {
  it('starts closed and opens on click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: NAME });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(bubble().hasAttribute('hidden')).toBe(true);

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(bubble().hasAttribute('hidden')).toBe(false);
    expect(bubble().textContent).toContain('Priced per minute');
  });

  it('opens on keyboard focus without a click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: NAME });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Escape and leaves focus on the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: NAME });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('does not hand its click to the label it sits inside', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // A <label> forwards clicks to its control. Pressing the "?" must reveal the
    // note without also dropping the caret into the field behind it.
    await user.click(screen.getByRole('button', { name: NAME }));
    expect(document.activeElement).not.toBe(
      screen.getByRole('textbox', { name: 'Estimated driving time' })
    );
  });
});
