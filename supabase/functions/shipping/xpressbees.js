import { clean } from './text.js';

// Client for the Xpressbees Custom API (shipment.xpressbees.com).
// Sends requests to one fixed host only, times out after 15 s, keeps the session token in
// the database (service role only) and logs in again once if Xpressbees says it expired.
// Never logs the password, the token or customer details.

export class XpressbeesError extends Error {
  // retryable: a later attempt may work (network, timeout, 5xx, 429).
  // reason: Xpressbees' own words, without our prefix ('' when it gave none).
  // afterSend: the request itself may have reached Xpressbees.
  // uncertain: a booking whose outcome is unknown; Xpressbees may have booked it.
  constructor(message, { status = 0, retryable = false, reason = '', afterSend = false, uncertain = false } = {}) {
    super(message);
    this.name = 'XpressbeesError';
    this.status = status;
    this.retryable = retryable;
    this.reason = reason;
    this.afterSend = afterSend;
    this.uncertain = uncertain;
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

// Xpressbees messages can echo request data: phone numbers and email addresses are
// blanked, and the text is kept short and on one line.
export function redact(value) {
  return String(value ?? '')
    .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone]')
    .replace(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/gi, '[email]');
}
export const cleanMessage = (value) => clean(redact(value), 200);

// Everything readable in an answer, whatever its shape: { message }, { error },
// Laravel-style { errors: { field: ["…"] } }, { data: "…" } or an HTML error page.
export function explain(json, text) {
  const parts = [];
  const add = (value, label = '', depth = 0) => {
    if (value === null || value === undefined || depth > 3 || parts.length >= 6) return;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t) parts.push(label ? `${label}: ${t}` : t);
    } else if (Array.isArray(value)) {
      value.slice(0, 6).forEach((v) => add(v, label, depth + 1));
    } else if (typeof value === 'object') {
      for (const [key, v] of Object.entries(value).slice(0, 10)) add(v, typeof v === 'string' || Array.isArray(v) ? key : '', depth + 1);
    }
  };
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const key of ['message', 'msg', 'error', 'errors', 'reason', 'detail', 'details']) add(json[key]);
    if (json.status !== true && typeof json.data === 'string') add(json.data);
  }
  // Not JSON at all (an HTML error page, plain text): its title or text is the reason.
  if (parts.length === 0 && (json === null || typeof json !== 'object') && typeof text === 'string' && text.trim()) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1];
    const body = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    add(title || body);
  }
  return cleanMessage([...new Set(parts)].join(' · '));
}

const NO_RECORD = /no record|not found|no data/i;

