import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollableTable } from '@/components/ScrollableTable';

describe('ScrollableTable', () => {
  it('makes overflow discoverable and keyboard accessible without changing table semantics', () => {
    render(
      <ScrollableTable label="Delivery log">
        <table>
          <tbody>
            <tr>
              <td>Order 123</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>
    );

    const region = screen.getByRole('region', { name: 'Delivery log' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Swipe or scroll sideways to see every column.')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });
});
