import { useState, useSyncExternalStore } from 'react';
import { useCart } from './useCart';
import { cartFlights } from '../utils/flyToCart';

// The count shown on cart buttons. While a cover is flying to the cart it keeps the
// previous number and updates as the cover lands (taking books out updates at once).
export function useCartBadge() {
  const { count } = useCart();
  const flying = useSyncExternalStore(cartFlights.subscribe, cartFlights.count);
  const [badge, setBadge] = useState(count);
  if (badge !== count && (flying === 0 || count < badge)) setBadge(count);
  return badge;
}
