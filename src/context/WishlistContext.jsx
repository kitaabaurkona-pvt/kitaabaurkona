import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { addToWishlist, listWishlistIds, removeFromWishlist } from '../services/wishlistService';
import { WishlistContext } from './wishlistContextObject';

const EMPTY = new Set();

export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Saved ids are remembered per user, so signing out or switching accounts can never
  // show the previous person's wishlist.
  const [state, setState] = useState({ userId: null, ids: EMPTY });
  const ids = userId && state.userId === userId ? state.ids : EMPTY;
  const pending = useRef(new Set());

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    listWishlistIds()
      .then((list) => {
        if (active) setState({ userId, ids: new Set(list) });
      })
      .catch(() => {
        if (active) setState({ userId, ids: new Set() });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    (change) => {
      setState((current) => {
        const base = current.userId === userId ? current.ids : new Set();
        const next = new Set(base);
        change(next);
        return { userId, ids: next };
      });
    },
    [userId],
  );

  // Optimistic: the bookmark changes at once and is put back if the request fails.
  const toggle = useCallback(
    async (bookId) => {
      if (!userId || pending.current.has(bookId)) return null;
      pending.current.add(bookId);
      const saving = !ids.has(bookId);
      update((next) => (saving ? next.add(bookId) : next.delete(bookId)));
      try {
        if (saving) await addToWishlist(bookId);
        else await removeFromWishlist(bookId);
        return saving;
      } catch (error) {
        update((next) => (saving ? next.delete(bookId) : next.add(bookId)));
        throw error;
      } finally {
        pending.current.delete(bookId);
      }
    },
    [ids, userId, update],
  );

  const forget = useCallback((bookId) => update((next) => next.delete(bookId)), [update]);

  const value = useMemo(
    () => ({ ids, count: ids.size, has: (bookId) => ids.has(bookId), toggle, forget }),
    [ids, toggle, forget],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
