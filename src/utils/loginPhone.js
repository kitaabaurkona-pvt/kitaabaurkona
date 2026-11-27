// The number a customer just logged in with by OTP, kept for this tab only so "Your
// details" can fill the mobile number in for them. Forgotten once the details are saved.
const KEY = 'kak-login-phone';

export function rememberLoginPhone(phone) {
  try {
    if (/^[6-9][0-9]{9}$/.test(phone ?? '')) sessionStorage.setItem(KEY, phone);
  } catch {
    // storage blocked: the customer types the number instead
  }
}

export function loginPhone() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetLoginPhone() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to forget
  }
}
