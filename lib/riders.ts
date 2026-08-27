// Rider roster queries. Ops/admin only — enforced by RLS, so merchants get an
// empty result rather than a leak even if a caller forgets to check.

import { createSupabaseServerClient } from './supabase/server';
import { userMessage } from './errors';
import type { Rider, RiderStatus } from './types';
import type { Database } from './database.types';

type RiderRow = Database['public']['Tables']['riders']['Row'];

export class RiderError extends Error {}

function fromRow(r: RiderRow): Rider {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    regNumber: r.reg_number,
    model: r.model,
    status: r.status,
  };
}

export async function listRiders(): Promise<Rider[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new RiderError(userMessage('riders.listRiders', error, 'Could not load the riders list.'));
  return (data ?? []).map(fromRow);
}

export async function createRider(input: {
  name: string;
  phone: string;
  regNumber: string;
  model: string;
}): Promise<Rider> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('riders')
    .insert({
      name: input.name.trim(),
      phone: input.phone.trim(),
      reg_number: input.regNumber.trim(),
      model: input.model.trim(),
    })
    .select('*')
    .single();

  if (error) throw new RiderError(userMessage('riders.createRider', error, 'Could not add that rider. Try again.'));
  return fromRow(data);
}

export async function setRiderStatus(id: string, status: RiderStatus): Promise<Rider> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('riders')
    .update({ status })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error)
    throw new RiderError(userMessage('riders.setRiderStatus', error, 'Could not change that rider’s status.'));
  if (!data) throw new RiderError('Rider not found.');
  return fromRow(data);
}
