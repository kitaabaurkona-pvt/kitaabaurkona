// Finding or making the store account for a verified mobile number, and the one-time
// sign-in code the website exchanges for a session. Uses the service-role Supabase client
// (database functions kwikpass_account / kwikpass_link_phone in schema.sql section 9j,
// and Supabase Auth's admin API).

import { MOBILE_EMAIL_DOMAIN } from './config.js';

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function mobileEmail() {
  return `m-${randomHex(12)}@${MOBILE_EMAIL_DOMAIN}`;
}

export class AccountError extends Error {}

export function createAccounts(db) {
  async function lookup(environment, phone) {
    const { data, error } = await db.rpc('kwikpass_account', { p_environment: environment, p_phone: phone });
    if (error) throw new AccountError(`lookup failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row?.user_id ? { userId: row.user_id, email: row.email } : null;
  }

  // The account for the number, made the first time it logs in. A production account
  // gets the number on its profile (the database trigger copies it); a sandbox account
  // does not, so test accounts never look like the real customer with that number.
  async function findOrCreate(environment, phone) {
    const existing = await lookup(environment, phone);
    if (existing) return { ...existing, created: false };

    const email = mobileEmail();
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: environment === 'production' ? { phone, signup_via: 'kwikpass' } : { signup_via: 'kwikpass-sandbox' },
    });
    if (error || !data?.user?.id) throw new AccountError(`could not make the account: ${error?.message ?? 'no user'}`);
    const userId = data.user.id;

    const { data: owner, error: linkError } = await db.rpc('kwikpass_link_phone', {
      p_environment: environment,
      p_phone: phone,
      p_user: userId,
      p_via: 'otp_login',
    });
    if (linkError || owner !== userId) {
      // Another login with the same new number got there first (or linking failed): drop
      // the account just made and use the one that holds the number.
      await db.auth.admin.deleteUser(userId).catch(() => {});
      if (linkError) throw new AccountError(`could not link the number: ${linkError.message}`);
      const winner = await lookup(environment, phone);
      if (!winner) throw new AccountError('the number has no account after linking');
      return { ...winner, created: false };
    }
    return { userId, email, created: true };
  }

  // A single-use code for this account. The website hands it to Supabase Auth
  // (verifyOtp with type "email") and gets a normal session back. No email is sent.
  async function signInCode(email) {
    if (!email) throw new AccountError('the account has no email address');
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    const hash = data?.properties?.hashed_token;
    if (error || !hash) throw new AccountError(`could not make a sign-in code: ${error?.message ?? 'no code'}`);
    return hash;
  }

  return { lookup, findOrCreate, signInCode };
}
