// The shipping function's request handling, kept free of Deno-only code so it can be
// tested with Node. index.js wires it to Supabase.
//
// Who may do what:
//   signed-in customer  check_pincode, track (own orders only)
//   admin               the above for any order, plus rates, set_courier, book_now,
//                       cancel_shipment, manifest, ndr_list, ndr_action, return_pickup
//   scheduler (cron)    run_job, with the cron secret header (no user)

import { LIMITS, PIN_CHECK_PARCEL } from './config.js';
import { ADMIN_ACTIONS, CRON_ACTIONS, InputError, parseRequest } from './validate.js';
import { XpressbeesError } from './xpressbees.js';
import { clean } from './text.js';
import {
  bookingPayload,
  bookingRecord,
  buildPackage,
  chooseCourier,
  cleanHistory,
  fileUrl,
  listCouriers,
  mapStatus,
  returnPayload,
} from './shipping.js';

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TRACKABLE = ['booked', 'in_transit', 'out_for_delivery', 'exception'];
const RECORDABLE = ['booked', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto', 'cancelled'];

// Compares secrets without leaking their length or content through timing.
async function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

function corsHeaders(origin, allowed) {
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export function createHandler({ db, makeXpressbees, cronSecret, allowedOrigins, log = console, now = () => new Date() }) {
  let xbClient = null;
  const xb = () => (xbClient ??= makeXpressbees());

  const rpc = async (fn, args = {}) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      const e = new Error(`db:${fn}`);
      e.db = error;
      throw e;
    }
    return data;
  };
  const select = async (query) => {
    const { data, error } = await query;
    if (error) {
      const e = new Error('db:select');
      e.db = error;
      throw e;
    }
    return data ?? [];
  };

  const settings = async () => (await select(db.from('shipping_settings').select('*').limit(1)))[0];
  const forwardShipment = async (orderId) =>
    (await select(db.from('shipments').select('*').eq('order_id', orderId).eq('kind', 'forward').neq('status', 'cancelled').limit(1)))[0] ?? null;

  // ---------- Shared work ----------

  async function bookOne(shipment, actor = null) {
    try {
      const data = await rpc('shipment_booking_data', { p_shipment: shipment.id });
      if (!data || !['confirmed', 'paid'].includes(data.order.status)) {
        await rpc('record_cancelled', { p_shipment: shipment.id, p_actor: actor, p_detail: 'Order is no longer active' });
        return { ok: false, reason: 'order_inactive' };
      }
      const pkg = buildPackage(data.items);
      const options = await xb().serviceability({
        origin: data.settings.pickup_pincode,
        destination: data.order.pincode,
        payment_type: data.order.payment_method === 'cod' ? 'cod' : 'prepaid',
        order_amount: data.order.subtotal,
        ...pkg,
      });
      const courier = chooseCourier(options, shipment.courier_chosen_by_admin ? shipment.courier_id : null);
      if (!courier) {
        await rpc('record_booking_failure', {
          p_shipment: shipment.id,
          p_error: `No Xpressbees courier delivers this parcel to PIN ${data.order.pincode}`,
          p_retry: false,
          p_actor: actor,
        });
        return { ok: false, reason: 'not_serviceable' };
      }
      const answer = await xb().book(bookingPayload(data, pkg, courier));
      const record = bookingRecord(answer, pkg, courier);
      if (!record) {
        await rpc('record_booking_failure', { p_shipment: shipment.id, p_error: 'Xpressbees answered without an AWB number', p_retry: false, p_actor: actor });
        return { ok: false, reason: 'bad_answer' };
      }
      try {
        await rpc('record_booking', { p_shipment: shipment.id, p: { ...record, actor } });
      } catch (e) {
        // Booked with Xpressbees but not saved: keep the AWB in the logs so it can be recovered.
        log.error(JSON.stringify({ event: 'booked_not_saved', shipment: shipment.id, awb: record.awb_number }));
        throw e;
      }
      return { ok: true, awb: record.awb_number };
    } catch (e) {
      const message = e instanceof XpressbeesError ? e.message : 'Internal error while booking';
      if (!(e instanceof XpressbeesError)) log.error(JSON.stringify({ event: 'book_error', shipment: shipment.id, error: String(e.message).slice(0, 120) }));
      try {
        await rpc('record_booking_failure', {
          p_shipment: shipment.id,
          p_error: message,
          p_retry: e instanceof XpressbeesError ? e.retryable : true,
          p_actor: actor,
        });
      } catch {
        // the stuck "booking" row is picked up again after 15 minutes
      }
      return { ok: false, reason: 'error', message };
    }
  }

  async function refreshTracking(shipment) {
    const data = await xb().track(shipment.awb_number);
    const mapped = mapStatus(data?.status) ?? (RECORDABLE.includes(shipment.status) ? shipment.status : null);
    if (!mapped) return shipment.status;
    await rpc('record_tracking', {
      p_shipment: shipment.id,
      p_status: mapped,
      p_xb_status: String(data?.status ?? '').slice(0, 80),
      p_history: cleanHistory(data?.history),
    });
    return mapped;
  }

  async function cancelWithXpressbees(shipment, actor = null) {
    if (!shipment.awb_number) {
      await rpc('record_cancelled', { p_shipment: shipment.id, p_actor: actor, p_detail: 'Not booked yet' });
      return true;
    }
    try {
      await xb().cancel(shipment.awb_number);
    } catch (e) {
      if (!(e instanceof XpressbeesError) || !/already cancel/i.test(e.message)) throw e;
    }
    await rpc('record_cancelled', { p_shipment: shipment.id, p_actor: actor, p_detail: `AWB ${shipment.awb_number} cancelled` });
    return true;
  }

  const limit = async (bucket, max, seconds) => {
    if (!(await rpc('hit_rate_limit', { p_bucket: bucket, p_limit: max, p_window_seconds: seconds }))) {
      throw new AppError(429, 'Too many requests. Try again in a little while.');
    }
  };

  // ---------- Actions ----------

  const actions = {
    async check_pincode({ pincode }, { user, ip }) {
      await limit(`pin:user:${user.id}`, LIMITS.pinChecksPerUserPerHour, 3600);
      if (ip) await limit(`pin:ip:${ip}`, LIMITS.pinChecksPerIpPerHour, 3600);
      const cached = {};
      for (const type of ['prepaid', 'cod']) {
        cached[type] = await rpc('get_pincode_check', { p_pincode: pincode, p_payment_type: type, p_max_age_minutes: LIMITS.pinCacheMinutes });
      }
      const missing = ['prepaid', 'cod'].filter((t) => cached[t] === null || cached[t] === undefined);
      if (missing.length) {
        const origin = (await settings()).pickup_pincode;
        for (const type of missing) {
          const options = await xb().serviceability({ origin, destination: pincode, payment_type: type, ...PIN_CHECK_PARCEL });
          cached[type] = chooseCourier(options) !== null;
          await rpc('save_pincode_check', { p_pincode: pincode, p_payment_type: type, p_serviceable: cached[type] });
        }
      }
      return { pincode, deliverable: Boolean(cached.prepaid || cached.cod), cod: Boolean(cached.cod) };
    },

    async track({ order_id }, { user, isAdmin }) {
      await limit(`track:${user.id}`, 120, 3600);
      const order = (await select(db.from('orders').select('id, user_id').eq('id', order_id).limit(1)))[0];
      if (!order || (order.user_id !== user.id && !isAdmin)) throw new AppError(404, 'Order not found');
      const shipments = await select(db.from('shipments').select('*').eq('order_id', order_id).order('created_at'));
      const stale = (s) => !s.last_tracked_at || now() - new Date(s.last_tracked_at) > LIMITS.trackRefreshMinutes * 60000;
      for (const s of shipments) {
        if (s.awb_number && TRACKABLE.includes(s.status) && stale(s)) {
          try {
            await refreshTracking(s);
          } catch (e) {
            if (!(e instanceof XpressbeesError)) throw e;
          }
        }
      }
      const fresh = await select(
        db.from('shipments').select('kind, status, awb_number, courier_name, history, last_tracked_at, updated_at').eq('order_id', order_id).order('created_at'),
      );
      return { shipments: fresh };
    },

    async rates({ order_id }) {
      const s = await forwardShipment(order_id);
      if (!s) throw new AppError(404, 'This order has no parcel');
      const data = await rpc('shipment_booking_data', { p_shipment: s.id });
      const pkg = buildPackage(data.items);
      const options = await xb().serviceability({
        origin: data.settings.pickup_pincode,
        destination: data.order.pincode,
        payment_type: data.order.payment_method === 'cod' ? 'cod' : 'prepaid',
        order_amount: data.order.subtotal,
        ...pkg,
      });
      return { couriers: listCouriers(options), chosen: s.courier_chosen_by_admin ? s.courier_id : null, package: pkg };
    },

    async set_courier({ order_id, courier_id }, { user }) {
      const s = await forwardShipment(order_id);
      if (!s || !['queued', 'failed'].includes(s.status)) throw new AppError(409, 'The courier can only be changed before booking');
      const { couriers } = await actions.rates({ order_id });
      const courier = couriers.find((c) => c.id === courier_id);
      if (!courier) throw new AppError(400, 'That courier does not deliver this parcel');
      await rpc('set_shipment_courier', { p_shipment: s.id, p_courier_id: courier.id, p_courier_name: courier.name, p_actor: user.id });
      return { courier };
    },

    async book_now({ order_id }, { user }) {
      const s = await forwardShipment(order_id);
      if (!s) throw new AppError(404, 'This order has no parcel');
      const claimed = await rpc('claim_shipment', { p_shipment: s.id });
      if (!Array.isArray(claimed) || claimed.length === 0) throw new AppError(409, 'This parcel is already booked or being booked');
      const result = await bookOne(claimed[0], user.id);
      if (!result.ok) throw new AppError(502, result.message ?? 'Booking failed. See the parcel for details.');
      return { awb_number: result.awb };
    },

    async cancel_shipment({ order_id }, { user }) {
      const s = (await select(db.from('shipments').select('*').eq('order_id', order_id).eq('kind', 'forward').eq('status', 'cancel_requested').limit(1)))[0];
      if (!s) throw new AppError(409, 'Only parcels of cancelled orders are cancelled here');
      await cancelWithXpressbees(s, user.id);
      return { cancelled: true };
    },

    async manifest({ order_ids }) {
      const rows = await select(
        db.from('shipments').select('awb_number, status').in('order_id', order_ids).eq('kind', 'forward').in('status', ['booked', 'in_transit']),
      );
      const awbs = rows.map((r) => r.awb_number).filter(Boolean);
      if (awbs.length === 0) throw new AppError(400, 'None of those orders has a booked parcel');
      const url = fileUrl(await xb().manifest(awbs));
      if (!url) throw new AppError(502, 'Xpressbees did not return a manifest link');
      return { url, count: awbs.length };
    },

    async ndr_list() {
      const list = await xb().ndrList();
      const awbs = list.map((r) => String(r?.awb_number ?? '')).filter((a) => /^[0-9A-Za-z]{6,30}$/.test(a));
      if (awbs.length === 0) return { items: [] };
      const ours = await select(db.from('shipments').select('order_id, awb_number, status').in('awb_number', awbs));
      const orders = ours.length ? await select(db.from('orders').select('id, order_number, shipping_name').in('id', ours.map((s) => s.order_id))) : [];
      const byAwb = new Map(ours.map((s) => [s.awb_number, s]));
      const byOrder = new Map(orders.map((o) => [o.id, o]));
      return {
        items: list
          .filter((r) => byAwb.has(String(r?.awb_number)))
          .map((r) => {
            const s = byAwb.get(String(r.awb_number));
            const o = byOrder.get(s.order_id);
            return {
              awb: s.awb_number,
              order_id: s.order_id,
              order_number: o?.order_number ?? null,
              customer: clean(o?.shipping_name, 80),
              date: clean(r.event_date, 20),
              remarks: clean(r.courier_remarks, 160),
              attempts: Number.parseInt(r.total_attempts, 10) || 0,
            };
          }),
      };
    },

    async ndr_action({ items }, { user }) {
      const ours = await select(db.from('shipments').select('id, order_id, awb_number').in('awb_number', items.map((i) => i.awb)));
      if (ours.length !== items.length) throw new AppError(400, 'Some of those parcels are not ours');
      const results = await xb().ndrCreate(items);
      const byAwb = new Map(ours.map((s) => [s.awb_number, s]));
      for (const r of results) {
        const s = byAwb.get(r.awb);
        if (s) await rpc('log_shipment_event', { p_shipment: s.id, p_order: s.order_id, p_actor: user.id, p_action: r.ok ? 'ndr_submitted' : 'ndr_refused', p_detail: r.message });
      }
      return { results: results.filter((r) => byAwb.has(r.awb)) };
    },

    async return_pickup({ order_id }, { user }) {
      const id = await rpc('create_return_shipment', { p_order: order_id, p_actor: user.id });
      try {
        const data = await rpc('shipment_booking_data', { p_shipment: id });
        const pkg = buildPackage(data.items);
        const answer = await xb().bookReturn(returnPayload(data, pkg));
        const record = bookingRecord(answer, pkg, null);
        if (!record) throw new XpressbeesError('Xpressbees answered without an AWB number');
        await rpc('record_booking', { p_shipment: id, p: { ...record, actor: user.id } });
        return { awb_number: record.awb_number };
      } catch (e) {
        // Leave nothing half-made: the return can simply be requested again.
        await rpc('record_cancelled', { p_shipment: id, p_actor: user.id, p_detail: e instanceof XpressbeesError ? e.message : 'Internal error' });
        if (e instanceof XpressbeesError) throw new AppError(502, e.message);
        throw e;
      }
    },

    async run_job({ job }) {
      if (job === 'book_due') {
        const due = (await rpc('claim_due_shipments', { p_limit: LIMITS.bookBatch })) ?? [];
        const results = [];
        for (const s of due) results.push(await bookOne(s));
        return { claimed: due.length, booked: results.filter((r) => r.ok).length };
      }
      if (job === 'cancel_requested') {
        const rows = await select(db.from('shipments').select('*').eq('status', 'cancel_requested').limit(20));
        let done = 0;
        for (const s of rows) {
          // A parcel still mid-booking gets its AWB first (or is picked up again later).
          if (!s.awb_number && now() - new Date(s.updated_at) < 15 * 60000) continue;
          try {
            if (await cancelWithXpressbees(s)) done += 1;
          } catch (e) {
            if (!(e instanceof XpressbeesError)) throw e;
          }
        }
        return { pending: rows.length, cancelled: done };
      }
      // track_active
      const rows = (await rpc('shipments_to_track', { p_minutes: LIMITS.backgroundTrackMinutes, p_limit: 50 })) ?? [];
      let updated = 0;
      for (const s of rows) {
        try {
          await refreshTracking(s);
          updated += 1;
        } catch (e) {
          if (!(e instanceof XpressbeesError)) throw e;
        }
      }
      return { checked: rows.length, updated };
    },
  };

  // ---------- Request handling ----------

  return async function handle(req) {
    const started = Date.now();
    const ref = crypto.randomUUID().slice(0, 8);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, allowedOrigins);
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(cors ?? {}) },
      });
    const fail = (status, error) => reply(status, { ok: false, error, ref });

    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    if (origin && !cors) return fail(403, 'This site may not call the shipping service');

    let action = 'unknown';
    try {
      const declared = Number(req.headers.get('content-length') || 0);
      if (declared > LIMITS.bodyBytes) return fail(413, 'Request too large');
      const raw = await req.text();
      if (raw.length > LIMITS.bodyBytes) return fail(413, 'Request too large');
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, 'Invalid JSON');
      }
      const parsed = parseRequest(body, now());
      action = parsed.action;

      let context = {};
      if (CRON_ACTIONS.includes(action)) {
        if (!(await sameSecret(req.headers.get('x-cron-secret'), cronSecret))) return fail(401, 'Not allowed');
      } else {
        const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (!token) return fail(401, 'Sign in first');
        const { data, error } = await db.auth.getUser(token);
        const user = data?.user;
        if (error || !user?.id) return fail(401, 'Sign in again');
        const profile = (await select(db.from('users').select('role').eq('id', user.id).limit(1)))[0];
        const isAdmin = profile?.role === 'admin';
        if (ADMIN_ACTIONS.includes(action)) {
          if (!isAdmin) return fail(403, 'Admins only');
          await limit(`admin:${user.id}`, LIMITS.adminActionsPerMinute, 60);
        }
        const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '';
        context = { user, isAdmin, ip: forwarded.split(',')[0].trim().slice(0, 45) };
      }

      const data = await actions[action](parsed.input, context);
      log.info(JSON.stringify({ ref, action, ok: true, ms: Date.now() - started }));
      return reply(200, { ok: true, data });
    } catch (e) {
      if (e instanceof InputError) return fail(400, e.message);
      if (e instanceof AppError) {
        log.info(JSON.stringify({ ref, action, ok: false, status: e.status }));
        return fail(e.status, e.message);
      }
      if (e instanceof XpressbeesError) {
        log.warn(JSON.stringify({ ref, action, ok: false, xb: e.message.slice(0, 120) }));
        return fail(502, 'The shipping service is not responding right now. Try again shortly.');
      }
      if (e?.db?.hint === 'no_warehouse') return fail(409, e.db.message);
      log.error(JSON.stringify({ ref, action, ok: false, error: String(e?.message ?? e).slice(0, 120), code: e?.db?.code ?? null }));
      return fail(500, 'Something went wrong. Try again.');
    }
  };
}
