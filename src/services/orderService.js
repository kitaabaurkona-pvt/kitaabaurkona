import { supabase } from '../clients/supabase';
import { isUuid, unwrap } from './request';

// Only book ids and quantities are sent. The database prices the order itself.
export async function createOrder(items, shipping) {
  const { data } = unwrap(
    await supabase.rpc('create_order', {
      items: items.map(({ bookId, quantity }) => ({ book_id: bookId, quantity })),
      shipping,
    }),
  );
  return data;
}

export async function listOrders() {
  const { data } = unwrap(
    await supabase
      .from('orders')
      .select('id, order_number, status, item_count, subtotal, mrp_total, created_at, order_items(sku, title, image_url, quantity)')
      .order('created_at', { ascending: false })
      .limit(100),
  );
  return data ?? [];
}

export async function getOrder(id) {
  if (!isUuid(id)) return null;
  const { data } = unwrap(await supabase.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle());
  return data;
}

export async function cancelOrder(id) {
  unwrap(await supabase.rpc('cancel_order', { p_order: id }));
}
