const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPrice(value) {
  return rupees.format(Number(value) || 0);
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${formatCount(count)} ${count === 1 ? word : pluralWord}`;
}

export function formatOrderNumber(orderNumber) {
  return `KB-${String(orderNumber).padStart(6, '0')}`;
}

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDate(value) {
  return value ? dateFormat.format(new Date(value)) : '';
}

export const ORDER_STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function stockLevel(quantity) {
  if (quantity <= 0) return { level: 'out', label: 'Out of stock' };
  if (quantity <= 5) return { level: 'low', label: `Only ${quantity} left` };
  return { level: 'in', label: 'In stock' };
}

export function coverOf(book) {
  return Array.isArray(book?.image_urls) && book.image_urls.length > 0 ? book.image_urls[0] : null;
}
