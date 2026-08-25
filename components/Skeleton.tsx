/**
 * Loading placeholders for the portal's route panes.
 *
 * Every portal tab is a server component that queries Supabase before it can
 * render, so switching tabs used to leave the last page on screen with nothing
 * to say a new one was coming — on a slow connection at a merchant's desk that
 * reads as a dead click. These stand in for the pane's real shape while it
 * loads, so the layout does not jump when the rows arrive.
 *
 * The blocks pulse in tone rather than sweeping a highlight across themselves:
 * the system has exactly two gradients and both encode something, so a shimmer
 * would be a third one that means nothing. Widths are fixed patterns, not
 * random, because a random width differs between the server and the client and
 * React would call that a hydration mismatch.
 */

/** One placeholder block. `w` accepts a percentage or a pixel number. */
export function SkeletonBar({
  w = '100%',
  h = 12,
  radius = 3,
  style,
}: {
  w?: number | string;
  h?: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="somo-skeleton"
      style={{ width: typeof w === 'number' ? `${w}px` : w, height: h, borderRadius: radius, ...style }}
    />
  );
}

/** The pane wrapper. Announces the wait once instead of once per block. */
export function SkeletonPane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** A card with its heading rule already drawn, matching `.somo-card h3`. */
export function SkeletonCard({
  title = 130,
  tagNote = false,
  className,
  style,
  children,
}: {
  title?: number;
  tagNote?: boolean;
  /** For grid modifiers the real card carries, such as `span-full`. */
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div className={className ? `somo-card ${className}` : 'somo-card'} style={style}>
      <div className="somo-skeleton-head">
        <SkeletonBar w={title} h={13} />
        {tagNote ? <SkeletonBar w={92} h={10} style={{ marginLeft: 'auto' }} /> : null}
      </div>
      {children}
    </div>
  );
}

/** A label-over-input pair at the real field rhythm. */
export function SkeletonField({ label = 84 }: { label?: number }) {
  return (
    <div className="somo-skeleton-field">
      <SkeletonBar w={label} h={9} />
      <SkeletonBar h={38} radius={8} />
    </div>
  );
}

/** Two fields side by side, collapsing exactly as `.somo-row2` does. */
export function SkeletonFieldPair() {
  return (
    <div className="somo-row2">
      <SkeletonField />
      <SkeletonField label={104} />
    </div>
  );
}

const TILE_LABELS = [72, 88, 64, 96, 80, 68];
const TILE_FIGURES = [54, 68, 48, 62, 58, 50];

/** The auto-fit stat row the dashboard and ledger both open with. */
export function SkeletonTiles({ count = 6 }: { count?: number }) {
  return (
    <div className="somo-kpis">
      {Array.from({ length: count }, (_, i) => (
        <div className="somo-kpi" key={i}>
          <SkeletonBar w={TILE_LABELS[i % TILE_LABELS.length]} h={10} />
          <SkeletonBar w={TILE_FIGURES[i % TILE_FIGURES.length]} h={18} style={{ marginTop: 4 }} />
          <SkeletonBar w="72%" h={10} style={{ marginTop: 3 }} />
        </div>
      ))}
    </div>
  );
}

// Cycled rather than random so the server and the client draw the same widths.
const CELL_WIDTHS = ['72%', '46%', '88%', '58%', '64%', '80%', '52%', '70%'];

/** A table's worth of rows behind the real sticky-header chrome. */
export function SkeletonTable({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="somo-skeleton-table">
      <div className="somo-skeleton-row head">
        {Array.from({ length: cols }, (_, c) => (
          <SkeletonBar key={c} w={c === 0 ? '48%' : '62%'} h={9} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="somo-skeleton-row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonBar key={c} w={CELL_WIDTHS[(r * cols + c) % CELL_WIDTHS.length]} h={11} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The toolbar of filters that sits above the log and the ledger tables. */
export function SkeletonToolbar({ count = 4 }: { count?: number }) {
  return (
    <div className="somo-skeleton-toolbar">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBar key={i} w={i % 2 === 0 ? 148 : 116} h={36} radius={8} />
      ))}
    </div>
  );
}
