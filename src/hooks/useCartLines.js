import { getBooksByIds } from '../services/bookService';
import { MAX_QUANTITY } from '../utils/storeForm';
import { useAsync } from './useAsync';
import { useCart } from './useCart';

// Builds the cart from fresh database rows: price, stock and availability are never
// taken from what the browser stored.
export function useCartLines() {
  const { ids, items } = useCart();
  const idsKey = [...ids].sort().join(',');
  const result = useAsync(() => getBooksByIds(ids), [idsKey]);
  const byId = new Map((result.data ?? []).map((book) => [book.id, book]));

  const lines = ids.map((id) => {
    const book = byId.get(id) ?? null;
    const limit = book ? Math.min(book.stock_quantity, MAX_QUANTITY) : 0;
    const quantity = Math.min(items[id], Math.max(limit, 1));
    return { id, book, quantity, limit, available: Boolean(book) && limit > 0 };
  });

  const totals = lines
    .filter((line) => line.available)
    .reduce(
      (sum, line) => ({
        count: sum.count + line.quantity,
        subtotal: sum.subtotal + Number(line.book.price) * line.quantity,
        mrp: sum.mrp + Number(line.book.mrp) * line.quantity,
      }),
      { count: 0, subtotal: 0, mrp: 0 },
    );

  return { ...result, lines, totals, blocked: lines.some((line) => !line.available) };
}
