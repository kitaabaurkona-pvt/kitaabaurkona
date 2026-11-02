import apiClient from './apiClient';
import { API_ROUTES } from '../utils/constants';

/**
 * Sync the local cart state with the server.
 * @param {Array} cartItems - The current cart items array.
 */
export async function syncCart(cartItems) {
  return apiClient(API_ROUTES.CART_SYNC, {
    method: 'POST',
    body: { items: cartItems },
  });
}

/**
 * Submit the cart for checkout.
 * @param {object} checkoutData - Shipping/payment details.
 */
export async function checkout(checkoutData) {
  return apiClient(API_ROUTES.CHECKOUT, {
    method: 'POST',
    body: checkoutData,
  });
}
