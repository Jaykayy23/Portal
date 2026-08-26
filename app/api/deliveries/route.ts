import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { idempotencyKey, withIdempotency } from '@/lib/idempotency';
import { calcPrice } from '@/lib/pricing';
import { isValidPhone } from '@/lib/phone';
import { getDeliveryOptions, getPricingParams } from '@/lib/settings';
import { DeliveryError, createDelivery, listDeliveriesFor } from '@/lib/deliveries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  DELIVERY_PAYERS,
  DELIVERY_TYPES,
  ITEM_PAYMENTS,
  type DeliveryPayer,
  type DeliveryType,
  type ItemPayment,
} from '@/lib/types';

/**
 * Every delivery the caller is allowed to read — RLS decides which those are.
 *
 * `truncated` rides along rather than being dropped: a client that sums this
 * array needs to know when it is summing a prefix of the period, not the period.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const { records, truncated } = await listDeliveriesFor(user);
    return NextResponse.json({ deliveries: records, truncated });
  });
}

interface CreateBody {
  pickup: string;
  dropoff: string;
  distance: number | string;
  durationMin?: number | string;
  type?: DeliveryType;
  itemCategory?: string;
  surcharges?: string[];
  declaredValue: number | string;
  customer?: string;
  recipientName?: string;
  recipientPhone?: string;
  itemPayment?: ItemPayment;
  deliveryPaidBy?: DeliveryPayer;
}

/** A day. Anything beyond this is a typo or a probe, not a delivery. */
const MAX_DURATION_MIN = 24 * 60;

// A busy merchant files a handful an hour, not thirty in five minutes. High
// enough that nobody working normally will ever see it.
const PER_USER = { limit: 30, windowSeconds: 300 };

/**
 * The price is computed here from the saved pricing parameters and nowhere else.
 * The browser's preview is decoration, and a price sent in the body is ignored
 * outright — there is no negotiation, so there is nothing for a caller to
 * propose. The RLS INSERT policy independently guarantees the row can only be
 * filed under the submitter's own merchant id.
 *
 * Distance and estimated time are still taken from the request, because both are
 * editable by hand in the form (the Maps lookup only prefills them). They are the
 * inputs to the price, not the price, and ops sees both on every row in the log.
 *
 * Requires an Idempotency-Key: the same key returns the
 * delivery created by the first attempt rather than filing a second one. That is
 * for the merchant on a bad signal whose response never arrived, while the
 * requirement is the backstop for scripted or degraded clients. The rate limit
 * above covers abuse.
 */
