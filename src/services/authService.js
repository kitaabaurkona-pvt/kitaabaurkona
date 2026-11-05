import { supabase } from '../clients/supabase';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// `profile` is copied into public.users by a database trigger that validates every field.
// It is user-editable metadata, so it must never be used for authorization decisions.
export async function signUp(email, password, profile = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Role is read from the users table (RLS limits this to the caller's own row).
export async function getUserRole(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data?.role ?? null;
}
