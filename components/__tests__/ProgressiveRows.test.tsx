import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProgressiveRows } from '@/components/ProgressiveRows';

describe('ProgressiveRows', () => {
  it('renders a bounded first page and reveals older rows in batches', async () => {
    const user = userEvent.setup();
    render(
      <table>
        <tbody>
          <ProgressiveRows initial={2} step={2} colSpan={1} noun="older row">
            {[1, 2, 3, 4, 5].map((number) => (
              <tr key={number}>
                <td>Row {number}</td>
              </tr>
            ))}
          </ProgressiveRows>
        </tbody>
      </table>
    );

    expect(screen.getByText('Row 1')).toBeTruthy();
    expect(screen.getByText('Row 2')).toBeTruthy();
    expect(screen.queryByText('Row 3')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show 2 older rows' }));
    expect(screen.getByText('Row 4')).toBeTruthy();
    expect(screen.queryByText('Row 5')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show 1 older row' }));
    expect(screen.getByText('Row 5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /older row/ })).toBeNull();
  });
});
