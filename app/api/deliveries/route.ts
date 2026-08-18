import { NextResponse } from 'next/server';
import { badRequest, handle, readJson, requireUser } from '@/lib/http';
import { calcPrice } from '@/lib/pricing';
import { getPricingParams } from '@/lib/settings';
import { DeliveryError, createDelivery, listDeliveriesFor } from '@/lib/deliveries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DELIVERY_TYPES, type DeliveryType } from '@/lib/types';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return NextResponse.json({ deliveries: await listDeliveriesFor(user) });
  });
}

interface CreateBody {
  pickup: string;
  dropoff: string;
  distance: number | string;
  type?: DeliveryType;
  surcharges?: string[];
  declaredValue: number | string;
  agreed?: number | string;
  customer?: string;
}

/**
 * Price is recalculated here from the saved pricing parameters, so whatever
 * recommended/minimum the browser displayed is irrelevant — a merchant cannot
 * submit a fabricated price. The RLS INSERT policy independently guarantees the
 * row can only be filed under the submitter's own merchant id.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson<CreateBody>(req);
    const { pickup, dropoff, distance, type, surcharges, declaredValue, agreed, customer } = body;

    if (!pickup || !dropoff || !distance) {
      badRequest('Pickup, drop-off and distance are required.');
    }
    if (Number(distance) <= 0) badRequest('Distance must be greater than zero.');
    if (!declaredValue || Number(declaredValue) <= 0) {
      badRequest('Declared value of the item is required.');
    }
    if (type !== undefined && !DELIVERY_TYPES.some((t) => t.value === type)) {
      badRequest('Invalid delivery type.');
    }

    const params = await getPricingParams();
    const { recommended, minimum } = calcPrice(
      params,
      distance,
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

    const hasAgreed = agreed !== undefined && agreed !== null && agreed !== '';
    const finalAgreed = hasAgreed ? Number(agreed) : recommended;

    try {
      const delivery = await createDelivery({
        merchantId,
        customer: finalCustomer,
        submittedBy: user.id,
        pickup,
        dropoff,
        distance: Number(distance),
        type: type || 'Standard',
        surcharges: Array.isArray(surcharges) ? surcharges : [],
        declaredValue: Number(declaredValue),
        recommended,
        minimum,
        agreed: finalAgreed,
        status: finalAgreed < minimum ? 'Requires approval' : 'Requested',
      });
      return NextResponse.json({ delivery });
    } catch (e) {
      if (e instanceof DeliveryError) badRequest(e.message);
      throw e;
    }
  });
}
