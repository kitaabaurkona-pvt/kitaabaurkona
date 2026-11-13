import { CarrierError } from './carrier.js';
import { cleanMessage } from './text.js';

// Client for the Delhivery Express (B2C) API (track.delhivery.com).
// Sends requests to one fixed host only with the account's static API token
// ("Authorization: Token …"), times out after 15 s, never follows redirects, and never
// logs the token or customer details. Delhivery has no login step: the token is the key.

export class DelhiveryError extends CarrierError {
  constructor(message, options) {
    super(message, options);
    this.name = 'DelhiveryError';
  }
}

// Label PDFs are only accepted from Delhivery's own or its Amazon S3 file hosts.
const LABEL_HOST = /(^|\.)(delhivery\.com|amazonaws\.com)$/i;
export function labelUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LABEL_HOST.test(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// Everything readable in a Delhivery answer, whatever its shape: { rmk }, { remark },
// { Error }, { detail }, { pickup_location: "…" }, packages[].remarks (a string or a list)
// or a plain-text / HTML error page.
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
      for (const [key, v] of Object.entries(value).slice(0, 12)) {
        if (['upload_wbn', 'waybill', 'refnum', 'client', 'sort_code', 'payment', 'status'].includes(key)) continue;
        add(v, typeof v === 'string' && !['rmk', 'remark', 'remarks', 'Error', 'error', 'detail', 'message'].includes(key) ? key : '', depth + 1);
      }
    }
  };
  if (json && typeof json === 'object') {
    if (Array.isArray(json.packages)) json.packages.slice(0, 3).forEach((p) => add(p?.remarks));
    for (const key of ['rmk', 'remark', 'remarks', 'Error', 'error', 'detail', 'message']) add(json[key]);
    if (parts.length === 0 && !Array.isArray(json)) add(json);
  }
  if (parts.length === 0 && (json === null || typeof json !== 'object') && typeof text === 'string' && text.trim()) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1];
    const body = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    add(title || body);
  }
  return cleanMessage([...new Set(parts)].join(' · '));
}

// Answers that do not say clearly that nothing was booked.
const UNCLEAR = /internal error|partially saved|crash|try again|timed? ?out|exception/i;
const NOT_FOUND = /does not exist|no data|not found/i;

// Delhivery's way of saying the pickup location (warehouse) name we sent is not
// registered on the account: "ClientWarehouse matching query does not exist".
const NO_WAREHOUSE = /clientwarehouse|client warehouse|invalid pickup location/i;
export const noWarehouseMessage = (name) =>
  `Delhivery has no pickup location named "${String(name ?? '').slice(0, 60)}" on this account (the name is case-sensitive). In Admin > Shipping, type the name exactly as the Delhivery panel shows it, or press "Register pickup address with Delhivery". Then try again.`;

