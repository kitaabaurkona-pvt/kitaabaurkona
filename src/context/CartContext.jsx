import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { isUuid } from '../services/request';
import { MAX_CART_LINES, MAX_QUANTITY } from '../utils/storeForm';

export const CartContext = createContext(null);

const STORAGE_KEY = 'kitaab_cart_v2';

// The cart only ever holds book ids and quantities. Prices, titles and stock are
// always read fresh from the database, so editing localStorage cannot change a price.
function sanitize(value) {
  const clean = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
  for (const [id, quantity] of Object.entries(value)) {
    if (Object.keys(clean).length >= MAX_CART_LINES) break;
    if (isUuid(id) && Number.isInteger(quantity) && quantity >= 1) clean[id] = Math.min(quantity, MAX_QUANTITY);
  }
  return clean;
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage can be unavailable (private mode); the cart still works for this visit.
    }
  }, [items]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setItems(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((bookId, quantity = 1, max = MAX_QUANTITY) => {
    if (!isUuid(bookId)) return;
    setItems((current) => {
      if (!current[bookId] && Object.keys(current).length >= MAX_CART_LINES) return current;
      const limit = Math.max(0, Math.min(max, MAX_QUANTITY));
      const next = Math.min((current[bookId] ?? 0) + quantity, limit);
      if (next < 1) return current;
      return { ...current, [bookId]: next };
    });
  }, []);

  const setQuantity = useCallback((bookId, quantity) => {
    setItems((current) => {
      if (!(bookId in current)) return current;
      if (quantity < 1) {
        const { [bookId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [bookId]: Math.min(quantity, MAX_QUANTITY) };
    });
  }, []);

  const remove = useCallback((bookId) => {
    setItems((current) => {
      const { [bookId]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const clear = useCallback(() => setItems({}), []);

  const value = useMemo(() => {
    const ids = Object.keys(items);
    return {
      items,
      ids,
      count: ids.reduce((sum, id) => sum + items[id], 0),
      quantityOf: (bookId) => items[bookId] ?? 0,
      add,
      setQuantity,
      remove,
      clear,
    };
  }, [items, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
