// Calls to GoKwik's own API. Only one is used: Update Order, which tells GoKwik about a
// parcel's AWB and status, a cancellation, and (with refund_amount) asks for a refund.

import { GOKWIK_API_HOST } from './config.js';

export class GokwikApiError extends Error {
  // unclear: no usable answer came back (timeout, network, server error), so GoKwik may
  // or may not have acted on the request.
  constructor(message, { status = 0, unclear = false } = {}) {
    super(message);
    this.name = 'GokwikApiError';
    this.status = status;
    this.unclear = unclear;
  }
}

// Returns null when the keys or the address are not set (or the address is not GoKwik's),
// so the caller can tell "not set up" from "failed". anyHost is for tests only.
export function createGokwikApi({ baseUrl, appId, appSecret, timeoutMs = 15000, fetchImpl = fetch, anyHost = false }) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!appId || !appSecret || !(anyHost || GOKWIK_API_HOST.test(base))) return null;

  return {
    async updateOrder(payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${base}/v3/orders/update`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'gk-app-id': appId, 'gk-app-secret': appSecret },
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        throw new GokwikApiError('GoKwik did not answer', { unclear: true });
      } finally {
        clearTimeout(timer);
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (res.status >= 500) throw new GokwikApiError(`GoKwik answered HTTP ${res.status}`, { status: res.status, unclear: true });
      const refused = !res.ok || json?.success === false || (json?.status_code !== undefined && Number(json.status_code) >= 400);
      if (refused) {
        const reason = typeof json?.error === 'string' ? json.error : typeof json?.message === 'string' ? json.message : '';
        throw new GokwikApiError(`GoKwik refused the update (HTTP ${res.status})${reason ? `: ${reason}` : ''}`.slice(0, 280), { status: res.status });
      }
      return true;
    },
  };
}