export function createDelhivery({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15000, log = null }) {
  if (!token) throw new DelhiveryError('Delhivery is not set up (the DELHIVERY_API_TOKEN secret is missing)');

  const note = (path, status, reason) => {
    log?.warn?.(JSON.stringify({ event: 'delhivery_refused', path: path.split('?')[0], status, reason: reason || '(no reason given)' }));
  };

  async function call(path, { method = 'GET', json, form } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let text = '';
    try {
      const headers = { authorization: `Token ${token}`, accept: 'application/json' };
      let body;
      if (form !== undefined) {
        // The order API wants "format=json&data=<json>", URL-encoded, so &, #, %, ; and \
        // inside addresses cannot break the payload.
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams({ format: 'json', data: JSON.stringify(form) }).toString();
      } else if (json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(json);
      }
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body, signal: controller.signal, redirect: 'error' });
      text = await res.text();
    } catch (e) {
      throw new DelhiveryError(e?.name === 'AbortError' ? 'Delhivery did not answer in time' : 'Could not reach Delhivery', { retryable: true, afterSend: true });
    } finally {
      clearTimeout(timer);
    }
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const result = { status: res.status, json: parsed, text: text.slice(0, 4000) };
    if (res.status >= 500 || res.status === 429) {
      const reason = explain(parsed, text);
      note(path, res.status, reason);
      throw new DelhiveryError(`Delhivery is unavailable (HTTP ${res.status})`, { status: res.status, retryable: true, reason, afterSend: res.status !== 429 });
    }
    if (res.status === 401 || res.status === 403) {
      // Delhivery also answers 401 for some plain refusals (e.g. an unknown pickup
      // location): only an answer about the login itself is a token problem.
      const reason = explain(parsed, text);
      if (!parsed || typeof parsed !== 'object' || !reason || /login|api key|authenticat|credential|token|permission/i.test(reason)) {
        note(path, res.status, reason);
        throw new DelhiveryError('Delhivery refused the API token (check the DELHIVERY_API_TOKEN secret)', { status: res.status });
      }
    }
    return result;
  }

  const fail = (r, path, what) => {
    const reason = explain(r.json, r.text);
    note(path, r.status, reason);
    const code = r.status && r.status !== 200 && r.status !== 201 ? ` (HTTP ${r.status})` : '';
    return new DelhiveryError(`${what}${code}: ${reason || 'Delhivery gave no reason'}`, { status: r.status, reason });
  };

  return {
    // { serviceable, prepaid, cod, pickup } for one PIN code. A PIN code under embargo
    // (Delhivery fills "remarks") is treated as not served.
    async pincode(pin) {
      const path = `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`;
      const r = await call(path);
      const list = r.json?.delivery_codes;
      if (!Array.isArray(list)) throw fail(r, path, 'PIN check failed');
      const pc = list.map((d) => d?.postal_code).find((p) => String(p?.pin) === String(pin));
      if (!pc) return { serviceable: false, prepaid: false, cod: false, pickup: false };
      const open = !(typeof pc.remarks === 'string' && pc.remarks.trim());
      const prepaid = open && pc.pre_paid === 'Y';
      const cod = open && pc.cod === 'Y';
      return { serviceable: prepaid || cod, prepaid, cod, pickup: open && pc.pickup === 'Y' };
    },

    // Approximate charge (with taxes) for one parcel; mode 'S' surface or 'E' express.
    async rate({ mode, origin, destination, grams, cod, amount }) {
      const q = new URLSearchParams({ md: mode, ss: 'Delivered', d_pin: destination, o_pin: origin, cgm: String(grams), pt: cod ? 'COD' : 'Pre-paid' });
      if (cod) q.set('cod', String(amount));
      const path = `/api/kinko/v1/invoice/charges/.json?${q}`;
      const r = await call(path);
      const row = Array.isArray(r.json) ? r.json[0] : null;
      const total = Number(row?.total_amount);
      if (!row || !Number.isFinite(total) || total < 0) throw fail(r, path, 'Rate check failed');
      return { total_charges: Math.round(total * 100) / 100, cod_charges: Number(row.charge_COD) || 0, freight_charges: Math.round((total - (Number(row.charge_COD) || 0)) * 100) / 100 };
    },

    // Books one parcel (forward or return pickup). Only a clear refusal (Delhivery says
    // no and why) is a plain error. Anything else after the request was sent (a server
    // error, a timeout, "internal error", "might have been partially saved", "duplicate
    // order id") is "uncertain": the parcel may be booked, so it must not be sent again.
    async book(payload) {
      const path = '/api/cmu/create.json';
      let r;
      try {
        r = await call(path, { method: 'POST', form: payload });
      } catch (e) {
        if (e instanceof DelhiveryError && e.afterSend) {
          e.uncertain = true;
          e.retryable = false;
        }
        throw e;
      }
      const pkg = Array.isArray(r.json?.packages) ? r.json.packages[0] : null;
      if (pkg && /^success$/i.test(String(pkg.status)) && r.json?.error !== true) {
        return { waybill: String(pkg.waybill ?? ''), refnum: pkg.refnum ?? null, status: 'Manifested' };
      }
      const reason = explain(r.json, r.text);
      note(path, r.status, reason);
      // An unregistered pickup location: nothing was booked, and the admin is told how
      // to put it right instead of being shown Delhivery's wording.
      if (NO_WAREHOUSE.test(reason) && !UNCLEAR.test(reason)) {
        throw new DelhiveryError(noWarehouseMessage(payload?.pickup_location?.name), { status: r.status, reason, afterSend: true });
      }
      const isObject = r.json !== null && typeof r.json === 'object' && !Array.isArray(r.json);
      const duplicate = /duplicate/i.test(reason);
      const clear = Boolean(reason) && isObject && !duplicate && !UNCLEAR.test(reason) && [200, 201, 400, 401, 403, 409, 422].includes(r.status);
      const code = r.status && r.status !== 200 ? ` (HTTP ${r.status})` : '';
      throw Object.assign(
        new DelhiveryError(`Booking refused${code}: ${reason || 'Delhivery gave no reason'}`, { status: r.status, reason, afterSend: true, uncertain: !clear }),
        { duplicate },
      );
    },

    // The parcel's Shipment record, or null while Delhivery has nothing for it yet.
    async track(waybill) {
      const path = `/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;
      const r = await call(path);
      const shipment = Array.isArray(r.json?.ShipmentData) ? r.json.ShipmentData[0]?.Shipment : null;
      if (shipment && typeof shipment === 'object') return shipment;
      if (NOT_FOUND.test(explain(r.json, r.text))) return null;
      throw fail(r, path, 'Tracking failed');
    },

    async cancel(waybill) {
      const path = '/api/p/edit';
      const r = await call(path, { method: 'POST', json: { waybill, cancellation: 'true' } });
      if (r.json?.status === true || String(r.json?.status).toLowerCase() === 'true') return r.json;
      throw fail(r, path, 'Cancel refused');
    },

    // A link to the parcel's label (packing slip) PDF, made on request.
    async label(waybill) {
      const path = `/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true`;
      const r = await call(path);
      const pkg = Array.isArray(r.json?.packages) ? r.json.packages[0] : null;
      const link = labelUrl(pkg?.pdf_download_link);
      if (link) return link;
      if (pkg?.pdf_download_link) {
        let host = 'not a link';
        try {
          host = new URL(pkg.pdf_download_link).host;
        } catch {
          // keep 'not a link'
        }
        log?.warn?.(JSON.stringify({ event: 'file_link_set_aside', carrier: 'delhivery', field: 'label', host }));
      }
      throw fail(r, path, 'Delhivery returned no label');
    },

    // Asks Delhivery to collect parcels from the warehouse on a date and time.
    async pickup({ date, time, location, count }) {
      const path = '/fm/request/new/';
      const r = await call(path, { method: 'POST', json: { pickup_time: `${time}:00`, pickup_date: date, pickup_location: location, expected_package_count: count } });
      if (r.json?.pickup_id !== undefined && r.json?.pickup_id !== null) {
        return { pickup_id: String(r.json.pickup_id).slice(0, 30), center: cleanMessage(r.json.incoming_center_name) };
      }
      if (NO_WAREHOUSE.test(explain(r.json, r.text))) {
        note(path, r.status, explain(r.json, r.text));
        throw new DelhiveryError(noWarehouseMessage(location), { status: r.status });
      }
      throw fail(r, path, 'Pickup request refused');
    },

    // Registers a pickup location (warehouse) on the account, with the same address for
    // returns. { created: false } when Delhivery already has one with this name.
    async registerWarehouse({ name, registeredName, phone, email, address, city, state, pin }) {
      const path = '/api/backend/clientwarehouse/create/';
      const r = await call(path, {
        method: 'POST',
        json: {
          name,
          registered_name: registeredName,
          phone,
          email,
          address,
          city,
          pin,
          country: 'India',
          return_address: address,
          return_pin: pin,
          return_city: city,
          return_state: state,
          return_country: 'India',
        },
      });
      if (r.json?.success === true) return { created: true };
      if (/already exist/i.test(explain(r.json, r.text))) return { created: false };
      throw fail(r, path, 'Delhivery did not register the pickup location');
    },

    // Failed-delivery actions (asynchronous): RE-ATTEMPT, DEFER_DLV, EDIT_DETAILS.
    async ndr(items) {
      const path = '/api/p/update';
      const r = await call(path, { method: 'POST', json: { data: items } });
      if (typeof r.json?.request_id === 'string' && r.json.request_id) return { request_id: r.json.request_id.slice(0, 40) };
      throw fail(r, path, 'Delhivery refused the action');
    },
  };
}
