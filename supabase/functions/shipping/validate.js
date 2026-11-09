import { hasUnsafe } from './text.js';

// Strict checks for everything a caller sends. Unknown keys are refused, so nothing
// unexpected can reach the database or Xpressbees.

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN = /^[1-9][0-9]{5}$/;
const AWB = /^[0-9A-Za-z]{6,30}$/;
const PHONE = /^[6-9][0-9]{9}$/;
const COURIER = /^[0-9]{1,10}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function only(obj, allowed) {
  if (!isPlainObject(obj)) throw new InputError('Expected an object');
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new InputError(`Unexpected field: ${key.slice(0, 30)}`);
  }
}

export const uuid = (v, name = 'id') => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new InputError(`Invalid ${name}`);
  return v.toLowerCase();
};
export const pincode = (v) => {
  if (typeof v !== 'string' || !PIN.test(v)) throw new InputError('Invalid PIN code');
  return v;
};
export const awb = (v) => {
  if (typeof v !== 'string' || !AWB.test(v)) throw new InputError('Invalid AWB number');
  return v;
};
export const phone = (v) => {
  if (typeof v !== 'string' || !PHONE.test(v)) throw new InputError('Invalid mobile number');
  return v;
};
export const courierId = (v) => {
  if (typeof v !== 'string' || !COURIER.test(v)) throw new InputError('Invalid courier');
  return v;
};
export function text(v, name, { min = 1, max = 200 } = {}) {
  if (typeof v !== 'string') throw new InputError(`Invalid ${name}`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max || hasUnsafe(t)) throw new InputError(`Invalid ${name}`);
  return t;
}

// A re-attempt date: today to 7 days ahead (India time is close enough at day level).
export function reattemptDate(v, now = new Date()) {
  if (typeof v !== 'string' || !DATE.test(v)) throw new InputError('Invalid date');
  const day = Date.parse(`${v}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day) || day < today || day > today + 7 * 86400000) throw new InputError('Choose a date within the next 7 days');
  return v;
}

const ACTIONS = {
  check_pincode: (b) => {
    only(b, ['action', 'pincode']);
    return { pincode: pincode(b.pincode) };
  },
  track: (b) => {
    only(b, ['action', 'order_id']);
    return { order_id: uuid(b.order_id, 'order') };
  },
  rates: (b) => {
    only(b, ['action', 'order_id']);
    return { order_id: uuid(b.order_id, 'order') };
  },
  set_courier: (b) => {
    only(b, ['action', 'order_id', 'courier_id']);
    return { order_id: uuid(b.order_id, 'order'), courier_id: courierId(b.courier_id) };
  },
  book_now: (b) => {
    only(b, ['action', 'order_id']);
    return { order_id: uuid(b.order_id, 'order') };
  },
  cancel_shipment: (b) => {
    only(b, ['action', 'order_id']);
    return { order_id: uuid(b.order_id, 'order') };
  },
  manifest: (b) => {
    only(b, ['action', 'order_ids']);
    if (!Array.isArray(b.order_ids) || b.order_ids.length < 1 || b.order_ids.length > 50) throw new InputError('Choose 1 to 50 orders');
    const ids = [...new Set(b.order_ids.map((id) => uuid(id, 'order')))];
    return { order_ids: ids };
  },
  ndr_list: (b) => {
    only(b, ['action']);
    return {};
  },
  ndr_action: (b, now) => {
    only(b, ['action', 'items']);
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 100) throw new InputError('Choose 1 to 100 parcels');
    const items = b.items.map((item) => {
      only(item, ['awb', 'action', 'action_data']);
      const out = { awb: awb(item.awb), action: item.action };
      if (item.action === 're-attempt') {
        only(item.action_data, ['re_attempt_date']);
        out.action_data = { re_attempt_date: reattemptDate(item.action_data.re_attempt_date, now) };
      } else if (item.action === 'change_address') {
        only(item.action_data, ['name', 'address_1', 'address_2']);
        out.action_data = {
          name: text(item.action_data.name, 'name', { min: 2, max: 80 }),
          address_1: text(item.action_data.address_1, 'address', { min: 5, max: 200 }),
          address_2: item.action_data.address_2 ? text(item.action_data.address_2, 'address line 2', { max: 200 }) : '',
        };
      } else if (item.action === 'change_phone') {
        only(item.action_data, ['phone']);
        out.action_data = { phone: phone(item.action_data.phone) };
      } else {
        throw new InputError('Unknown NDR action');
      }
      return out;
    });
    if (new Set(items.map((i) => i.awb)).size !== items.length) throw new InputError('Each parcel only once');
    return { items };
  },
  return_pickup: (b) => {
    only(b, ['action', 'order_id']);
    return { order_id: uuid(b.order_id, 'order') };
  },
  run_job: (b) => {
    only(b, ['action', 'job']);
    if (!['book_due', 'cancel_requested', 'track_active'].includes(b.job)) throw new InputError('Unknown job');
    return { job: b.job };
  },
};

export const CUSTOMER_ACTIONS = ['check_pincode', 'track'];
export const ADMIN_ACTIONS = ['rates', 'set_courier', 'book_now', 'cancel_shipment', 'manifest', 'ndr_list', 'ndr_action', 'return_pickup'];
export const CRON_ACTIONS = ['run_job'];

export function parseRequest(body, now = new Date()) {
  if (!isPlainObject(body) || typeof body.action !== 'string' || !Object.hasOwn(ACTIONS, body.action)) {
    throw new InputError('Unknown action');
  }
  return { action: body.action, input: ACTIONS[body.action](body, now) };
}
