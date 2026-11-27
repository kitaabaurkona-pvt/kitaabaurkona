// Opening GoKwik's KwikPass token (kpToken) and finding the mobile number in it.
//
// The kpToken is a JWE: an encrypted token that only the holder of GoKwik's secret key can
// open (GoKwik's guide: "Decode it with our secret key"; the key is base64url text, one for
// the sandbox and one for production). A token that opens with our key was made by GoKwik,
// so the number inside it is one GoKwik checked with an OTP. The decryption itself is done
// by the `jose` library, passed in as `jose` (npm:jose in Deno, the jose package in Node).

// The guide does not say which field holds the number, so the usual names are tried, at
// the top and one or two levels down (e.g. { data: { phone } } or { phone: { value } }).
const PHONE_KEYS = ['phone', 'phone_number', 'phoneNumber', 'mobile', 'mobile_number', 'mobileNumber', 'contact', 'value'];
const NESTED_KEYS = ['data', 'user', 'customer', 'payload', 'phone', 'phoneNumber', 'phone_number'];

// An Indian mobile number as the store keeps it (10 digits, no +91), or null.
export function tenDigits(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
}

// A country code other than India's means the number is not one we can deliver to or
// match, so the login is refused rather than guessed.
function foreignCountry(object) {
  const code = object?.country_code ?? object?.countryCode;
  if (code === undefined || code === null || code === '') return false;
  return String(code).replace(/\D/g, '') !== '91';
}

export function phoneFromClaims(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 2) return null;
  if (foreignCountry(payload)) return null;
  for (const key of PHONE_KEYS) {
    const phone = tenDigits(payload[key]);
    if (phone) return phone;
  }
  for (const key of NESTED_KEYS) {
    const inner = payload[key];
    if (inner && typeof inner === 'object') {
      const phone = phoneFromClaims(inner, depth + 1);
      if (phone) return phone;
    }
  }
  return null;
}

// The field names in a token (never their values), logged when no number is found so the
// right name can be added above.
export function claimNames(payload, prefix = '', depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 2) return [];
  return Object.keys(payload)
    .slice(0, 40)
    .flatMap((key) => [`${prefix}${key}`, ...claimNames(payload[key], `${prefix}${key}.`, depth + 1)]);
}

// GoKwik's key as bytes (base64url text in their guide), or null when it is not set.
export function keyBytes(text, jose) {
  const clean = (text || '').trim();
  if (!clean) return null;
  try {
    const bytes = jose.base64url.decode(clean);
    return bytes.length >= 16 ? bytes : null;
  } catch {
    return null;
  }
}

export class TokenError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// readToken(kpToken) -> { environment, payload } with the environment whose key opened it.
//   keys            { sandbox: 'base64url text', production: 'base64url text' }
//   maxAgeSeconds   when set and the token says when it was made (iat), older tokens are
//                   refused. GoKwik says its tokens never expire, so this is off unless
//                   the KWIKPASS_MAX_AGE_SECONDS secret is set.
// A token whose own expiry (exp) has passed is always refused.
export function createTokenReader({ keys, jose, maxAgeSeconds = 0, now = () => Date.now() }) {
  const usable = Object.entries(keys)
    .map(([environment, text]) => ({ environment, key: keyBytes(text, jose) }))
    .filter((entry) => entry.key);

  async function open(token, key) {
    try {
      const { payload } = await jose.jwtDecrypt(token, key, { currentDate: new Date(now()), clockTolerance: 60 });
      return payload;
    } catch (error) {
      if (error?.code === 'ERR_JWT_EXPIRED') throw new TokenError('expired');
      if (error?.code !== 'ERR_JWT_INVALID') throw error;
      // It opened but the inside is not JSON claims: read it as JSON if it is.
      const { plaintext } = await jose.compactDecrypt(token, key);
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      if (!parsed || typeof parsed !== 'object') throw new TokenError('not_json');
      return parsed;
    }
  }

  return {
    configured: usable.map((entry) => entry.environment),
    async read(token) {
      if (typeof token !== 'string' || token.split('.').length !== 5) throw new TokenError('not_a_jwe');
      if (!usable.length) throw new TokenError('no_keys');
      for (const { environment, key } of usable) {
        let payload;
        try {
          payload = await open(token, key);
        } catch (error) {
          if (error instanceof TokenError && error.reason === 'expired') throw error;
          continue;
        }
        if (maxAgeSeconds > 0 && typeof payload.iat === 'number' && now() / 1000 - payload.iat > maxAgeSeconds + 60) {
          throw new TokenError('too_old');
        }
        return { environment, payload };
      }
      throw new TokenError('wrong_key');
    },
  };
}
