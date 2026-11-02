import { useContext } from 'react';
import { CartContext } from '../context/CartContext';

/**
 * Convenience hook to consume CartContext.
 * @returns {{ items, itemCount, total, addItem, removeItem, updateQuantity, clearCart }}
 */
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
