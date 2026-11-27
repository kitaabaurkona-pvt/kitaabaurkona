// Return and exchange requests: the lists and words the store and the admin panel share.
// The database checks the same lists (schema.sql 9i: return_reasons() and friends).

export const RETURN_WINDOW_DAYS = 3;
export const RETURN_PHOTO_LIMIT = 3;

export const RETURN_REASONS = [
  'Wrong Product Received',
  'Damaged Product',
  'Defective product (pages missing or misprinted)',
  'Missing item/Quantity',
  "Doesn't match description or photo",
  'Quality not up to expectation',
  'Found better price for same product',
  'Other',
];

// Reasons that need at least one photo of the problem.
export const RETURN_PHOTO_REASONS = ['Wrong Product Received', 'Damaged Product', 'Defective product (pages missing or misprinted)', "Doesn't match description or photo"];

export const RETURN_REJECT_REASONS = [
  'Request raised after the return window',
  'Photos do not show the problem',
  'Book is used or damaged by the customer',
  'Wrong book was not sent',
  'Duplicate request',
  'Other',
];

export const RETURN_CLOSE_REASONS = ['Cancelled by customer', 'Cancelled by logistics partner', 'Quality check failed', 'Other'];

export const RETURN_KINDS = { return: 'Return', exchange: 'Exchange' };

export const UPI_PATTERN = /^[A-Za-z0-9._-]{2,200}@[A-Za-z0-9]{2,64}$/;

export const formatRequestNumber = (n) => `R-${String(n).padStart(5, '0')}`;

// Until when a delivered order can be returned (null when it was never delivered).
export function returnDeadline(order) {
  if (order?.status !== 'delivered') return null;
  const from = order.delivered_at ?? order.updated_at;
  return from ? new Date(new Date(from).getTime() + RETURN_WINDOW_DAYS * 86400000) : null;
}

// What the customer sees about their request.
export function customerReturnState(request) {
  const what = request.kind === 'exchange' ? 'exchange' : 'return';
  switch (request.stage) {
    case 'new':
      return { label: 'Requested', tone: 'pending', text: `We have your ${what} request and will look at it soon.` };
    case 'ongoing':
      return {
        label: 'Approved',
        tone: 'info',
        text: request.kind === 'exchange' ? 'Approved. A courier will pick up the books, and the replacement is on its way.' : 'Approved. A courier will pick up the books.',
      };
    case 'pickup_failed':
      return { label: 'Pickup missed', tone: 'warn', text: 'The courier could not pick up the books. We will contact you to arrange it again.' };
    case 'settlement_pending':
      return { label: 'Picked up', tone: 'info', text: 'The books have been picked up. Your refund is being processed.' };
    default:
      if (request.decision === 'rejected') return { label: 'Not accepted', tone: 'danger', text: request.reject_reason ? `Not accepted: ${request.reject_reason}.` : 'Not accepted.' };
      if (request.decision === 'withdrawn') return { label: 'Withdrawn', tone: 'muted', text: 'You withdrew this request.' };
      if (request.outcome === 'passed') {
        return request.kind === 'exchange'
          ? { label: 'Exchanged', tone: 'ok', text: 'Exchanged: the replacement has been delivered.' }
          : { label: 'Refunded', tone: 'ok', text: 'Refunded.' };
      }
      return { label: 'Closed', tone: 'muted', text: request.fail_reason ? `Closed: ${request.fail_reason}.` : 'Closed.' };
  }
}

export function returnErrorMessage(error) {
  const hint = error?.hint ?? error?.details?.hint;
  const messages = {
    return_kind: 'Choose return or exchange.',
    return_items: 'Choose the books to send back.',
    return_reason: 'Choose a reason.',
    return_remark: 'Tell us what is wrong (up to 300 characters).',
    return_photos: 'Add a photo that shows the problem.',
    return_upi: 'That UPI ID does not look right.',
    return_not_delivered: 'Only a delivered order can be returned.',
    return_replacement: 'A replacement cannot be returned again here. Contact us instead.',
    return_window: `The ${RETURN_WINDOW_DAYS}-day return window for this order has closed.`,
    return_open: 'This order already has an open request.',
    return_done: 'This order was already returned or exchanged.',
    return_locked: 'This request has already moved on. Refresh the page to see where it is.',
    return_amount: 'The refund must be more than ₹0 and at most what the books cost (and what is left to refund).',
    return_ref: 'Write the UTR or payment reference (up to 60 characters).',
    return_no_gokwik: 'This order was not paid through GoKwik. Refund it by hand and mark it Paid Offline.',
    return_refund_busy: 'A refund for this order is already under way with GoKwik.',
  };
  if (messages[hint]) return messages[hint];
  if (error?.code === '42501' || error?.status === 403) return "You don't have permission to do that.";
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Your session has expired. Sign in again.';
  if (error?.status === 0) return 'Unable to reach the server. Check your connection and try again.';
  return null;
}