export function createXpressbees({ baseUrl, email, password, tokenStore, fetchImpl = fetch, timeoutMs = 15000, log = null }) {
  if (!email || !password) throw new XpressbeesError('Xpressbees login is not configured');

  // Every refusal is logged with the path, status and Xpressbees' own words (redacted),
  // so a failure can always be explained afterwards.
  const note = (path, status, reason) => {
    log?.warn?.(JSON.stringify({ event: 'xpressbees_refused', path: path.replace(/\/track\/.*/, '/track/:awb'), status, reason: reason || '(no reason given)' }));
  };

  async function call(path, { method = 'GET', body, token } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let text = '';
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
      text = await res.text();
    } catch (e) {
      throw new XpressbeesError(e?.name === 'AbortError' ? 'Xpressbees did not answer in time' : 'Could not reach Xpressbees', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text: text.slice(0, 4000) };
  }

  async function login() {
    const { status, json, text } = await call('/api/users/login', { method: 'POST', body: { email, password } });
    if (status >= 500 || status === 429) throw new XpressbeesError('Xpressbees login is unavailable', { status, retryable: true });
    if (!json?.status || typeof json.data !== 'string' || json.data.length < 20) {
      note('/api/users/login', status, explain(json, text));
      throw new XpressbeesError('Xpressbees login was refused (check the EXPRESSBEES_EMAIL and EXPRESSBEES_PASSWORD secrets)', { status });
    }
    const token = json.data;
    await tokenStore.set(token, tokenExpiry(token));
    return token;
  }

  // The request itself (not the login before it): a failure here may come after
  // Xpressbees already acted on it.
  async function send(path, options) {
    try {
      return await call(path, options);
    } catch (e) {
      if (e instanceof XpressbeesError) e.afterSend = true;
      throw e;
    }
  }

  async function authed(path, options = {}) {
    let token = (await tokenStore.get()) ?? (await login());
    let result = await send(path, { ...options, token });
    if (result.status === 401 || result.status === 403) {
      token = await login();
      result = await send(path, { ...options, token });
    }
    const { status, json, text } = result;
    if (status >= 500 || status === 429) {
      const reason = explain(json, text);
      note(path, status, reason);
      // 429 means "slow down": nothing was done. A 5xx may come after the work was done.
      throw new XpressbeesError(`Xpressbees is unavailable (HTTP ${status})`, { status, retryable: true, reason, afterSend: status !== 429 });
    }
    if (status === 401 || status === 403) {
      note(path, status, explain(json, text));
      throw new XpressbeesError('Xpressbees refused the request', { status });
    }
    return result;
  }

  // Xpressbees answers { status: true, data } on success and { status: false, message }
  // (or another shape, sometimes with HTTP 4xx) otherwise.
  const expectOk = (result, path, what) => {
    if (result.json?.status === true) return result.json;
    const reason = explain(result.json, result.text);
    note(path, result.status, reason);
    const code = result.status && result.status !== 200 ? ` (HTTP ${result.status})` : '';
    throw new XpressbeesError(`${what}${code}: ${reason || 'Xpressbees gave no reason'}`, { status: result.status, reason });
  };
  const okOrEmpty = (result) => result.json?.status !== true && NO_RECORD.test(explain(result.json, result.text));

  return {
    login,
    async couriers() {
      return expectOk(await authed('/api/courier'), '/api/courier', 'Courier list failed').data ?? [];
    },
    // [] when the PIN code cannot be served.
    async serviceability({ origin, destination, payment_type, order_amount, weight, length, breadth, height }) {
      const path = '/api/courier/serviceability';
      const r = await authed(path, {
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
      note(path, r.status, explain(r.json, r.text));
      throw new XpressbeesError(`PIN check failed (HTTP ${r.status})`, { status: r.status });
    },
    // Books one parcel. Only a clear refusal (Xpressbees says no and why) is a plain
    // error. Anything else after the request was sent (an error with no reason such as
    // the bare 404 Xpressbees sometimes answers after booking anyway, a server error, a
    // timeout) is "uncertain": the parcel may be booked, so it must not be sent again.
    async book(payload) {
      const path = '/api/shipments2';
      let r;
      try {
        r = await authed(path, { method: 'POST', body: payload });
      } catch (e) {
        if (e instanceof XpressbeesError && e.afterSend) {
          e.uncertain = true;
          e.retryable = false;
        }
        throw e;
      }
      if (r.json?.status === true) return r.json.data;
      const reason = explain(r.json, r.text);
      note(path, r.status, reason);
      const isObject = r.json !== null && typeof r.json === 'object' && !Array.isArray(r.json);
      const clear = Boolean(reason) && isObject && (r.json.status === false || [400, 409, 422].includes(r.status));
      const code = r.status && r.status !== 200 ? ` (HTTP ${r.status})` : '';
      throw new XpressbeesError(`Booking refused${code}: ${reason || 'Xpressbees gave no reason'}`, { status: r.status, reason, afterSend: true, uncertain: !clear });
    },
    async bookReturn(payload) {
      return expectOk(await authed('/api/reverseshipments', { method: 'POST', body: payload }), '/api/reverseshipments', 'Return pickup refused').data;
    },
    // null while Xpressbees has no tracking events for the parcel yet.
    async track(awbNumber) {
      const path = `/api/shipments2/track/${encodeURIComponent(awbNumber)}`;
      const r = await authed(path);
      if (okOrEmpty(r)) return null;
      return expectOk(r, path, 'Tracking failed').data;
    },
    async cancel(awbNumber) {
      return expectOk(await authed('/api/shipments2/cancel', { method: 'POST', body: { awb: awbNumber } }), '/api/shipments2/cancel', 'Cancel refused');
    },
    async manifest(awbs) {
      return expectOk(await authed('/api/shipments2/manifest', { method: 'POST', body: { awbs } }), '/api/shipments2/manifest', 'Manifest failed').data;
    },
    // [] when there are no failed deliveries ("No record found").
    async ndrList() {
      const r = await authed('/api/ndr');
      if (okOrEmpty(r)) return [];
      return expectOk(r, '/api/ndr', 'NDR list failed').data ?? [];
    },
    async ndrCreate(items) {
      const r = await authed('/api/ndr/create', { method: 'POST', body: items });
      if (!Array.isArray(r.json)) {
        const reason = explain(r.json, r.text);
        note('/api/ndr/create', r.status, reason);
        throw new XpressbeesError(`NDR action failed (HTTP ${r.status}): ${reason || 'Xpressbees gave no reason'}`, { status: r.status });
      }
      return r.json.map((row) => ({ awb: String(row?.awb ?? ''), ok: row?.status === true, message: cleanMessage(row?.message) }));
    },
  };
}
