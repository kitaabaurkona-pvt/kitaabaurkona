// Pure helpers: parcel size, courier choice, status mapping and request payloads. Every
// value sent to Xpressbees is built here from database rows, never from the browser.

import { FILE_URL } from './config.js';
import { clean } from './text.js';

const DEFAULT_BOOK = { weight_kg: 0.4, length_cm: 22, breadth_cm: 15, height_cm: 3 };
const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

// Books stack: the parcel is as long and wide as the largest book and as tall as the
// pile, plus 2 cm of packing each way. Weight adds 10% for packing (at least 100 g).
export function buildPackage(items) {
  let weightKg = 0;
  let length = 0;
  let breadth = 0;
  let height = 0;
  for (const item of items) {
    const qty = Math.max(1, Math.trunc(num(item.quantity, 1)));
    weightKg += num(item.weight_kg, DEFAULT_BOOK.weight_kg) * qty;
    length = Math.max(length, num(item.length_cm, DEFAULT_BOOK.length_cm));
    breadth = Math.max(breadth, num(item.breadth_cm, DEFAULT_BOOK.breadth_cm));
    height += num(item.height_cm, DEFAULT_BOOK.height_cm) * qty;
  }
  const grams = Math.ceil(Math.max(weightKg * 1000 * 1.1, weightKg * 1000 + 100));
  const round = (v) => Math.ceil(v * 10) / 10;
  return {
    weight: Math.min(grams, 100000),
    length: round(Math.min(length + 2, 150)),
    breadth: round(Math.min(breadth + 2, 150)),
    height: round(Math.min(height + 2, 150)),
  };
}

// Cheapest courier from a serviceability answer. Reverse-only couriers are skipped.
export function chooseCourier(options, preferredId = null) {
  const usable = (Array.isArray(options) ? options : [])
    .filter((o) => o && /^[0-9]{1,10}$/.test(String(o.id)) && !/reverse/i.test(String(o.name)))
    .map((o) => ({
      id: String(o.id),
      name: String(o.name ?? '').slice(0, 100),
      freight_charges: Number(o.freight_charges) || 0,
      cod_charges: Number(o.cod_charges) || 0,
      total_charges: Number(o.total_charges) || 0,
    }))
    .sort((a, b) => a.total_charges - b.total_charges || a.id.localeCompare(b.id));
  if (preferredId) return usable.find((o) => o.id === preferredId) ?? null;
  return usable[0] ?? null;
}

// Every usable courier, cheapest first (for the admin's "Change courier" list).
export const listCouriers = (options) =>
  (Array.isArray(options) ? options : [])
    .map((o) => chooseCourier([o]))
    .filter(Boolean)
    .sort((a, b) => a.total_charges - b.total_charges || a.id.localeCompare(b.id));

// Xpressbees' wording -> our parcel status.
export function mapStatus(xbStatus) {
  const s = String(xbStatus ?? '').toLowerCase();
  if (/\brto\b|return(ed)? to origin/.test(s)) return 'rto';
  if (/cancel/.test(s)) return 'cancelled';
  if (/out for delivery/.test(s)) return 'out_for_delivery';
  if (/\bdelivered\b/.test(s) && !/undelivered|not delivered/.test(s)) return 'delivered';
  if (/exception|undelivered|not delivered|ndr|lost|damage|refused|failed/.test(s)) return 'exception';
  if (/transit|picked|shipped|dispatched|reached|connected|arrived/.test(s)) return 'in_transit';
  if (/pending|booked|manifest|pickup|data received|not picked/.test(s)) return 'booked';
  return null;
}


// Only the fields we show, trimmed, newest first, at most 50 events.
export function cleanHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(0, 50)
    .map((e) => ({
      code: clean(e?.status_code, 10),
      message: clean(e?.message, 120),
      location: clean(e?.location, 120),
      at: clean(e?.event_time, 25),
    }))
    .filter((e) => e.message || e.code);
}

export const fileUrl = (v) => (typeof v === 'string' && FILE_URL.test(v) ? v : null);

