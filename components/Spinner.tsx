/**
 * The working indicator for a control that has been pressed.
 *
 * Buttons in the portal already swapped their label while busy ("Saving…"),
 * which says a request is in flight but not that it is still in flight — a
 * static word looks identical whether the server answered a second ago or
 * never. The arc turns, so a stalled request is visibly stalled.
 *
 * Drawn rather than composed from a border trick, so the stroke keeps the
 * weight of the Lucide icons beside it, and inherits `currentColor` so one
 * component works on the navy fill and on a ghost button both.
 */
export function Spinner({
  size = 14,
  label,
}: {
  size?: number;
  /** Give this only to a standalone spinner. Beside a busy label it is noise. */
  label?: string;
}) {
  return (
    <>
      <svg
        className="somo-spinner"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="track" cx="8" cy="8" r="6.5" strokeWidth="2" />
        <path className="arc" d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}
