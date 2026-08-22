import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { missingEnv } from '@/lib/config';
import { clientIpFrom, hitRateLimit } from '@/lib/rateLimit';
import { ConfigError } from '@/components/ConfigError';
import { BrandMark } from '@/components/BrandMark';
import { getLogoDataUrl } from '@/lib/settings';
import { loadLink } from '@/lib/deliveryLinks';
import { LinkActions, OutcomeNote } from '@/components/delivery/LinkActions';
import { fmtMoney } from '@/lib/format';
import { cashToCollect } from '@/lib/amounts';
import type { LinkSummary, LinkView } from '@/lib/types';

// The token is the credential, so nothing about this page may be cached at the
// edge or indexed. `noindex` matters most for the WhatsApp/SMS case: link
// previewers and crawlers do follow URLs people paste into chats.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'SomoExpress delivery',
  robots: { index: false, follow: false },
};

// A public URL doing two database reads, so it gets the same treatment as the
// endpoint behind it — generous, because someone reloading on bad signal is
// normal and being locked out mid-delivery is not.
const PER_IP = { limit: 60, windowSeconds: 300 };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="somo-confirm-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

/**
 * The delivery, as much of it as the holder needs.
 *
 * A rider needs the pickup address; a recipient does not, and showing it would
 * hand out the merchant's collection point to whoever holds the link. So the
 * pickup line is rider-only.
 */
function Summary({ summary, showPickup }: { summary: LinkSummary; showPickup: boolean }) {
  return (
    <div className="somo-confirm-summary">
      <Row label="Order" value={`#${summary.orderNo}`} />
      {showPickup ? <Row label="Pickup" value={summary.pickup} /> : null}
      <Row label="Drop-off" value={summary.dropoff} />
      {showPickup ? (
        <Row label="Merchant" value={summary.customer} />
      ) : (
        <Row label="From" value={summary.customer} />
      )}
      {summary.recipientName ? <Row label="Recipient" value={summary.recipientName} /> : null}
      {!showPickup && summary.riderName ? <Row label="Rider" value={summary.riderName} /> : null}
      {summary.itemCategory ? <Row label="Item" value={summary.itemCategory} /> : null}
    </div>
  );
}

/**
 * What the rider collects, and what they must not.
 *
 * Said in both directions on purpose, and never left to inference: a rider who
 * cannot see that an item is prepaid asks the customer for money they have
 * already paid, and that mistake costs the merchant a customer rather than
 * costing anyone cash. So the block stays on the page when there is nothing to
 * collect — it just says so, and turns from amber to teal to be read at a glance.
 *
 * It repeats what the WhatsApp message already said. That is the point — the
 * message is the thing that got scrolled past; this is the thing open in their
 * hand at the door.
 */
