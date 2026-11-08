import { useContext } from 'react';
import { CartLinesContext } from '../context/cartLinesContextObject';

// The cart priced from fresh database rows, plus the cart panel's open state.
// Data is built once in CartLinesProvider and shared by every caller.
export function useCartLines() {
  const context = useContext(CartLinesContext);
  if (!context) throw new Error('useCartLines must be used within a CartLinesProvider');
  return context;
}
