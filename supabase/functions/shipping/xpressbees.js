import { clean } from './text.js';

// Client for the Xpressbees Custom API (shipment.xpressbees.com).
// Sends requests to one fixed host only, times out after 15 s, keeps the session token in
// the database (service role only) and logs in again once if Xpressbees says it expired.
// Never logs the password, the token or customer details.

export class XpressbeesError extends Error {
  // retryable: a later attempt may work (network, timeout, 5xx, 429).
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'XpressbeesError';
    this.status = status;
    this.retryable = retryable;
  }
}

// Expiry from the token itself (it is a JWT), a little early to be safe; 2 h if unreadable.
export function tokenExpiry(token, now = Date.now()) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    if (Number.isFinite(payload.exp)) return new Date(Math.min(payload.exp * 1000 - 5 * 60000, now + 12 * 3600000));
  } catch {
    // fall through
  }
  return new Date(now + 2 * 3600000);
}

// Xpressbees messages can echo request data; keep them short and on one line.
export const cleanMessage = (value) => clean(value, 200);

export function createXpressbees({ baseUrl, email, password, tokenStore, fetchImpl = fetch, timeoutMs = 15000 }) {
  if (!email || !password) throw new XpressbeesError('Xpressbees login is not configured');

  async function call(path, { method = 'GET', body, token } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (e) {
      throw new XpressbeesError(e?.name === 'AbortError' ? 'Xpressbees did not answer in time' : 'Could not reach Xpressbees', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  async function login() {
    const { status, json } = await call('/api/users/login', { method: 'POST', body: { email, password } });
    if (status >= 500 || status === 429) throw new XpressbeesError('Xpressbees login is unavailable', { status, retryable: true });
    if (!json?.status || typeof json.data !== 'string' || json.data.length < 20) {
      throw new XpressbeesError('Xpressbees login was refused (check the email and password secrets)', { status });
    }
    const token = json.data;
    await tokenStore.set(token, tokenExpiry(token));
    return token;
  }

  async function authed(path, options = {}) {
    let token = (await tokenStore.get()) ?? (await login());
    let result = await call(path, { ...options, token });
    if (result.status === 401 || result.status === 403) {
      token = await login();
      result = await call(path, { ...options, token });
    }
    const { status, json } = result;
    if (status >= 500 || status === 429) throw new XpressbeesError('Xpressbees is unavailable', { status, retryable: true });
    if (status === 401 || status === 403) throw new XpressbeesError('Xpressbees refused the request', { status });
    return { status, json };
  }

  // Xpressbees answers { status: true, data } on success, { status: false, message } otherwise.
  const expectOk = ({ status, json }, what) => {
    if (json?.status === true) return json;
    throw new XpressbeesError(`${what}: ${cleanMessage(json?.message) || `HTTP ${status}`}`, { status });
  };

  return {
    login,
    async couriers() {
      return expectOk(await authed('/api/courier'), 'Courier list failed').data ?? [];
    },
    // [] when the PIN code cannot be served.
    async serviceability({ origin, destination, payment_type, order_amount, weight, length, breadth, height }) {
      const r = await authed('/api/courier/serviceability', {
        method: 'POST',
        body: {
          origin,
          destination,
          payment_type,
          order_amount: String(order_amount),
          weight: String(weight),
          length: String(length),
          breadth: String(breadth),
          height: String(height),
        },
      });
      if (r.json?.status === true) return Array.isArray(r.json.data) ? r.json.data : [];
      if (r.status === 400 || r.status === 404 || r.status === 422 || r.json?.status === false) return [];
      throw new XpressbeesError(`PIN check failed: HTTP ${r.status}`, { status: r.status });
    },
    async book(payload) {
      return expectOk(await authed('/api/shipments2', { method: 'POST', body: payload }), 'Booking refused').data;
    },
    async bookReturn(payload) {
      return expectOk(await authed('/api/reverseshipments', { method: 'POST', body: payload }), 'Return pickup refused').data;
    },
    async track(awbNumber) {
      return expectOk(await authed(`/api/shipments2/track/${encodeURIComponent(awbNumber)}`), 'Tracking failed').data;
    },
    async cancel(awbNumber) {
      return expectOk(await authed('/api/shipments2/cancel', { method: 'POST', body: { awb: awbNumber } }), 'Cancel refused');
    },
    async manifest(awbs) {
      return expectOk(await authed('/api/shipments2/manifest', { method: 'POST', body: { awbs } }), 'Manifest failed').data;
    },
    async ndrList() {
      return expectOk(await authed('/api/ndr'), 'NDR list failed').data ?? [];
    },
    async ndrCreate(items) {
      const r = await authed('/api/ndr/create', { method: 'POST', body: items });
      if (!Array.isArray(r.json)) throw new XpressbeesError(`NDR action failed: HTTP ${r.status}`, { status: r.status });
      return r.json.map((row) => ({ awb: String(row?.awb ?? ''), ok: row?.status === true, message: cleanMessage(row?.message) }));
    },
  };
}