function RiderCollects({ summary }: { summary: LinkSummary }) {
  const { itemCash, deliveryFee, itemPrepaid, feeOnMerchant } = summary.due;

  // Rows filed before payment terms were captured have neither an amount nor a
  // reason, and guessing at either is the one kind of wrong that moves money.
  const itemKnown = itemCash > 0 || itemPrepaid;
  const feeKnown = deliveryFee > 0 || feeOnMerchant;
  if (!itemKnown && !feeKnown) return null;

  const total = cashToCollect(summary.due);
  const collectsCash = total > 0;

  return (
    <div className={`somo-confirm-due${collectsCash ? '' : ' clear'}`}>
      <div className="due-head">{collectsCash ? 'Collect on delivery' : 'Nothing to collect'}</div>

      {itemKnown ? (
        <div className="due-row">
          <span className="k">For the item</span>
          {itemCash > 0 ? (
            <span className="v">{fmtMoney(itemCash)}</span>
          ) : (
            <span className="v note">Prepaid — collect nothing</span>
          )}
        </div>
      ) : null}

      {feeKnown ? (
        <div className="due-row">
          <span className="k">Delivery fee</span>
          {deliveryFee > 0 ? (
            <span className="v">{fmtMoney(deliveryFee)}</span>
          ) : (
            <span className="v note">On the merchant — do not collect</span>
          )}
        </div>
      ) : null}

      {/* Stated whenever there is cash, even when it only repeats one line
          above: this is the figure the rider is accountable for at the gate and
          again when they remit, so it is always in the same place under the same
          words rather than being a line they have to notice is missing. The
          addition is the system's job — see lib/amounts.ts. */}
      {collectsCash ? (
        <div className="due-row total grand">
          <span className="k">Total cash to collect</span>
          <span className="v">{fmtMoney(total)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the recipient should have ready.
 *
 * Absent entirely when the item is prepaid and the merchant is paying the fee,
 * because "GHS 0.00 to pay" invites a second look at a page whose whole job is
 * one tap. The rider's side of the same handover is the one that needs the terms
 * spelled out either way — see RiderCollects.
 */
function RecipientPays({ summary }: { summary: LinkSummary }) {
  const { itemCash, deliveryFee } = summary.due;
  const total = cashToCollect(summary.due);
  if (total <= 0) return null;

  return (
    <div className="somo-confirm-due">
      <div className="due-head">To pay the rider</div>
      {itemCash > 0 ? (
        <div className="due-row">
          <span className="k">For the item</span>
          <span className="v">{fmtMoney(itemCash)}</span>
        </div>
      ) : null}
      {deliveryFee > 0 ? (
        <div className="due-row">
          <span className="k">Delivery fee</span>
          <span className="v">{fmtMoney(deliveryFee)}</span>
        </div>
      ) : null}
      {/* The same figure the rider was sent, so the amount is settled before
          anyone is standing at a door disagreeing about it. Shown even when it
          restates the single line above — under a rule, in a column of amounts,
          it reads as the sum of them, which is not true of the same repetition in
          a sentence (see recipientPaymentClause). */}
      <div className="due-row total grand">
        <span className="k">Total to pay</span>
        <span className="v">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

/** Heading and explanation for every combination of purpose and state. */
function copyFor(view: LinkView): { heading: string; sub: string } {
  const who = view.summary?.riderName || 'rider';

  switch (view.state) {
    case 'pending':
      switch (view.purpose) {
        case 'rider-response':
          return {
            heading: `Hello ${who}`,
            sub: 'A delivery has been offered to you. Check the details, then accept or decline.',
          };
        case 'recipient-confirm':
          return {
            heading: `Hello ${view.summary?.recipientName || 'there'}`,
            sub: 'Your delivery is on the way. Once the parcel is in your hands, confirm below.',
          };
        default:
          return {
            heading: `Hello ${who}`,
            sub: 'The recipient has confirmed receipt. Close the job off below.',
          };
      }

    case 'used':
      return {
        heading: 'Already answered',
        sub: 'This link has been used. Nothing further is needed here.',
      };

    case 'expired':
      return {
        heading: 'This link has expired',
        sub: 'Call the ops team and they will send you a new one.',
      };

    case 'reassigned':
      return {
        heading: 'No longer your delivery',
        sub: 'This order has been given to another rider, so it cannot be answered here.',
      };

    case 'superseded':
      return {
        heading: 'Nothing to do',
        sub: 'This delivery has already moved past the step this link was for.',
      };

    default:
      return {
        heading: 'Link not recognised',
        sub: 'Check you opened the whole link from the message, or call the ops team.',
      };
  }
}

/**
 * The page, shared by every state including the rate-limited one.
 *
 * `actions` is a separate slot rather than more children because it is pinned to
 * the bottom of the viewport: the content grows from the top, the thing to tap
 * stays under the reader's thumb.
 */
function Card({
  logoDataUrl,
  heading,
  sub,
  children,
  actions,
}: {
  logoDataUrl: string;
  heading: string;
  sub: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="somo-link-page">
      <div className="somo-link-card">
        <div className="somo-link-head">
          <BrandMark logoDataUrl={logoDataUrl} />
          <div>
            <div className="somo-title">SomoExpress</div>
            <div className="somo-sub">Delivery update</div>
          </div>
        </div>

        <div className="somo-link-body">
          <h2>{heading}</h2>
          <p className="sub-text">{sub}</p>
          {children}
        </div>

        {actions ? <div className="somo-link-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/**
 * The one page in the portal with no session: whoever holds the link sees it.
 *
 * What it asks depends on the link's purpose — accept/decline for a rider being
 * offered a job, "I have received this" for the person at the drop-off, "I've
 * delivered this" for the rider closing it out. Three questions, one URL shape,
 * so there is only ever one kind of address to paste into a message.
 */
export default async function DeliveryLinkPage({
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
    const { allowed, retryAfterSeconds } = await hitRateLimit('link-page', ip, PER_IP);
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

  const view = await loadLink(token);
  const { heading, sub } = copyFor(view);
  const riderFacing = view.purpose !== 'recipient-confirm';

  return (
    <Card
      logoDataUrl={logoDataUrl}
      heading={heading}
      sub={sub}
      actions={
        view.state === 'pending' ? (
          <LinkActions token={token} purpose={view.purpose} />
        ) : view.state === 'used' ? (
          <OutcomeNote purpose={view.purpose} outcome={view.outcome} usedAt={view.usedAt} />
        ) : null
      }
    >
      {view.summary ? <Summary summary={view.summary} showPickup={riderFacing} /> : null}
      {view.summary ? (
        riderFacing ? (
          <RiderCollects summary={view.summary} />
        ) : (
          <RecipientPays summary={view.summary} />
        )
      ) : null}
    </Card>
  );
}
