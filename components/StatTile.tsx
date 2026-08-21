/**
 * One figure with a label above it and a line of explanation below.
 *
 * Shared by the ledger and the dashboard because they show the same kind of
 * thing and a tile that looked slightly different on each page would read as two
 * unrelated numbers rather than one house style.
 *
 * `tone` is never the only cue — the label and the sub-line always say which way
 * a figure points — but on a grid of nine tiles it is what lets someone find the
 * one that needs acting on.
 *
 *   due     money owed to us
 *   owed    money we owe out
 *   good    a figure that is better when it is bigger
 *   bad     a figure that is worse when it is bigger
 *   flight  nothing to do yet
 *   info    neutral
 */
export type StatTone = 'due' | 'owed' | 'good' | 'bad' | 'flight' | 'info';

export function StatTile({
  label,
  value,
  sub,
  tone = 'info',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
}) {
  return (
    <div className={`somo-kpi ${tone}`}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}
