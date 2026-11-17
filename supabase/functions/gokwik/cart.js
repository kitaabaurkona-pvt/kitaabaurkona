// What GoKwik sends and expects back, kept free of database and network code so it can
// be tested by itself. Field names follow GoKwik's Custom Checkout API (Get Cart, Set
// Shipping Address, Set Shipping Option, Place Order).

import { PLACEHOLDER_IMAGE, SHIPPING_METHOD } from './config.js';

export class InputError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'InputError';
    this.field = field;
  }
}

// A checkout cart id: the customer's user id and which of their carts it is ("<uuid>-<n>").
export const CART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[1-9][0-9]{0,6}$/;
const PIN = /^[1-9][0-9]{5}$/;
const PHONE = /^[6-9][0-9]{9}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const money = (v) => Math.round(Number(v) * 100) / 100;

// Control characters and angle brackets become spaces, runs of spaces collapse.
export function clean(value, max) {
  return [...String(value ?? '')]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '<' || ch === '>' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cartId(value, name = 'cart_id') {
  if (typeof value !== 'string' || !CART_ID.test(value)) throw new InputError(`Invalid ${name}`);
  return value;
}

// Our order number as couriers and GoKwik know it.
export const merchantOrderId = (orderNumber) => `KAK-${orderNumber}`;

// A date in India, as YYYY-MM-DD, `days` from now.
function indiaDate(now, days) {
  return new Date(now.getTime() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);
}

// "3-7" (days) from the function's settings -> { min, max }, or null when not set.
export function parseDeliveryDays(value) {
  const m = /^\s*([0-9]{1,2})\s*-\s*([0-9]{1,2})\s*$/.exec(String(value ?? ''));
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return min >= 0 && max >= min && max <= 60 ? { min, max } : null;
}

// The cart as GoKwik's checkout shows it. `shipping` is the saved delivery address with
// its PIN check ({ deliverable, cod }), once GoKwik has sent one; `selected` adds the
// chosen delivery method (Set Shipping Option).
export function cartResponse(cart, { shipping = null, selected = false, deliveryDays = null, now = new Date() } = {}) {
  const dates = deliveryDays && shipping?.deliverable ? { min_date: indiaDate(now, deliveryDays.min), max_date: indiaDate(now, deliveryDays.max) } : null;
  const items = (cart.items ?? []).map((item) => {
    const price = money(item.unit_price);
    const details = item.author ? [{ label: 'Author', value: String(item.author) }] : [];
    const metadata = { product_details: details };
    if (dates) metadata.edd = { shipment_group: 1, default: dates };
    if (shipping && !shipping.deliverable) metadata.non_serviceable_message = "We can't deliver to this PIN code yet.";
    return {
      product_id: item.book_id,
      variant_id: item.book_id,
      sku: item.sku,
      title: item.title,
      quantity: item.quantity,
      price,
      mrp: money(item.unit_mrp),
      total: money(price * item.quantity),
      image_url: item.image_url || PLACEHOLDER_IMAGE,
      salable_qty: item.salable_qty ?? 0,
      stock_status: (item.salable_qty ?? 0) >= item.quantity ? 'in_stock' : 'out_of_stock',
      ...(shipping ? { serviceable_status: Boolean(shipping.deliverable) } : {}),
      metadata,
      metaData: details,
    };
  });
  const subtotal = money(cart.subtotal);
  const out = {
    subtotal,
    discount_total: 0,
    shipping_total: 0,
    total: subtotal,
    currency: 'INR',
    total_tax: 0,
    wallet_credit_used: 0,
    membership_discount: 0,
    cashback_amount: 0,
    items,
    discounts: [],
    order_summary_extra_fields: [],
  };
  // Payment methods are left to GoKwik's own rules, except where the courier does not
  // take cash at this PIN code: then only online payment is offered.
  if (shipping?.deliverable && !shipping.cod) {
    out.available_payment_methods = [{ id: 'prepaid', description: 'Prepaid', price: 0 }];
  }
  if (shipping) out.available_shipping_methods = shipping.deliverable ? [SHIPPING_METHOD] : [];
  if (selected) {
    out.selected_shipping_method = SHIPPING_METHOD;
    if (dates) {
      out.estimate_delivery_date = {
        message_to_be_displayed: `Estimated delivery in ${deliveryDays.min}-${deliveryDays.max} days`,
        time_delta: `${deliveryDays.min}-${deliveryDays.max}_days`,
        delivery_date: dates.max_date,
      };
    }
  }
  return out;
}

// GoKwik's address -> the order's delivery details, or an InputError naming the field.
// Long values are cut to what an order can hold; too-short or malformed ones are refused.
export function parseAddress(a) {
  if (!isObject(a)) throw new InputError('Delivery address is missing', 'shipping_address');
  const pincode = String(a.pincode ?? a.postal_code ?? '').trim();
  if (!PIN.test(pincode)) throw new InputError('Invalid PIN code', a.pincode !== undefined ? 'pincode' : 'postal_code');
  const digits = String(a.phone ?? '').replace(/\D/g, '');
  const phone = digits.length > 10 ? digits.replace(/^(91|0)/, '').slice(-10) : digits;
  if (!PHONE.test(phone)) throw new InputError('Invalid mobile number', 'phone');
  const name = clean(`${a.first_name ?? a.firstname ?? ''} ${a.last_name ?? a.lastname ?? ''}`, 80);
  if (name.length < 2) throw new InputError('Name is missing', 'first_name');
  const address = clean(a.address, 300);
  if (address.length < 5) throw new InputError('Address is too short', 'address');
  const city = clean(a.city, 60);
  if (city.length < 2) throw new InputError('City is missing', 'city');
  const state = clean(a.state, 60);
  if (state.length < 2) throw new InputError('State is missing', 'state');
  return { name, phone, address, city, state, pincode };
}

function amount(value, name) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new InputError(`Invalid ${name}`);
  return money(n);
}

