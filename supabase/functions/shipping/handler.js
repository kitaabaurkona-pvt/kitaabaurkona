// The shipping function's request handling, kept free of Deno-only code so it can be
// tested with Node. index.js wires it to Supabase.
//
// Who may do what:
//   signed-in customer  check_pincode, track (own orders only)
//   admin               the above for any order, plus rates, set_courier, set_carrier,
//                       book_now, link_awb, label, cancel_shipment, manifest,
//                       register_warehouse, pickup_request, ndr_list, ndr_action,
//                       return_pickup
//   scheduler (cron)    run_job, with the cron secret header (no user)
//
// Two carriers, two separate workflows. Every parcel says which carrier it goes with
// (shipments.carrier): new orders take the default from Admin > Shipping, and an admin
// can switch a parcel to the other carrier until it is booked. Booking, tracking,
// cancelling, labels, failed deliveries and returns then go to that carrier only.
//   Xpressbees  cheapest of its couriers, label + manifest PDFs, NDR list from Xpressbees
//   Delhivery   Surface or Express (cheapest), label on request, pickup requests, NDR
//               actions on parcels whose tracking shows a failed attempt

import { LIMITS, PIN_CHECK_PARCEL } from './config.js';
import { ADMIN_ACTIONS, CRON_ACTIONS, InputError, parseRequest } from './validate.js';
import { CARRIER_NAMES, CarrierError } from './carrier.js';
import { XpressbeesError } from './xpressbees.js';
import { DelhiveryError } from './delhivery.js';
import {
  delhiveryHistory,
  delhiveryOptions,
  delhiveryPayload,
  delhiveryReturnPayload,
  delhiveryStatusText,
  DELHIVERY_MODES,
  indiaDateTime,
  mapDelhiveryStatus,
  warehouseName,
  warehouseRegistration,
} from './delhivery-shipping.js';
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
// Couriers tried, cheapest first, when Xpressbees refuses one for a courier-specific reason.
const COURIER_TRIES = 3;
// Refusals that no other courier would get past.
const ACCOUNT_WIDE = /wallet|balance|recharge|insufficient|duplicate|already (exist|been|booked|placed|used)|unauthori[sz]ed|suspend|block|kyc|inactive account|warehouse/i;
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

// Where an admin looks a parcel up by its KAK number when a carrier answered unclearly.
const PANELS = { xpressbees: 'Xpressbees dashboard (Orders', delhivery: 'Delhivery panel (Shipments' };

