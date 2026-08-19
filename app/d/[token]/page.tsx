import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { missingEnv } from '@/lib/config';
import { clientIpFrom, hitRateLimit } from '@/lib/rateLimit';
import { ConfigError } from '@/components/ConfigError';
import { BrandMark } from '@/components/BrandMark';
import { getLogoDataUrl } from '@/lib/settings';
import { loadConfirmation } from '@/lib/deliveryConfirmation';
import { ConfirmDelivery, ConfirmedNote } from '@/components/delivery/ConfirmDelivery';
import type { CompletionSummary, CompletionView } from '@/lib/types';

// The token is the credential, so nothing about this page may be cached at the
// edge or indexed. `noindex` matters most for the WhatsApp/SMS case: link
// previewers and crawlers do follow URLs people paste into chats.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Confirm delivery — SomoExpress',
  robots: { index: false, follow: false },
};

// The page is a public URL doing two database reads, so it gets the same
// treatment as the endpoint behind it — generous, because a rider reloading a
// page on bad signal is normal and being locked out mid-delivery is not.
const PER_IP = { limit: 60, windowSeconds: 300 };

/** Short path label, kept apart from the summary so it reads well on a phone. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="somo-confirm-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function Summary({ summary }: { summary: CompletionSummary }) {
  return (
    <div className="somo-confirm-summary">
      <Row label="Order" value={`#${summary.orderNo}`} />
      <Row label="Pickup" value={summary.pickup} />
      <Row label="Drop-off" value={summary.dropoff} />
      <Row label="Customer" value={summary.customer} />
      {summary.itemCategory ? <Row label="Item" value={summary.itemCategory} /> : null}
    </div>
  );
}

/** Heading and explanation for each state a link can be in. */
function copyFor(view: CompletionView): { heading: string; sub: string } {
  switch (view.state) {
    case 'pending':
      return {
        heading: `Hello ${view.summary?.riderName || 'rider'}`,
        sub: 'Check this is the delivery you have just completed, then confirm below.',
      };
    case 'confirmed':
      return { heading: 'Already confirmed', sub: 'This delivery is recorded as complete.' };
    case 'expired':
      return {
        heading: 'This link has expired',
        sub: 'Call the ops team and they will send you a new one.',
      };
    case 'reassigned':
      return {
        heading: 'No longer your delivery',
        sub: 'This order has been given to another rider, so it cannot be confirmed here.',
      };
    default:
      return {
        heading: 'Link not recognised',
        sub: 'Check you opened the whole link from the message, or call the ops team.',
      };
  }
}

/** The card body, shared by the normal page and the rate-limited one. */
function Card({
  logoDataUrl,
  heading,
  sub,
  children,
}: {
  logoDataUrl: string;
  heading: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="somo-auth-overlay">
      <div className="somo-auth-card">
        <div className="somo-auth-logo">
          <BrandMark logoDataUrl={logoDataUrl} />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Delivery confirmation</div>
          </div>
        </div>

        <h2>{heading}</h2>
        <p className="sub-text">{sub}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * The rider's completion page — the only page in the portal with no session.
 *
 * Whoever holds the link sees this, so it shows just enough to recognise the job
 * (route, customer, order number) and never the price, the declared value, or
 * anything about any other delivery.
 */
export default async function ConfirmDeliveryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const missing = missingEnv();
  if (missing.length) return <ConfigError missing={missing} />;

  const { token } = await params;
  const logoDataUrl = await getLogoDataUrl();

  // Checked before the token is looked up, so a flood costs one counter write
  // rather than two reads. A page cannot send Retry-After usefully, so the wait
  // is spelled out in the copy instead.
  const ip = clientIpFrom(await headers());
  if (ip) {
    const { allowed, retryAfterSeconds } = await hitRateLimit('confirm-page', ip, PER_IP);
    if (!allowed) {
      return (
        <Card
          logoDataUrl={logoDataUrl}
          heading="Too many attempts"
          sub={`Please wait about ${Math.ceil(retryAfterSeconds / 60)} minute(s) and open the link again.`}
        />
      );
    }
  }

  const view = await loadConfirmation(token);
  const { heading, sub } = copyFor(view);

  return (
    <Card logoDataUrl={logoDataUrl} heading={heading} sub={sub}>
      {view.summary ? <Summary summary={view.summary} /> : null}
      {view.state === 'pending' ? <ConfirmDelivery token={token} /> : null}
      {view.state === 'confirmed' ? <ConfirmedNote confirmedAt={view.confirmedAt} /> : null}
    </Card>
  );
}