const METHODS = { cod: 'cod', prepaid: 'prepaid', 'pp-cod': 'pp-cod', ppcod: 'pp-cod', pp_cod: 'pp-cod' };

// A list of discounts or charges: amounts are added up, and a short record of each is
// kept with the order.
function lines(list, labelKeys) {
  if (list === undefined || list === null) return { total: 0, kept: [] };
  if (!Array.isArray(list) || list.length > 50) throw new InputError('Invalid discounts or charges');
  let total = 0;
  const kept = list.map((entry) => {
    if (!isObject(entry)) throw new InputError('Invalid discounts or charges');
    const value = amount(entry.amount ?? 0, 'amount');
    total += value;
    const out = { amount: value };
    for (const key of labelKeys) {
      const text = clean(entry[key], 80);
      if (text) out[key] = text;
    }
    return out;
  });
  return { total: money(total), kept };
}

// The Place Order request -> what gokwik_place_order() needs. The delivery address is
// returned raw (it may be missing: the one saved on the cart is used then).
export function parsePlaceOrder(body) {
  if (!isObject(body)) throw new InputError('Invalid request');
  const pay = body.payment_details;
  if (!isObject(pay)) throw new InputError('payment_details is missing');
  const method = METHODS[String(pay.payment_method ?? '').trim().toLowerCase()];
  if (!method) throw new InputError('invalid payment_method');
  const meta = isObject(body.meta_data) ? body.meta_data : {};
  const discounts = lines(meta.discounts, ['code', 'type', 'description']);
  const charges = lines(meta.other_charges, ['charge_type', 'label', 'description']);
  const out = {
    cart: cartId(body.cart_id),
    address: body.shipping_address,
    order: {
      method,
      payment_amount: amount(pay.payment_amount, 'payment_amount'),
      discount_total: discounts.total,
      other_charges: charges.total,
      payment_id: clean(pay.payment_id, 100),
      gateway_payment_id: clean(pay.pg_payment_trnx_id, 100),
      instrument: clean(pay.payment_instrument, 40),
      gokwik_order_id: clean(meta.gokwik_order_id, 100),
      rto_risk: clean(meta.rto_risk_flag, 40),
      discounts: discounts.kept,
      charges: charges.kept,
    },
  };
  if (method === 'pp-cod') {
    if (!isObject(meta.ppcod)) throw new InputError('ppcod is missing');
    out.order.prepaid_amount = amount(meta.ppcod.prepaid_amount, 'prepaid_amount');
  }
  return out;
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

// GoKwik's webhook check value: SHA-512 of "merchantReferenceId|paymentId|amount". It is
// not keyed, so it shows the three fields belong together, not who sent them; the
// webhook address carries a secret key for that.
export async function webhookHashes(data) {
  const n = Number(data.amount);
  const forms = [...new Set([String(data.amount), Number.isFinite(n) ? String(n) : null, Number.isFinite(n) ? n.toFixed(2) : null].filter(Boolean))];
  const enc = new TextEncoder();
  return Promise.all(
    forms.map(async (form) => hex(await crypto.subtle.digest('SHA-512', enc.encode(`${data.merchantReferenceId}|${data.paymentId}|${form}`)))),
  );
}
