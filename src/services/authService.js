import { previewMode } from '../preview/mode';
import { supabase } from '../clients/supabase';
import { safeRedirect } from '../utils/authForm';

export async function signIn(email, password) {
  if (previewMode) throw new Error('Account services are unavailable in this local frontend preview.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// `profile` is copied into public.users by a database trigger that validates every field.
// It is user-editable metadata, so it must never be used for authorization decisions.
export async function signUp(email, password, profile = {}) {
  if (previewMode) throw new Error('Account services are unavailable in this local frontend preview.');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) throw error;
  return data;
}

// Redirects the browser to Google. The return path is built from this site's own origin
// plus a sanitized in-app path, and Supabase only honors it if it is allow-listed.
// select_account stops a shared device from silently signing in as the last Google user.
export async function signInWithGoogle(nextPath) {
  if (previewMode) throw new Error('Account services are unavailable in this local frontend preview.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${safeRedirect(nextPath)}`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

// Supabase answers identically whether or not the email has an account, so callers
// must not treat success as proof that the account exists. The redirect target is
// built from this site's own origin and Supabase only honors it if it is allow-listed.
export async function requestPasswordReset(email) {
  if (previewMode) throw new Error('Account services are unavailable in this local frontend preview.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

// A reset may follow an account compromise, so every other session is revoked.
export async function updatePassword(password) {
  if (previewMode) throw new Error('Account services are unavailable in this local frontend preview.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'others' });
}

// Ends every session for this account, on all devices (Supabase revokes all refresh tokens).
export async function signOutEverywhere() {
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) throw error;
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