export async function POST(req: Request) {
  return handle(async () => {
    // Named roles rather than "anyone signed in": the RLS INSERT policy would
    // reject a finance token anyway, but as a row-level failure it surfaces as a
    // confusing database message instead of a plain 403.
    const user = await requireUser('admin', 'ops', 'merchant');
    await enforceRateLimit('delivery-create', user.id, PER_USER);

    const key = idempotencyKey(req);
    if (!key) badRequest('Idempotency-Key header is required.');
    const body = await readJson<CreateBody>(req);
    const {
      pickup,
      dropoff,
      distance,
      durationMin,
      type,
      itemCategory,
      surcharges,
      declaredValue,
      customer,
      recipientName,
      recipientPhone,
      itemPayment,
      deliveryPaidBy,
    } = body;

    if (!pickup || !dropoff || !distance) {
      badRequest('Pickup, drop-off and distance are required.');
    }
    if (Number(distance) <= 0) badRequest('Distance must be greater than zero.');
    // Time is optional: a manually entered route, or one where the Maps lookup
    // failed, simply prices with no time component. Only nonsense is rejected.
    const minutes = durationMin === undefined || durationMin === null || durationMin === ''
      ? 0
      : Number(durationMin);
    if (!Number.isFinite(minutes) || minutes < 0) {
      badRequest('Estimated time must be zero or more minutes.');
    }
    if (minutes > MAX_DURATION_MIN) {
      badRequest('Estimated time looks wrong — it cannot exceed 24 hours.');
    }
    if (!declaredValue || Number(declaredValue) <= 0) {
      badRequest('Declared value of the item is required.');
    }
    if (type !== undefined && !DELIVERY_TYPES.some((t) => t.value === type)) {
      badRequest('Invalid delivery type.');
    }

    // Money the rider may have to collect, so neither is optional and neither is
    // taken on trust: whatever the form sent has to be one of the configured
    // values, or a crafted request could store "free" and a rider would arrive
    // expecting to collect nothing.
    if (!itemPayment || !ITEM_PAYMENTS.some((o) => o.value === itemPayment)) {
      badRequest('Say whether the item is prepaid or cash on delivery.');
    }
    if (!deliveryPaidBy || !DELIVERY_PAYERS.some((o) => o.value === deliveryPaidBy)) {
      badRequest('Say who is paying for the delivery.');
    }

    // The recipient is who the rider is actually delivering to, so both fields
    // are required — a drop-off address with nobody to ask for is what sends a
    // rider back to base with the parcel.
    const finalRecipientName = String(recipientName ?? '').trim();
    const finalRecipientPhone = String(recipientPhone ?? '').trim();
    if (!finalRecipientName) badRequest("Enter the recipient's name.");
    if (!finalRecipientPhone) badRequest("Enter the recipient's phone number.");
    if (!isValidPhone(finalRecipientPhone)) {
      badRequest('That recipient phone number does not look like a real number.');
    }

    const [params, options] = await Promise.all([getPricingParams(), getDeliveryOptions()]);

    // The category has to be one the admin actually configured — the form sends a
    // label, so without this check anything could be typed into the record. It is
    // required whenever there is a list to choose from, and skipped entirely when
    // an install has none, which is also when the form hides the field.
    const category = String(itemCategory ?? '').trim();
    let finalCategory = '';
    if (options.itemCategories.length > 0) {
      if (!category) badRequest('Choose what kind of item is being sent.');
      const match = options.itemCategories.find((c) => c.toLowerCase() === category.toLowerCase());
      if (!match) badRequest('That item category is no longer available — pick another.');
      // The configured spelling is stored, not the caller's.
      finalCategory = match;
    } else if (category) {
      badRequest('No item categories are configured for this portal.');
    }

    const { price } = calcPrice(
      params,
      distance,
      minutes,
      Array.isArray(surcharges) ? surcharges : []
    );

    // A merchant always files under their own identity. Ops/admin may file on
    // behalf of a named merchant, resolved by company name.
    let merchantId = user.id;
    let finalCustomer = user.companyName;

    if (user.role !== 'merchant' && customer && customer.trim()) {
      const supabase = await createSupabaseServerClient();
      const { data: merchant } = await supabase
        .from('profiles')
        .select('id, company_name')
        .eq('role', 'merchant')
        .ilike('company_name', customer.trim())
        .maybeSingle();

      if (!merchant) {
        badRequest(
          `No merchant account found for "${customer.trim()}". Create the merchant account first, or leave the field blank to file under your own name.`
        );
      }
      merchantId = merchant.id;
      finalCustomer = merchant.company_name;
    }

    // Only the write is wrapped: a request rejected by the validation above never
    // claims the key, so fixing the input and resubmitting works normally.
    const created = await withIdempotency('delivery-create', user.id, key, async () => {
      try {
        const delivery = await createDelivery({
          merchantId,
          customer: finalCustomer,
          recipientName: finalRecipientName,
          recipientPhone: finalRecipientPhone,
          submittedBy: user.id,
          pickup,
          dropoff,
          distance: Number(distance),
          durationMin: minutes,
          type: type || 'Standard',
          itemCategory: finalCategory,
          surcharges: Array.isArray(surcharges) ? surcharges : [],
          declaredValue: Number(declaredValue),
          itemPayment,
          deliveryPaidBy,
          price,
          status: 'Requested',
        });
        return { delivery };
      } catch (e) {
        if (e instanceof DeliveryError) badRequest(e.message);
        throw e;
      }
    });

    return NextResponse.json(created);
  });
}
