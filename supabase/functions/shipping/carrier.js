// What every courier client (Xpressbees, Delhivery) throws when the courier refuses,
// fails or cannot be reached, so the handler treats both the same way.

export const CARRIERS = ['xpressbees', 'delhivery'];
export const CARRIER_NAMES = { xpressbees: 'Xpressbees', delhivery: 'Delhivery' };

export class CarrierError extends Error {
  // retryable: a later attempt may work (network, timeout, 5xx, 429).
  // reason: the courier's own words, without our prefix ('' when it gave none).
  // afterSend: the request itself may have reached the courier.
  // uncertain: a booking whose outcome is unknown; the courier may have booked it.
  constructor(message, { status = 0, retryable = false, reason = '', afterSend = false, uncertain = false } = {}) {
    super(message);
    this.name = 'CarrierError';
    this.status = status;
    this.retryable = retryable;
    this.reason = reason;
    this.afterSend = afterSend;
    this.uncertain = uncertain;
  }
}
