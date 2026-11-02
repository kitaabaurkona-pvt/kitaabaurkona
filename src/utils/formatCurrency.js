import { CURRENCY, LOCALE } from './constants';

/**
 * Formats a numeric value into a localised currency string.
 * @param {number} amount - The raw numeric price.
 * @returns {string} Formatted price string (e.g. "$19.99").
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
  }).format(amount);
}
