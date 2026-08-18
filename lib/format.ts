/** GHS money formatting, matching the original portal's display. */
export function fmtMoney(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return (
    'GHS ' +
    v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** "Mar 4 14:32" — short, locale-aware. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

/** Human-facing order number: last 5 chars of the uuid part of "d_<uuid>". */
export function shortId(id: string): string {
  const parts = (id || '').split('_');
  return (parts[1] || id || '').slice(-5);
}
