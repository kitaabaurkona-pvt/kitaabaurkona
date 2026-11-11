import { supabase } from '../clients/supabase';
import { isUuid, unwrap } from './request';

// Every Xpressbees call goes through the `shipping` Edge Function. It holds the courier
// login and checks who is asking; the website never talks to Xpressbees itself.
async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('shipping', { body: { action, ...payload } });
  if (error) {
    let message = 'The shipping service is not responding right now. Try again shortly.';
    let status = 0;
    try {
      status = error.context?.status ?? 0;
      const body = await error.context?.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // keep the general message
    }
    throw Object.assign(new Error(message), { status });
  }
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'The shipping request failed.');
  return data.data;
}

// ---------- Customers ----------

// { pincode, deliverable, cod }
export const checkPincode = (pincode) => invoke('check_pincode', { pincode });

// Parcel status from the database straight away (no courier call).
export async function getMyShipments(orderId) {
  if (!isUuid(orderId)) return [];
  const { data } = unwrap(await supabase.rpc('get_my_shipments', { p_order: orderId }));
  return data ?? [];
}

// Asks the courier for fresh tracking (at most every 10 minutes per parcel).
export async function trackOrder(orderId) {
  return (await invoke('track', { order_id: orderId })).shipments ?? [];
}

export const SHIPMENT_STATUS_LABELS = {
  queued: 'Preparing to ship',
  booking: 'Preparing to ship',
  booked: 'Pickup scheduled',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery attempt failed',
  rto: 'Returned to us',
  cancel_requested: 'Being cancelled',
  cancelled: 'Cancelled',
  failed: 'Preparing to ship',
};

// Admins see the real state, including booking problems.
export const ADMIN_SHIPMENT_LABELS = {
  ...SHIPMENT_STATUS_LABELS,
  queued: 'Queued',
  booking: 'Booking…',
  failed: 'Booking failed',
  needs_check: 'Check Xpressbees',
  cancel_requested: 'Cancel with courier pending',
};

// ---------- Admins ----------

export const getRates = (orderId) => invoke('rates', { order_id: orderId });
export const setCourier = (orderId, courierId) => invoke('set_courier', { order_id: orderId, courier_id: courierId });
// checked: the admin confirmed the Xpressbees dashboard has no booking for this order
// (needed after an unclear answer, when Xpressbees may have booked it anyway).
export const bookNow = (orderId, checked = false) => invoke('book_now', { order_id: orderId, ...(checked ? { checked: true } : {}) });
export const linkAwb = (orderId, awb) => invoke('link_awb', { order_id: orderId, awb });
// The Xpressbees panel, where an order can be looked up by its KAK number.
export const XPRESSBEES_PANEL = 'https://shipment.xpressbees.com/';
export const cancelShipment = (orderId) => invoke('cancel_shipment', { order_id: orderId });
export const makeManifest = (orderIds) => invoke('manifest', { order_ids: orderIds });
export const listNdr = () => invoke('ndr_list');
export const actOnNdr = (items) => invoke('ndr_action', { items });
export const bookReturnPickup = (orderId) => invoke('return_pickup', { order_id: orderId });

export async function getShippingSettings() {
  const { data } = unwrap(await supabase.from('shipping_settings').select('*').limit(1));
  return data?.[0] ?? null;
}

const SETTING_FIELDS = ['auto_book', 'skip_couriers', 'warehouse_name', 'pickup_name', 'pickup_address', 'pickup_city', 'pickup_state', 'pickup_pincode', 'pickup_phone'];

export async function updateShippingSettings(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => SETTING_FIELDS.includes(key)));
  const { data } = unwrap(await supabase.from('shipping_settings').update(clean).eq('id', true).select('*'));
  return data?.[0] ?? null;
}

export async function listProblemShipments() {
  const { data } = unwrap(
    await supabase
      .from('shipments')
      .select('id, order_id, kind, status, needs_check, last_error, attempts, awb_number, updated_at')
      .in('status', ['failed', 'cancel_requested', 'exception', 'rto'])
      .order('updated_at', { ascending: false })
      .limit(50),
  );
  return data ?? [];
}
