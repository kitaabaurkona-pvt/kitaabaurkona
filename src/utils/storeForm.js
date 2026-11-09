import { normalizeName } from './authForm';

export const MAX_QUANTITY = 10;
export const MAX_CART_LINES = 50;

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const PHONE_PATTERN = /^[6-9][0-9]{9}$/;
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export function normalizeShipping(form) {
  return {
    name: normalizeName(form.name ?? ''),
    phone: String(form.phone ?? '').replace(/\D/g, ''),
    address: String(form.address ?? '').trim().replace(/[ \t]+/g, ' '),
    city: normalizeName(form.city ?? ''),
    state: String(form.state ?? '').trim(),
    pincode: String(form.pincode ?? '').replace(/\D/g, ''),
  };
}

// Mirrors the orders table constraints so problems are caught before the request.
export function validateShipping(s) {
  if (s.name.length < 2 || s.name.length > 80) return { field: 'ship-name', message: 'Enter the full name for delivery.' };
  if (!PHONE_PATTERN.test(s.phone)) return { field: 'ship-phone', message: 'Enter a valid 10-digit mobile number.' };
  if (s.address.length < 5 || s.address.length > 300) return { field: 'ship-address', message: 'Enter the house, street and area (5-300 characters).' };
  if (s.city.length < 2 || s.city.length > 60) return { field: 'ship-city', message: 'Enter the city.' };
  if (!INDIAN_STATES.includes(s.state)) return { field: 'ship-state', message: 'Choose a state.' };
  if (!PINCODE_PATTERN.test(s.pincode)) return { field: 'ship-pincode', message: 'Enter a valid 6-digit PIN code.' };
  return null;
}

export function orderErrorMessage(error) {
  const hint = error?.details?.hint ?? error?.hint;
  if (hint === 'unavailable') return 'Some books in your cart are no longer available in that quantity. Review your cart and try again.';
  if (hint === 'pending_limit') return 'You have 5 orders awaiting payment. Pay for or cancel one before placing another.';
  if (error?.code === 'PGRST202') return 'Ordering is being updated. Try again in a few minutes.';
  if (error?.code === '23514') return 'Check your delivery details and try again.';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Your session has expired. Sign in again to place the order.';
  if (error?.status === 0) return 'Unable to reach the server. Check your connection and try again.';
  return 'Unable to place the order. Try again.';
}

// Search text is matched with ILIKE; escape its wildcard characters so they are literal.
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
