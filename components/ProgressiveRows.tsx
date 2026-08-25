'use client';

import { Children, useState } from 'react';

export function ProgressiveRows({
  children,
  colSpan,
  initial = 100,
  step = 100,
  noun = 'older row',
}: {
  children: React.ReactNode;
  colSpan: number;
  initial?: number;
  step?: number;
  noun?: string;
}) {
  const rows = Children.toArray(children);
  const [limit, setLimit] = useState(initial);
  const remaining = Math.max(0, rows.length - limit);
  const nextCount = Math.min(step, remaining);

  return (
    <>
      {rows.slice(0, limit)}
      {remaining > 0 ? (
        <tr className="somo-progressive-row">
          <td colSpan={colSpan}>
            <button
              className="somo-btn ghost small"
              type="button"
              onClick={() => setLimit((current) => current + step)}
            >
              Show {nextCount} {noun}
              {nextCount === 1 ? '' : 's'}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
