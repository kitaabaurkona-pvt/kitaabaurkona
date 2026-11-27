// "Skip for now" on "Your details", remembered on this device per account, so a customer
// who skipped is not sent back there while browsing. Checkout still asks (DetailsGate).
const key = (userId) => `kak-details-skipped:${userId}`;

export function detailsSkippedBy(userId) {
  try {
    return localStorage.getItem(key(userId)) === '1';
  } catch {
    return false;
  }
}

export function rememberDetailsSkipped(userId) {
  try {
    localStorage.setItem(key(userId), '1');
  } catch {
    // storage blocked: skipping still works until the page is reloaded
  }
}