const money = (v) => Math.round(Number(v) * 100) / 100;

// The booking request for a forward parcel.
export function bookingPayload({ order, items, settings }, pkg, courier) {
  const cod = order.payment_method === 'cod';
  const address = clean(order.address, 300);
  return {
    order_number: `KAK-${order.order_number}`,
    unique_order_number: 'yes',
    shipping_charges: 0,
    discount: 0,
    cod_charges: 0,
    payment_type: cod ? 'cod' : 'prepaid',
    order_amount: money(order.subtotal),
    package_weight: pkg.weight,
    package_length: pkg.length,
    package_breadth: pkg.breadth,
    package_height: pkg.height,
    request_auto_pickup: 'yes',
    consignee: {
      name: clean(order.name, 80),
      address: address.slice(0, 150),
      address_2: address.slice(150, 300),
      city: clean(order.city, 60),
      state: clean(order.state, 60),
      pincode: order.pincode,
      phone: order.phone,
    },
    pickup: pickupBlock(settings),
    is_rto_different: 'no',
    order_items: items.map((i) => ({
      name: clean(i.title, 120),
      qty: String(i.quantity),
      price: String(money(i.unit_price)),
      sku: clean(i.sku, 60),
    })),
    courier_id: courier.id,
    collectable_amount: cod ? String(money(order.subtotal)) : '0',
  };
}

export function pickupBlock(settings) {
  return {
    warehouse_name: clean(settings.warehouse_name, 100),
    name: clean(settings.pickup_name, 80),
    address: clean(settings.pickup_address, 200),
    address_2: '',
    city: clean(settings.pickup_city, 60),
    state: clean(settings.pickup_state, 60),
    pincode: settings.pickup_pincode,
    phone: settings.pickup_phone,
  };
}

// The return pickup request: from the customer back to our warehouse, whole order.
export function returnPayload({ order, items, settings }, pkg) {
  const address = clean(order.address, 300);
  return {
    order_id: `KAK-${order.order_number}-R`,
    request_auto_pickup: 'yes',
    consignee: {
      name: clean(order.name, 80),
      address: address.slice(0, 150),
      address_2: address.slice(150, 300),
      city: clean(order.city, 60),
      state: clean(order.state, 60),
      pincode: order.pincode,
      phone: order.phone,
      alternate_phone: '',
    },
    pickup: pickupBlock(settings),
    categories: 'Books',
    product_name: clean(items.map((i) => i.title).join(', '), 200),
    product_qty: String(items.reduce((n, i) => n + Number(i.quantity), 0)),
    product_amount: String(money(order.subtotal)),
    package_weight: pkg.weight,
    package_length: String(pkg.length),
    package_breadth: String(pkg.breadth),
    package_height: String(pkg.height),
    qccheck: '0',
  };
}

// Checks a booking answer before anything is saved.
export function bookingRecord(data, pkg, courier) {
  const awbNumber = String(data?.awb_number ?? '');
  if (!/^[0-9A-Za-z]{6,30}$/.test(awbNumber)) return null;
  const id = (v) => (v === undefined || v === null ? null : clean(v, 40));
  return {
    awb_number: awbNumber,
    xb_order_id: id(data.order_id),
    xb_shipment_id: id(data.shipment_id),
    xb_status: clean(data.status, 80) || 'booked',
    courier_id: /^[0-9]{1,10}$/.test(String(data.courier_id ?? '')) ? String(data.courier_id) : courier?.id ?? null,
    courier_name: clean(data.courier_name, 100) || courier?.name || null,
    freight_charges: courier?.freight_charges ?? null,
    cod_charges: courier?.cod_charges ?? null,
    total_charges: courier?.total_charges ?? null,
    label_url: fileUrl(data.label),
    manifest_url: fileUrl(data.manifest),
    package_weight_g: pkg.weight,
    package_length_cm: pkg.length,
    package_breadth_cm: pkg.breadth,
    package_height_cm: pkg.height,
  };
}
