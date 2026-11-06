import { supabase } from '../clients/supabase';
import { unwrap } from './request';

export async function getProfile(userId) {
  const { data } = unwrap(
    await supabase.from('users').select('email, full_name, phone, gender, address').eq('id', userId).maybeSingle(),
  );
  return data;
}

// The database only lets users change these four columns of their own row.
export async function updateProfile(userId, { full_name, phone, gender, address }) {
  const { data } = unwrap(
    await supabase
      .from('users')
      .update({ full_name, phone, gender, address })
      .eq('id', userId)
      .select('email, full_name, phone, gender, address')
      .single(),
  );
  return data;
}
