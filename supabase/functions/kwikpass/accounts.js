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
// A link that is refused for a reason the customer can act on (message shown as it is).
export class LinkConflict extends Error {}

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

  // A signed-in customer proves a number with an OTP and it joins their account, so they
  // can log in with it from now on. Refused (LinkConflict, message for the customer)
  // when the number already belongs to another account or the account already has a
  // different verified number. A production number also becomes the profile's number.
  async function link(environment, phone, userId) {
    const existing = await lookup(environment, phone);
    if (existing && existing.userId !== userId) {
      throw new LinkConflict('This mobile number already belongs to another account. Log out and log in with the number instead, or verify a different number.');
    }
    if (!existing) {
      const { data: owner, error } = await db.rpc('kwikpass_link_phone', {
        p_environment: environment,
        p_phone: phone,
        p_user: userId,
        p_via: 'account_link',
      });
      if (error?.code === '23505' || /different verified mobile number/.test(error?.message ?? '')) {
        throw new LinkConflict('Your account already has a different verified mobile number.');
      }
      if (error) throw new AccountError(`could not link the number: ${error.message}`);
      if (owner !== userId) {
        throw new LinkConflict('This mobile number already belongs to another account. Log out and log in with the number instead, or verify a different number.');
      }
    }
    if (environment === 'production') {
      const { error } = await db.from('users').update({ phone }).eq('id', userId);
      if (error) throw new AccountError(`could not save the number on the profile: ${error.message}`);
    }
    return { alreadyLinked: Boolean(existing) };
  }

  // The signed-in customer behind a session token, or null.
  async function userOfSession(accessToken) {
    if (!accessToken) return null;
    const { data, error } = await db.auth.getUser(accessToken);
    return error || !data?.user?.id ? null : data.user;
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

  return { lookup, findOrCreate, link, userOfSession, signInCode };
}
