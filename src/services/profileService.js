import { loadSupabase } from '../clients/supabase';
import { unwrap } from './request';

const COLUMNS = 'email, full_name, phone, gender, address, city, state, pincode';
// The columns a customer may change on their own row (see supabase/schema.sql).
const EDITABLE = ['full_name', 'phone', 'gender', 'address', 'city', 'state', 'pincode'];

export async function getProfile(userId) {
  const supabase = await loadSupabase();
  const { data } = unwrap(await supabase.from('users').select(COLUMNS).eq('id', userId).maybeSingle());
  return data;
}

// Saves only the fields given (null clears one). The database refuses any other column.
export async function updateProfile(userId, values) {
  const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => EDITABLE.includes(key) && value !== undefined));
  const supabase = await loadSupabase();
  const { data } = unwrap(await supabase.from('users').update(changes).eq('id', userId).select(COLUMNS).single());
  return data;
}

// Everything checkout needs to deliver: once these are saved the customer is never asked
// again ("Your details" page, pages/Details.jsx).
export function hasDeliveryDetails(p) {
  return Boolean(p && p.full_name && p.phone && p.address && p.city && p.state && p.pincode);
}

// Whether the signed-in customer still has to fill in their details. Anything that stops
// the check (a slow network, a database without the new columns yet) never blocks them.
export async function needsDetails(userId) {
  try {
    return !hasDeliveryDetails(await getProfile(userId));
  } catch {
    return false;
  }
}
