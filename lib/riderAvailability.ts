// Keeping a rider's availability honest, from the deliveries they are carrying.
//
// The Riders tab used to be maintained entirely by hand, which meant it drifted:
// ops sets someone to 'On delivery', the job finishes, nobody remembers. Now that
// riders accept and complete jobs themselves, the deliveries table already knows
// the answer, so availability is derived from it rather than remembered.
//
// Derived, not stored twice: this recomputes from whatever deliveries the rider
// currently has, so it lands on the right answer even when it is called after a
// reassignment, a double tap, or two jobs finishing seconds apart. Calling it
// more often than necessary is harmless.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { DeliveryStatus } from './types';

/**
 * A rider is busy from the moment they accept until the delivery is closed out.
 *
 * 'Pending' is not on the list: being offered a job is not carrying one, and a
 * rider with an unanswered offer is still free to take something else. 'Declined'
 * and 'Delivered' are likewise not — one they refused, the other is finished.
 */
const IN_FLIGHT: DeliveryStatus[] = ['Assigned', 'Picked up', 'Recipient confirmed'];

/**
 * Sets the rider to 'On delivery' or 'Available' based on what they are carrying.
 *
 * `excludeDeliveryId` is for the reassignment case, where the delivery has just
 * been taken off this rider and the row may not reflect that yet.
 *
 * Never overrides 'Offline'. A rider who has gone home should stay gone home —
 * finishing their last job of the day must not quietly put them back in the pool,
 * because the next thing that happens is ops offering them work.
 *
 * Best-effort by design: a failure here is logged and swallowed. The delivery
 * transition that prompted it is the fact that matters, and a stale rider status
 * is a cosmetic problem ops can fix on the Riders tab — losing a confirmed
 * delivery because a bookkeeping update failed would not be.
 */
export async function syncRiderAvailability(
  client: SupabaseClient<Database>,
  riderId: string | null | undefined,
  excludeDeliveryId?: string
): Promise<void> {
  if (!riderId) return;

  try {
    const { data: rider, error: riderError } = await client
      .from('riders')
      .select('status')
      .eq('id', riderId)
      .maybeSingle();

    if (riderError) throw new Error(riderError.message);
    if (!rider || rider.status === 'Offline') return;

    let query = client
      .from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('rider_id', riderId)
      .in('status', IN_FLIGHT);

    if (excludeDeliveryId) query = query.neq('id', excludeDeliveryId);

    const { count, error: countError } = await query;
    if (countError) throw new Error(countError.message);

    const next = (count ?? 0) > 0 ? 'On delivery' : 'Available';
    if (next === rider.status) return;

    const { error: updateError } = await client
      .from('riders')
      .update({ status: next })
      .eq('id', riderId);

    if (updateError) throw new Error(updateError.message);
  } catch (e) {
    console.error(`Could not sync availability for rider ${riderId}.`, e);
  }
}