export function createHandler({ db, makeXpressbees, makeDelhivery = null, cronSecret, allowedOrigins, log = console, now = () => new Date() }) {
  let xbClient = null;
  const xb = () => (xbClient ??= makeXpressbees());
  let dlClient = null;
  const dl = () => {
    if (!makeDelhivery) throw new DelhiveryError('Delhivery is not set up');
    return (dlClient ??= makeDelhivery());
  };
  // True when the Delhivery API token is set (no request is made).
  const delhiveryReady = () => {
    try {
      dl();
      return true;
    } catch {
      return false;
    }
  };

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

  // Books with the cheapest courier not on the skip list (Admin > Shipping). Only a
  // clear refusal of that courier (Xpressbees says no and why) moves on to the next
  // cheapest, up to COURIER_TRIES. Account-wide refusals (wallet balance, duplicate order
  // number, warehouse, the account itself) stop straight away. An unclear answer (an
  // error with no reason, a server error, a timeout) also stops at once and is never
  // retried by itself: Xpressbees may have booked the parcel anyway, as it did with its
  // bare 404s, and sending it again makes a second booking. A courier the admin picked is
  // the only one tried, skip list or not.
  async function bookWithCouriers(shipment, data, pkg, options) {
    const skip = new Set((data.settings?.skip_couriers ?? []).map((x) => String(x).trim().toLowerCase()));
    const skipped = (c) => skip.has(c.id) || skip.has(c.name.toLowerCase());
    const available = shipment.courier_chosen_by_admin ? [chooseCourier(options, shipment.courier_id)].filter(Boolean) : listCouriers(options);
    const candidates = shipment.courier_chosen_by_admin ? available : available.filter((c) => !skipped(c)).slice(0, COURIER_TRIES);
    if (candidates.length === 0) {
      throw new XpressbeesError(`Every courier Xpressbees offers for this parcel is on the skip list (Admin > Shipping): ${available.map((c) => c.name).join(', ')}`.slice(0, 300));
    }
    const orderNumber = `KAK-${data.order.order_number}`;
    const refusals = [];
    for (const courier of candidates) {
      try {
        const answer = await xb().book(bookingPayload(data, pkg, courier));
        if (refusals.length) {
          log.warn(JSON.stringify({ event: 'booked_with_next_courier', shipment: shipment.id, courier: courier.name, refused: refusals.map((r) => r.courier) }));
        }
        return { answer, courier, refusals };
      } catch (e) {
        if (e instanceof XpressbeesError && e.uncertain) {
          // A courier that answers a booking unclearly is not used automatically again.
          if (e.status >= 400 && e.status < 500) {
            try {
              await rpc('add_skip_courier', { p_name: courier.name });
            } catch {
              // the parcel is still marked for checking below
            }
          }
          const why = e.status ? `HTTP ${e.status}${e.reason ? `: ${e.reason}` : ', no reason given'}` : e.message;
          throw Object.assign(
            new XpressbeesError(
              `Xpressbees answered unclearly (${why}) when booking ${orderNumber} with ${courier.name}, so it may have booked it anyway. Check the Xpressbees dashboard (Orders, search ${orderNumber}): link its AWB here if it is booked, or retry once you are sure it is not.`.slice(0, 300),
              { status: e.status, reason: e.reason, uncertain: true },
            ),
            { refusals },
          );
        }
        if (!(e instanceof XpressbeesError) || e.retryable || ACCOUNT_WIDE.test(`${e.reason} ${e.message}`)) throw e;
        refusals.push({ courier: courier.name, status: e.status, reason: e.reason || 'Xpressbees gave no reason' });
      }
    }
    // Every courier tried was refused: one message naming each, shortest wording first.
    const same = new Set(refusals.map((r) => `${r.status}|${r.reason}`)).size === 1;
    const code = (r) => (r.status && r.status !== 200 ? `HTTP ${r.status}, ` : '');
    const message = same
      ? `Booking refused (${code(refusals[0])}${refusals.map((r) => r.courier).join(', ')}): ${refusals[0].reason}`
      : `Booking refused: ${refusals.map((r) => `${r.courier} (${code(r)}${r.reason})`).join(' · ')}`;
    throw new XpressbeesError(message.slice(0, 300), { status: refusals[0]?.status ?? 0, reason: refusals[0]?.reason ?? '' });
  }

  // Delhivery prices for Surface and Express, cheapest first. A price it will not give is
  // left empty rather than stopping the booking.
  async function delhiveryRates(data, pkg) {
    const cod = data.order.payment_method === 'cod';
    const rates = {};
    for (const m of Object.values(DELHIVERY_MODES)) {
      try {
        rates[m.id] = await dl().rate({ mode: m.code, origin: data.settings.pickup_pincode, destination: data.order.pincode, grams: pkg.weight, cod, amount: data.order.subtotal });
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e;
      }
    }
    return delhiveryOptions(rates);
  }

  // Can Delhivery take this parcel (PIN code served for this way of paying)?
  async function delhiveryServes(data) {
    const pin = await dl().pincode(data.order.pincode);
    return data.order.payment_method === 'cod' ? pin.cod : pin.prepaid;
  }

  // Books a Delhivery parcel: Surface or Express (the admin's pick, else the cheapest).
  // Delhivery refuses a second booking of the same order number ("Duplicate order id"),
  // and that refusal, like any unclear answer, holds the parcel for a check.
  async function bookWithDelhivery(shipment, data, pkg) {
    const options = await delhiveryRates(data, pkg);
    const option = (shipment.courier_chosen_by_admin && options.find((o) => o.id === shipment.courier_id)) || options[0];
    const orderNumber = `KAK-${data.order.order_number}`;
    try {
      const answer = await dl().book(delhiveryPayload(data, pkg, option, now()));
      return { answer, option };
    } catch (e) {
      if (e instanceof CarrierError && e.uncertain) {
        const why = e.duplicate
          ? `Delhivery says ${orderNumber} already exists`
          : `Delhivery answered unclearly (${e.status ? `HTTP ${e.status}${e.reason ? `: ${e.reason}` : ', no reason given'}` : e.message}) when booking ${orderNumber}, so it may have booked it anyway`;
        throw new DelhiveryError(
          `${why}. Check the ${PANELS.delhivery}, search ${orderNumber}): link its AWB here if it is booked, or retry once you are sure it is not.`.slice(0, 300),
          { status: e.status, reason: e.reason, uncertain: true },
        );
      }
      throw e;
    }
  }

  // What is saved for a Delhivery booking (the label is made on request, not stored).
  function delhiveryRecord(answer, pkg, option) {
    const awbNumber = String(answer?.waybill ?? '');
    if (!/^[0-9A-Za-z]{6,30}$/.test(awbNumber)) return null;
    return {
      awb_number: awbNumber,
      xb_order_id: answer?.refnum ? clean(answer.refnum, 40) : null,
      xb_shipment_id: null,
      xb_status: clean(answer?.status, 80) || 'Manifested',
      courier_id: option?.id ?? null,
      courier_name: option?.name ?? 'Delhivery',
      freight_charges: option?.freight_charges ?? null,
      cod_charges: option?.cod_charges ?? null,
      total_charges: option?.total_charges ?? null,
      label_url: null,
      manifest_url: null,
      package_weight_g: pkg.weight,
      package_length_cm: pkg.length,
      package_breadth_cm: pkg.breadth,
      package_height_cm: pkg.height,
    };
  }

  // Saves a booking, then cancels it at once if the customer cancelled while it was in
  // flight (the background job would otherwise do it on its next run).
  async function saveBooking(shipment, record, actor) {
    try {
      await rpc('record_booking', { p_shipment: shipment.id, p: { ...record, actor } });
    } catch (e) {
      // Booked with the carrier but not saved: keep the AWB in the logs so it can be recovered.
      log.error(JSON.stringify({ event: 'booked_not_saved', shipment: shipment.id, carrier: shipment.carrier, awb: record.awb_number }));
      throw e;
    }
    const now_ = (await select(db.from('shipments').select('*').eq('id', shipment.id).limit(1)))[0];
    if (now_?.status === 'cancel_requested') {
      try {
        await cancelWithCarrier(now_, actor);
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e;
      }
    }
    return { ok: true, awb: record.awb_number };
  }

  async function bookOne(shipment, actor = null) {
    const carrier = shipment.carrier === 'delhivery' ? 'delhivery' : 'xpressbees';
    try {
      const data = await rpc('shipment_booking_data', { p_shipment: shipment.id });
      if (!data || !['confirmed', 'paid'].includes(data.order.status)) {
        await rpc('record_cancelled', { p_shipment: shipment.id, p_actor: actor, p_detail: 'Order is no longer active' });
        return { ok: false, reason: 'order_inactive' };
      }
      const pkg = buildPackage(data.items);
      if (carrier === 'delhivery') {
        if (!(await delhiveryServes(data))) {
          await rpc('record_booking_failure', {
            p_shipment: shipment.id,
            p_error: `Delhivery does not deliver ${data.order.payment_method === 'cod' ? 'cash on delivery ' : ''}to PIN ${data.order.pincode}; switch this parcel to Xpressbees`,
            p_retry: false,
            p_actor: actor,
          });
          return { ok: false, reason: 'not_serviceable' };
        }
        const { answer, option } = await bookWithDelhivery(shipment, data, pkg);
        const record = delhiveryRecord(answer, pkg, option);
        if (!record) {
          await rpc('record_booking_failure', {
            p_shipment: shipment.id,
            p_error: `Delhivery accepted KAK-${data.order.order_number} but sent no AWB number. Check the Delhivery panel and link its AWB here.`,
            p_retry: false,
            p_actor: actor,
            p_needs_check: true,
          });
          return { ok: false, reason: 'bad_answer' };
        }
        return await saveBooking(shipment, record, actor);
      }
      const options = await xb().serviceability({
        origin: data.settings.pickup_pincode,
        destination: data.order.pincode,
        payment_type: data.order.payment_method === 'cod' ? 'cod' : 'prepaid',
        order_amount: data.order.subtotal,
        ...pkg,
      });
      if (!chooseCourier(options, shipment.courier_chosen_by_admin ? shipment.courier_id : null)) {
        await rpc('record_booking_failure', {
          p_shipment: shipment.id,
          p_error: shipment.courier_chosen_by_admin
            ? `The courier chosen for this parcel no longer delivers to PIN ${data.order.pincode}; choose another`
            : `No Xpressbees courier delivers this parcel to PIN ${data.order.pincode}${delhiveryReady() ? '; switch it to Delhivery' : ''}`,
          p_retry: false,
          p_actor: actor,
        });
        return { ok: false, reason: 'not_serviceable' };
      }
      const { answer, courier, refusals } = await bookWithCouriers(shipment, data, pkg, options);
      for (const r of refusals) {
        await rpc('log_shipment_event', {
          p_shipment: shipment.id,
          p_order: shipment.order_id,
          p_actor: actor,
          p_action: 'courier_refused',
          p_detail: `${r.courier}: ${r.status && r.status !== 200 ? `HTTP ${r.status}, ` : ''}${r.reason}`.slice(0, 300),
        });
      }
      const record = bookingRecord(answer, pkg, courier);
      if (!record) {
        // Xpressbees said yes but gave no AWB: it may well be booked, so it is checked, not resent.
        await rpc('record_booking_failure', {
          p_shipment: shipment.id,
          p_error: `Xpressbees accepted KAK-${data.order.order_number} but sent no AWB number. Check the Xpressbees dashboard and link its AWB here.`,
          p_retry: false,
          p_actor: actor,
          p_needs_check: true,
        });
        return { ok: false, reason: 'bad_answer' };
      }
      // Label and manifest links are kept only from Xpressbees' file host. When one is set
      // aside (or missing), say so, with the host only, so the allowed host can be checked.
      for (const [field, kept] of [['label', record.label_url], ['manifest', record.manifest_url]]) {
        if (kept) continue;
        const value = answer?.[field];
        let host = null;
        try {
          host = typeof value === 'string' && value ? new URL(value).host : null;
        } catch {
          host = 'not a link';
        }
        log.warn(JSON.stringify({ event: host ? 'file_link_set_aside' : 'file_link_missing', shipment: shipment.id, field, host }));
      }
      return await saveBooking(shipment, record, actor);
    } catch (e) {
      const message = e instanceof CarrierError ? e.message : 'Internal error while booking';
      const uncertain = e instanceof CarrierError && e.uncertain;
      if (!(e instanceof CarrierError)) log.error(JSON.stringify({ event: 'book_error', shipment: shipment.id, error: String(e.message).slice(0, 120) }));
      if (uncertain) log.warn(JSON.stringify({ event: 'booking_uncertain', shipment: shipment.id, status: e.status }));
      for (const r of e?.refusals ?? []) {
        try {
          await rpc('log_shipment_event', { p_shipment: shipment.id, p_order: shipment.order_id, p_actor: actor, p_action: 'courier_refused', p_detail: `${r.courier}: ${r.status && r.status !== 200 ? `HTTP ${r.status}, ` : ''}${r.reason}`.slice(0, 300) });
        } catch {
          // the failure itself is still recorded below
        }
      }
      try {
        await rpc('record_booking_failure', {
          p_shipment: shipment.id,
          p_error: message,
          p_retry: uncertain ? false : e instanceof CarrierError ? e.retryable : true,
          p_actor: actor,
          p_needs_check: uncertain,
        });
      } catch {
        // the stuck "booking" row is picked up again after 15 minutes
      }
      return { ok: false, reason: uncertain ? 'uncertain' : 'error', message };
    }
  }

  async function refreshTracking(shipment) {
    if (shipment.carrier === 'delhivery') {
      const found = await dl().track(shipment.awb_number);
      // Nothing at Delhivery yet (just booked): nothing to change.
      if (!found) return shipment.status;
      const next = mapDelhiveryStatus(found.Status) ?? (RECORDABLE.includes(shipment.status) ? shipment.status : null);
      if (!next) return shipment.status;
      await rpc('record_tracking', {
        p_shipment: shipment.id,
        p_status: next,
        p_xb_status: delhiveryStatusText(found.Status),
        p_history: delhiveryHistory(found.Scans),
      });
      return next;
    }
    const data = await xb().track(shipment.awb_number);
    // No tracking events yet (just booked): nothing to change.
    if (!data) return shipment.status;
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

  async function cancelWithCarrier(shipment, actor = null) {
    if (!shipment.awb_number) {
      await rpc('record_cancelled', { p_shipment: shipment.id, p_actor: actor, p_detail: 'Not booked yet' });
      return true;
    }
    try {
      await (shipment.carrier === 'delhivery' ? dl() : xb()).cancel(shipment.awb_number);
    } catch (e) {
      if (!(e instanceof CarrierError) || !/already cancel/i.test(e.message)) throw e;
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
      // Deliverable when either carrier serves the PIN code. Delhivery counts once its
      // warehouse name and API token are set; one Delhivery call answers both ways of paying,
      // and Xpressbees is asked only when Delhivery says no. A "no" is trusted only when
      // every carrier asked could answer; otherwise the customer sees a plain error.
      if (missing.length) {
        const st = await settings();
        const useDelhivery = Boolean(st.delhivery_warehouse_name) && delhiveryReady();
        let dlPin = null;
        let dlError = null;
        if (useDelhivery) {
          try {
            dlPin = await dl().pincode(pincode);
          } catch (e) {
            if (!(e instanceof CarrierError)) throw e;
            dlError = e;
          }
        }
        for (const type of missing) {
          let ok = Boolean(dlPin?.[type]);
          if (!ok) {
            try {
              const options = await xb().serviceability({ origin: st.pickup_pincode, destination: pincode, payment_type: type, ...PIN_CHECK_PARCEL });
              ok = chooseCourier(options) !== null;
            } catch (e) {
              if (!(e instanceof CarrierError)) throw e;
              throw dlError ?? e;
            }
            if (!ok && dlError) throw dlError;
          }
          cached[type] = ok;
          await rpc('save_pincode_check', { p_pincode: pincode, p_payment_type: type, p_serviceable: ok });
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
            if (!(e instanceof CarrierError)) throw e;
          }
        }
      }
      const fresh = await select(
        db.from('shipments').select('kind, status, awb_number, courier_name, history, last_tracked_at, updated_at').eq('order_id', order_id).order('created_at'),
      );
      return { shipments: fresh };
    },

    // The couriers an admin can choose for a parcel not booked yet: Xpressbees' couriers,
    // or Delhivery Surface / Express, cheapest first, with prices.
    async rates({ order_id }) {
      const s = await forwardShipment(order_id);
      if (!s) throw new AppError(404, 'This order has no parcel');
      const data = await rpc('shipment_booking_data', { p_shipment: s.id });
      const pkg = buildPackage(data.items);
      const chosen = s.courier_chosen_by_admin ? s.courier_id : null;
      if (s.carrier === 'delhivery') {
        if (!(await delhiveryServes(data))) throw new AppError(409, `Delhivery does not deliver this parcel to PIN ${data.order.pincode}; switch it to Xpressbees`);
        return { carrier: 'delhivery', couriers: await delhiveryRates(data, pkg), chosen, package: pkg };
      }
      const options = await xb().serviceability({
        origin: data.settings.pickup_pincode,
        destination: data.order.pincode,
        payment_type: data.order.payment_method === 'cod' ? 'cod' : 'prepaid',
        order_amount: data.order.subtotal,
        ...pkg,
      });
      return { carrier: 'xpressbees', couriers: listCouriers(options), chosen, package: pkg };
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

    // The admin decides which carrier ships a parcel, any time before it is booked.
    // After an unclear answer the first carrier may have booked it already: switching
    // then needs the admin to confirm they checked that carrier's panel.
    async set_carrier({ order_id, carrier, checked }, { user }) {
      const s = await forwardShipment(order_id);
      if (!s || !['queued', 'failed'].includes(s.status)) throw new AppError(409, 'The carrier can only be changed before booking');
      if (s.carrier === carrier) return { carrier };
      if (s.needs_check && !checked) {
        throw new AppError(409, `${CARRIER_NAMES[s.carrier]} may already have booked this order. Check the ${PANELS[s.carrier]}) first, then confirm.`);
      }
      if (carrier === 'delhivery' && !delhiveryReady()) throw new AppError(409, 'Delhivery is not set up yet (its API token secret is missing)');
      await rpc('set_shipment_carrier', { p_shipment: s.id, p_carrier: carrier, p_actor: user.id });
      return { carrier };
    },

    async book_now({ order_id, checked }, { user }) {
      const s = await forwardShipment(order_id);
      if (!s) throw new AppError(404, 'This order has no parcel');
      // After an unclear answer the parcel may already be booked with the carrier: book
      // again only once the admin confirms they checked its panel.
      if (s.needs_check && !checked) {
        const name = CARRIER_NAMES[s.carrier] ?? 'The carrier';
        throw new AppError(409, `${name} may already have booked this order. Check the ${PANELS[s.carrier] ?? 'carrier panel ('}) first, then confirm.`);
      }
      const claimed = await rpc('claim_shipment', { p_shipment: s.id });
      if (!Array.isArray(claimed) || claimed.length === 0) throw new AppError(409, 'This parcel is already booked or being booked');
      const result = await bookOne(claimed[0], user.id);
      if (!result.ok) throw new AppError(502, result.message ?? 'Booking failed. See the parcel for details.');
      return { awb_number: result.awb };
    },

    // An admin found the parcel booked in the carrier's panel (after an unclear answer)
    // and links its AWB, so tracking, cancelling and labels work from here.
    async link_awb({ order_id, awb }, { user }) {
      const s = await forwardShipment(order_id);
      if (!s || !['queued', 'failed'].includes(s.status)) throw new AppError(409, 'Only a parcel that is not booked yet can be linked to an AWB');
      const taken = (await select(db.from('shipments').select('id').eq('awb_number', awb).limit(1)))[0];
      if (taken) throw new AppError(409, 'That AWB already belongs to another parcel');
      const delhivery = s.carrier === 'delhivery';
      let tracked = null;
      try {
        tracked = await (delhivery ? dl() : xb()).track(awb);
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e;
      }
      const claimed = await rpc('claim_shipment', { p_shipment: s.id });
      if (!Array.isArray(claimed) || claimed.length === 0) throw new AppError(409, 'This parcel is already being booked');
      const data = await rpc('shipment_booking_data', { p_shipment: s.id });
      const pkg = buildPackage(data.items);
      const record = delhivery
        ? delhiveryRecord({ waybill: awb, status: delhiveryStatusText(tracked?.Status) || 'Manifested' }, pkg, DELHIVERY_MODES[s.courier_id] ?? null)
        : bookingRecord({ awb_number: awb, status: tracked?.status ?? 'booked' }, pkg, null);
      await rpc('record_booking', { p_shipment: s.id, p: { ...record, courier_name: s.courier_name ?? record.courier_name, actor: user.id } });
      await rpc('log_shipment_event', {
        p_shipment: s.id,
        p_order: s.order_id,
        p_actor: user.id,
        p_action: 'awb_linked',
        p_detail: `AWB ${awb} linked from the ${delhivery ? 'Delhivery panel' : 'Xpressbees dashboard'}`,
      });
      return { awb_number: awb };
    },

    // The label PDF: Xpressbees' is saved at booking; Delhivery's is made on request.
    async label({ order_id, kind }) {
      const s = (await select(db.from('shipments').select('*').eq('order_id', order_id).eq('kind', kind).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1)))[0];
      if (!s?.awb_number) throw new AppError(404, 'This parcel is not booked yet');
      if (s.carrier !== 'delhivery') {
        if (!fileUrl(s.label_url)) throw new AppError(404, 'Xpressbees sent no label for this parcel');
        return { url: s.label_url };
      }
      try {
        return { url: await dl().label(s.awb_number) };
      } catch (e) {
        if (e instanceof CarrierError) throw new AppError(502, e.message);
        throw e;
      }
    },

    async cancel_shipment({ order_id }, { user }) {
      const s = (await select(db.from('shipments').select('*').eq('order_id', order_id).eq('kind', 'forward').eq('status', 'cancel_requested').limit(1)))[0];
      if (!s) throw new AppError(409, 'Only parcels of cancelled orders are cancelled here');
      await cancelWithCarrier(s, user.id);
      return { cancelled: true };
    },

    // Xpressbees pickup manifest (PDF) for chosen orders. Delhivery has none: its parcels
    // are collected through a pickup request (pickup_request).
    async manifest({ order_ids }) {
      const rows = await select(
        db.from('shipments').select('awb_number, status').in('order_id', order_ids).eq('kind', 'forward').eq('carrier', 'xpressbees').in('status', ['booked', 'in_transit']),
      );
      const awbs = rows.map((r) => r.awb_number).filter(Boolean);
      if (awbs.length === 0) throw new AppError(400, 'None of those orders has a booked Xpressbees parcel');
      const url = fileUrl(await xb().manifest(awbs));
      if (!url) throw new AppError(502, 'Xpressbees did not return a manifest link');
      return { url, count: awbs.length };
    },

    // Registers our pickup address with Delhivery under the warehouse name saved in
    // Admin > Shipping, so bookings and pickup requests with that name are accepted.
    // Delhivery only takes orders for pickup locations registered on the account.
    async register_warehouse(_input, { user }) {
      const st = await settings();
      const reg = warehouseRegistration(st);
      if (!reg.name) throw new AppError(409, 'Type the Delhivery warehouse name in Admin > Shipping and save it first');
      if (!reg.email) throw new AppError(409, 'Add a contact email in Admin > Shipping first (Delhivery asks for one)');
      let result;
      try {
        result = await dl().registerWarehouse(reg);
      } catch (e) {
        if (e instanceof CarrierError) throw new AppError(502, e.message);
        throw e;
      }
      await rpc('log_shipment_event', {
        p_shipment: null,
        p_order: null,
        p_actor: user.id,
        p_action: 'warehouse_registered',
        p_detail: result.created ? `Delhivery pickup location "${reg.name}" registered` : `Delhivery already has the pickup location "${reg.name}"`,
      });
      return { name: reg.name, created: result.created };
    },

    // Asks Delhivery to collect parcels from our registered warehouse.
    async pickup_request({ date, time, count }, { user }) {
      const st = await settings();
      if (!st.delhivery_warehouse_name) throw new AppError(409, 'Set the Delhivery warehouse name in Admin > Shipping first');
      let answer;
      try {
        answer = await dl().pickup({ date, time, location: warehouseName(st), count });
      } catch (e) {
        if (e instanceof CarrierError) throw new AppError(502, e.message);
        throw e;
      }
      await rpc('log_shipment_event', {
        p_shipment: null,
        p_order: null,
        p_actor: user.id,
        p_action: 'pickup_requested',
        p_detail: `Delhivery pickup ${answer.pickup_id} on ${date} at ${time} for ${count} parcel${count === 1 ? '' : 's'}`,
      });
      return { pickup_id: answer.pickup_id, date, time, count };
    },

    // Failed delivery attempts on both carriers. Xpressbees lists its own; for Delhivery
    // they are our parcels whose latest tracking shows a failed attempt. A carrier that
    // cannot be reached is named in `unavailable` instead of hiding the other's list.
    async ndr_list() {
      const items = [];
      const unavailable = [];
      let list = [];
      try {
        list = await xb().ndrList();
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e;
        unavailable.push('Xpressbees');
      }
      const awbs = list.map((r) => String(r?.awb_number ?? '')).filter((a) => /^[0-9A-Za-z]{6,30}$/.test(a));
      const ours = awbs.length ? await select(db.from('shipments').select('order_id, awb_number, status').eq('carrier', 'xpressbees').in('awb_number', awbs)) : [];
      const dlRows = await select(db.from('shipments').select('order_id, awb_number, status, history, updated_at').eq('carrier', 'delhivery').eq('kind', 'forward').eq('status', 'exception').limit(100));
      const orderIds = [...new Set([...ours, ...dlRows].map((s) => s.order_id))];
      const orders = orderIds.length ? await select(db.from('orders').select('id, order_number, shipping_name').in('id', orderIds)) : [];
      const byAwb = new Map(ours.map((s) => [s.awb_number, s]));
      const byOrder = new Map(orders.map((o) => [o.id, o]));
      for (const r of list.filter((x) => byAwb.has(String(x?.awb_number)))) {
        const s = byAwb.get(String(r.awb_number));
        const o = byOrder.get(s.order_id);
        items.push({
          carrier: 'xpressbees',
          awb: s.awb_number,
          order_id: s.order_id,
          order_number: o?.order_number ?? null,
          customer: clean(o?.shipping_name, 80),
          date: clean(r.event_date, 20),
          remarks: clean(r.courier_remarks, 160),
          attempts: Number.parseInt(r.total_attempts, 10) || 0,
        });
      }
      for (const s of dlRows) {
        const o = byOrder.get(s.order_id);
        const latest = Array.isArray(s.history) ? s.history[0] : null;
        items.push({
          carrier: 'delhivery',
          awb: s.awb_number,
          order_id: s.order_id,
          order_number: o?.order_number ?? null,
          customer: clean(o?.shipping_name, 80),
          date: clean(latest?.at ?? s.updated_at, 20),
          remarks: clean(latest?.message, 160),
          attempts: null,
        });
      }
      return { items, unavailable };
    },

    // Re-attempt (on a date), new address or new phone for failed deliveries, each sent
    // to the parcel's own carrier. Delhivery takes these asynchronously: "sent" means it
    // accepted the request.
    async ndr_action({ items }, { user }) {
      const ours = await select(db.from('shipments').select('id, order_id, awb_number, carrier').in('awb_number', items.map((i) => i.awb)));
      if (ours.length !== items.length) throw new AppError(400, 'Some of those parcels are not ours');
      const byAwb = new Map(ours.map((s) => [s.awb_number, s]));
      const xbItems = items.filter((i) => byAwb.get(i.awb).carrier !== 'delhivery');
      const dlItems = items.filter((i) => byAwb.get(i.awb).carrier === 'delhivery');
      const results = xbItems.length ? await xb().ndrCreate(xbItems) : [];
      if (dlItems.length) {
        const today = indiaDateTime(now()).slice(0, 10);
        const data = dlItems.map((i) => {
          if (i.action === 're-attempt') {
            return i.action_data.re_attempt_date > today
              ? { waybill: i.awb, act: 'DEFER_DLV', action_data: { deferred_date: i.action_data.re_attempt_date } }
              : { waybill: i.awb, act: 'RE-ATTEMPT' };
          }
          if (i.action === 'change_address') {
            return { waybill: i.awb, act: 'EDIT_DETAILS', action_data: { name: i.action_data.name, add: [i.action_data.address_1, i.action_data.address_2].filter(Boolean).join(', ') } };
          }
          return { waybill: i.awb, act: 'EDIT_DETAILS', action_data: { phone: i.action_data.phone } };
        });
        try {
          const { request_id } = await dl().ndr(data);
          for (const i of dlItems) results.push({ awb: i.awb, ok: true, message: `Sent to Delhivery (request ${request_id})` });
        } catch (e) {
          if (!(e instanceof CarrierError)) throw e;
          for (const i of dlItems) results.push({ awb: i.awb, ok: false, message: e.message });
        }
      }
      for (const r of results) {
        const s = byAwb.get(r.awb);
        if (s) await rpc('log_shipment_event', { p_shipment: s.id, p_order: s.order_id, p_actor: user.id, p_action: r.ok ? 'ndr_submitted' : 'ndr_refused', p_detail: r.message });
      }
      return { results: results.filter((r) => byAwb.has(r.awb)) };
    },

    // A return pickup goes with the carrier that delivered the order.
    async return_pickup({ order_id }, { user }) {
      const forward = (await select(db.from('shipments').select('carrier').eq('order_id', order_id).eq('kind', 'forward').neq('status', 'cancelled').limit(1)))[0];
      const carrier = forward?.carrier === 'delhivery' ? 'delhivery' : 'xpressbees';
      const id = await rpc('create_return_shipment', { p_order: order_id, p_actor: user.id, p_carrier: carrier });
      try {
        const data = await rpc('shipment_booking_data', { p_shipment: id });
        const pkg = buildPackage(data.items);
        let record;
        if (carrier === 'delhivery') {
          if (!data.settings.delhivery_warehouse_name) throw new DelhiveryError('Set the Delhivery warehouse name in Admin > Shipping first');
          let answer;
          try {
            answer = await dl().book(delhiveryReturnPayload(data, pkg, now()));
          } catch (e) {
            if (e instanceof CarrierError && e.uncertain) {
              e.message = `${e.message}. Delhivery may have booked it anyway: check the Delhivery panel for KAK-${data.order.order_number}-R before asking again.`.slice(0, 300);
            }
            throw e;
          }
          record = delhiveryRecord(answer, pkg, { id: 'surface', name: 'Delhivery Reverse' });
          if (record) Object.assign(record, { freight_charges: null, cod_charges: null, total_charges: null });
          if (!record) throw new DelhiveryError('Delhivery answered without an AWB number');
        } else {
          const answer = await xb().bookReturn(returnPayload(data, pkg));
          record = bookingRecord(answer, pkg, null);
          if (!record) throw new XpressbeesError('Xpressbees answered without an AWB number');
        }
        await rpc('record_booking', { p_shipment: id, p: { ...record, actor: user.id } });
        return { awb_number: record.awb_number };
      } catch (e) {
        // Leave nothing half-made: the return can simply be requested again.
        await rpc('record_cancelled', { p_shipment: id, p_actor: user.id, p_detail: e instanceof CarrierError ? e.message : 'Internal error' });
        if (e instanceof CarrierError) throw new AppError(502, e.message);
        throw e;
      }
    },

    async run_job({ job }) {
      // Connection check for both carriers. Free, books nothing: Xpressbees logs in (if
      // needed) and lists couriers; Delhivery looks up our pickup PIN code.
      if (job === 'health') {
        const out = { connected: false, couriers: 0, delhivery: { configured: delhiveryReady(), connected: false } };
        try {
          out.couriers = (await xb().couriers()).length;
          out.connected = true;
        } catch (e) {
          if (!(e instanceof CarrierError)) throw e;
          out.error = e.message;
        }
        if (out.delhivery.configured) {
          try {
            const st = await settings();
            const pin = await dl().pincode(st.pickup_pincode);
            out.delhivery = { configured: true, connected: true, pickup_served: pin.pickup, warehouse_set: Boolean(st.delhivery_warehouse_name) };
          } catch (e) {
            if (!(e instanceof CarrierError)) throw e;
            out.delhivery.error = e.message;
          }
        }
        return out;
      }
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
            if (await cancelWithCarrier(s)) done += 1;
          } catch (e) {
            if (!(e instanceof CarrierError)) throw e;
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
          if (!(e instanceof CarrierError)) throw e;
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
        // cronSecret is the value itself or an async getter (read from Vault on the server).
        let expected = '';
        try {
          expected = typeof cronSecret === 'function' ? await cronSecret() : cronSecret;
        } catch {
          expected = '';
        }
        if (!(await sameSecret(req.headers.get('x-cron-secret'), expected))) return fail(401, 'Not allowed');
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
      if (e instanceof CarrierError) {
        log.warn(JSON.stringify({ ref, action, ok: false, carrier: e.message.slice(0, 120) }));
        return fail(502, 'The shipping service is not responding right now. Try again shortly.');
      }
      if (e?.db?.hint === 'no_warehouse') return fail(409, e.db.message);
      log.error(JSON.stringify({ ref, action, ok: false, error: String(e?.message ?? e).slice(0, 120), code: e?.db?.code ?? null }));
      return fail(500, 'Something went wrong. Try again.');
    }
  };
}
