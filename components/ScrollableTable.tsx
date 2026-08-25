'use client';

import { useId } from 'react';

export function ScrollableTable({
  label,
  short = false,
  /**
   * This table stops being a table under 640px and becomes one card per row.
   *
   * A static declaration, not a measurement: it only adds the class the
   * stylesheet keys the stacking off, so a server component can set it and
   * there is no viewport check on either side. The stylesheet also hides the
   * swipe hint below that width, which takes the sideways-scrolling
   * description out of the accessibility tree along with it — there is no
   * sideways axis left to describe.
   */
  stacks = false,
  children,
}: {
  label: string;
  short?: boolean;
  stacks?: boolean;
  children: React.ReactNode;
}) {
  const hintId = useId();

  return (
    <div className="somo-table-shell">
      <p className="somo-table-scroll-hint" id={hintId}>
        Swipe or scroll sideways to see every column.
      </p>
      <div
        className={`somo-table-wrap${short ? ' short' : ''}${stacks ? ' stacked' : ''}`}
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
