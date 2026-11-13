// Pure helpers for Delhivery: shipping modes, payloads, status mapping and history.
// Every value sent to Delhivery is built here from database rows, never from the browser.

import { clean } from './text.js';

// Delhivery has no courier list: a parcel goes by Surface or Express. The ids are what
// shipments.courier_id stores for a Delhivery parcel.
export const DELHIVERY_MODES = {
  surface: { id: 'surface', code: 'S', mode: 'Surface', name: 'Delhivery Surface' },
  express: { id: 'express', code: 'E', mode: 'Express', name: 'Delhivery Express' },
};

// Harmonised code for printed books, which Delhivery asks for on every parcel.
export const BOOKS_HSN = '4901';

// Delhivery's order API is known to choke on & # % ; and \ even when encoded: they are
// replaced, on top of the usual cleaning (control characters, angle brackets).
export const dlvText = (value, max) =>
  clean(String(value ?? '').replace(/&/g, ' and ').replace(/[#%;\\]/g, ' '), max);

const money = (v) => Math.round(Number(v) * 100) / 100;

// "YYYY-MM-DD HH:MM:SS" in India time.
export function indiaDateTime(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

// Surface and Express with their prices, cheapest first. A price Delhivery would not give
// is null (the parcel can still be booked; the admin just sees no cost).
export function delhiveryOptions(rates) {
  return Object.values(DELHIVERY_MODES)
    .map((m) => {
      const r = rates?.[m.id];
      return {
        id: m.id,
        name: m.name,
        freight_charges: r ? r.freight_charges : null,
        cod_charges: r ? r.cod_charges : null,
        total_charges: r ? r.total_charges : null,
      };
    })
    .sort((a, b) => (a.total_charges ?? Infinity) - (b.total_charges ?? Infinity) || (a.id === 'surface' ? -1 : 1));
}

// The pickup location name must reach Delhivery exactly as it is registered there
// (it is matched character for character, case included), so it is only trimmed and
// cleaned of control characters, never reworded like free text is.
export const warehouseName = (settings) => clean(settings?.delhivery_warehouse_name, 100);

// What Delhivery needs to register our pickup address as a pickup location. Returns come
// back to the same address. Its "registered name" may not contain underscores.
export function warehouseRegistration(settings) {
  return {
    name: warehouseName(settings),
    registeredName: dlvText(String(settings.pickup_name ?? '').replace(/_/g, ' '), 80),
    phone: settings.pickup_phone,
    email: clean(settings.pickup_email, 120),
    address: dlvText(settings.pickup_address, 200),
    city: dlvText(settings.pickup_city, 60),
    state: dlvText(settings.pickup_state, 60),
    pin: settings.pickup_pincode,
  };
}

function returnAddress(settings) {
  return {
    return_name: dlvText(settings.pickup_name, 80),
    return_add: dlvText(settings.pickup_address, 200),
    return_city: dlvText(settings.pickup_city, 60),
    return_state: dlvText(settings.pickup_state, 60),
    return_country: 'India',
    return_pin: settings.pickup_pincode,
    return_phone: settings.pickup_phone,
  };
}

const quantity = (items) => items.reduce((n, i) => n + Number(i.quantity), 0);
const description = (items) => dlvText(items.map((i) => `${i.title} x ${i.quantity}`).join(', '), 200) || 'Books';

// The order request for a forward parcel (warehouse -> customer).
export function delhiveryPayload({ order, items, settings }, pkg, option, now = new Date()) {
  const cod = order.payment_method === 'cod';
  return {
    shipments: [
      {
        name: dlvText(order.name, 80),
        add: dlvText(order.address, 300),
        pin: order.pincode,
        city: dlvText(order.city, 60),
        state: dlvText(order.state, 60),
        country: 'India',
        phone: order.phone,
        order: `KAK-${order.order_number}`,
        payment_mode: cod ? 'COD' : 'Prepaid',
        cod_amount: cod ? money(order.subtotal) : 0,
        total_amount: money(order.subtotal),
        order_date: indiaDateTime(now),
        products_desc: description(items),
        hsn_code: BOOKS_HSN,
        quantity: String(quantity(items)),
        weight: pkg.weight,
        shipment_length: Math.ceil(pkg.length),
        shipment_width: Math.ceil(pkg.breadth),
        shipment_height: Math.ceil(pkg.height),
        shipping_mode: (DELHIVERY_MODES[option?.id] ?? DELHIVERY_MODES.surface).mode,
        address_type: 'home',
        seller_name: dlvText(settings.pickup_name, 80),
        seller_add: dlvText(settings.pickup_address, 200),
        seller_inv: '',
        ...returnAddress(settings),
      },
    ],
    pickup_location: { name: warehouseName(settings) },
  };
}

// The return pickup request: Delhivery collects from the customer and brings it to our
// registered warehouse, whole order.
export function delhiveryReturnPayload({ order, items, settings }, pkg, now = new Date()) {
  return {
    shipments: [
      {
        name: dlvText(order.name, 80),
        add: dlvText(order.address, 300),
        pin: order.pincode,
        city: dlvText(order.city, 60),
        state: dlvText(order.state, 60),
        country: 'India',
        phone: order.phone,
        order: `KAK-${order.order_number}-R`,
        payment_mode: 'Pickup',
        total_amount: money(order.subtotal),
        order_date: indiaDateTime(now),
        products_desc: description(items),
        hsn_code: BOOKS_HSN,
        quantity: String(quantity(items)),
        weight: pkg.weight,
        shipment_length: Math.ceil(pkg.length),
        shipment_width: Math.ceil(pkg.breadth),
        shipment_height: Math.ceil(pkg.height),
        seller_name: dlvText(settings.pickup_name, 80),
        seller_add: dlvText(settings.pickup_address, 200),
        ...returnAddress(settings),
      },
    ],
    pickup_location: { name: warehouseName(settings) },
  };
}

// Status codes after a failed delivery attempt that Delhivery accepts NDR actions for.
const NDR_CODES = new Set(['EOD-74', 'EOD-15', 'EOD-104', 'EOD-43', 'EOD-86', 'EOD-11', 'EOD-16', 'EOD-69', 'EOD-6', 'EOD-3', 'ST-108']);

// Delhivery's StatusType + Status -> our parcel status (null when unknown).
//   UD forward: Manifested / Not Picked -> booked; In Transit / Pending -> in transit
//      (a failed attempt keeps "Pending" with an NDR status code -> exception);
//      Dispatched -> out for delivery.   DL: Delivered (RTO = back with us).
//   RT: returning to us.   PP / PU / CN: return pickups.
export function mapDelhiveryStatus(st) {
  const type = String(st?.StatusType ?? '').toUpperCase();
  const s = String(st?.Status ?? '').toLowerCase();
  const code = String(st?.StatusCode ?? '').toUpperCase();
  if (type === 'CN' || /cancel/.test(s)) return 'cancelled';
  if (type === 'DL') return /\brto\b/.test(s) ? 'rto' : 'delivered';
  if (type === 'RT' || /\brto\b/.test(s)) return 'rto';
  if (type === 'PP') return 'booked';
  if (type === 'PU') return 'in_transit';
  if (/manifest|not picked|open|scheduled/.test(s)) return 'booked';
  if (NDR_CODES.has(code)) return 'exception';
  if (/dispatched/.test(s)) return 'out_for_delivery';
  if (/transit|pending|picked/.test(s)) return 'in_transit';
  if (/delivered/.test(s)) return 'delivered';
  return null;
}

// Only the fields we show, trimmed, newest first, at most 50 events.
export function delhiveryHistory(scans) {
  return (Array.isArray(scans) ? scans : [])
    .map((s) => s?.ScanDetail ?? {})
    .reverse()
    .slice(0, 50)
    .map((e) => ({
      code: clean(e.StatusCode || e.ScanType, 10),
      message: clean(e.Instructions || e.Scan, 120),
      location: clean(e.ScannedLocation, 120),
      at: clean(e.ScanDateTime || e.StatusDateTime, 25),
    }))
    .filter((e) => e.message || e.code);
}

// The current status text shown to admins (e.g. "In Transit").
export const delhiveryStatusText = (st) => clean(st?.Status, 80);
