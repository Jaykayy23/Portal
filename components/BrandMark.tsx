/**
 * The square logo tile. Falls back to the "SX" wordmark when no logo has been
 * uploaded. Logos are base64 data URLs out of db.json, so a plain <img> is
 * right here — next/image would try to optimise something already inlined.
 */
export function BrandMark({ logoDataUrl }: { logoDataUrl?: string }) {
  return (
    <div className="somo-mark">
      {logoDataUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={logoDataUrl} alt="Portal logo" />
      ) : (
        'SX'
      )}
    </div>
  );
}
