'use client';

import { useId } from 'react';

export function ScrollableTable({
  label,
  short = false,
  children,
}: {
  label: string;
  short?: boolean;
  children: React.ReactNode;
}) {
  const hintId = useId();

  return (
    <div className="somo-table-shell">
      <p className="somo-table-scroll-hint" id={hintId}>
        Swipe or scroll sideways to see every column.
      </p>
      <div
        className={`somo-table-wrap${short ? ' short' : ''}`}
        role="region"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
