/**
 * The square logo tile. Defaults to the bundled Somoexpress mark and is
 * overridden by whatever an admin uploads in settings. Uploaded logos are
 * stored as base64 data URLs, so a plain <img> is right here — next/image
 * would try to optimise something already inlined.
 */
export function BrandMark({ logoDataUrl }: { logoDataUrl?: string }) {
  return (
    <div className="somo-mark has-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoDataUrl || '/logo-mark.png'} alt="Somoexpress" />
    </div>
  );
}
