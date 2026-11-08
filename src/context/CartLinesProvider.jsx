import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getBooksByIds } from '../services/bookService';
import { MAX_QUANTITY } from '../utils/storeForm';
import { useAsync } from '../hooks/useAsync';
import { useCart } from '../hooks/useCart';
import { CartLinesContext } from './cartLinesContextObject';

// Builds the cart from fresh database rows once, for the header, the cart panel, the
// cart page and checkout. Price, stock and availability are never taken from what the
// browser stored, and the order itself is priced again by the database.
export function CartLinesProvider({ children }) {
  const { ids, items, setQuantity } = useCart();
  const idsKey = [...ids].sort().join(',');
  const result = useAsync(() => getBooksByIds(ids), [idsKey]);
  const { data, loading, error, retry } = result;
  const { pathname } = useLocation();
  // The panel remembers the page it was opened on, so moving to another page closes it.
  const [openOn, setOpenOn] = useState(null);
  const cartOpen = openOn === pathname;

  const openCart = useCallback(() => {
    setOpenOn(pathname);
    retry();
  }, [pathname, retry]);
  const closeCart = useCallback(() => setOpenOn(null), []);
  const setCartOpen = useCallback((open) => (open ? openCart() : closeCart()), [openCart, closeCart]);

  const value = useMemo(() => {
    const byId = new Map((data ?? []).map((book) => [book.id, book]));
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
    return {
      data,
      loading,
      error,
      retry,
      lines,
      totals,
      blocked: lines.some((line) => !line.available),
      cartOpen,
      setCartOpen,
      openCart,
      closeCart,
    };
  }, [data, loading, error, retry, ids, items, cartOpen, setCartOpen, openCart, closeCart]);

  // If stock dropped since a book was added, bring its quantity down to what exists.
  useEffect(() => {
    for (const line of value.lines) {
      if (line.available && items[line.id] > line.limit) setQuantity(line.id, line.limit);
    }
  }, [value.lines, items, setQuantity]);

  return <CartLinesContext.Provider value={value}>{children}</CartLinesContext.Provider>;
}
