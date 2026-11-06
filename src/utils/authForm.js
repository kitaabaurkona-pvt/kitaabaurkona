export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;
export const ADDRESS_MAX_LENGTH = 300;
export const RESEND_COOLDOWN_SECONDS = 60;

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[6-9][0-9]{9}$/;

export function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

export function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ');
}

export function digitsOnly(value, maxLength) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

export function isValidEmail(value) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function validateSignIn({ email, password }) {
  if (!isValidEmail(email)) return { field: 'email', message: 'Enter a valid email address.' };
  if (!password) return { field: 'password', message: 'Enter your password.' };
  return null;
}

export function validatePasswordPair(password, confirmPassword) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { field: 'password', message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { field: 'password', message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { field: 'confirm-password', message: 'Passwords do not match.' };
  }
  return null;
}

export function validateSignUp({ fullName, email, phone, gender, password, confirmPassword, address }) {
  if (fullName.length < NAME_MIN_LENGTH || fullName.length > NAME_MAX_LENGTH) {
    return { field: 'full-name', message: `Enter your full name (${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} characters).` };
  }
  if (!isValidEmail(email)) return { field: 'email', message: 'Enter a valid email address.' };
  if (!PHONE_PATTERN.test(phone)) return { field: 'phone', message: 'Enter a valid 10-digit mobile number.' };
  if (!GENDER_OPTIONS.some((option) => option.value === gender)) {
    return { field: 'gender', message: 'Select a gender.' };
  }
  const passwordProblem = validatePasswordPair(password, confirmPassword);
  if (passwordProblem) return passwordProblem;
  if (address.length > ADDRESS_MAX_LENGTH) {
    return { field: 'address', message: `Address must be at most ${ADDRESS_MAX_LENGTH} characters.` };
  }
  return null;
}

export function focusField(field) {
  const id = field === 'gender' ? 'gender-male' : field;
  document.getElementById(id)?.focus();
}

export function isRateLimited(error) {
  return error?.status === 429 || /rate_limit/.test(error?.code ?? '');
}

function isNetworkError(error) {
  return error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError';
}

// Messages are deliberately generic so responses never reveal whether an account exists.
export function signInErrorMessage(error) {
  if (isRateLimited(error)) return 'Too many attempts. Try again in a few minutes.';
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  if (error?.code === 'email_not_confirmed') return 'Confirm your email address before logging in.';
  if (error?.code === 'invalid_credentials') return 'Incorrect email or password.';
  return 'Unable to log in. Try again.';
}

export function signUpErrorMessage(error) {
  if (isRateLimited(error)) return 'Too many attempts. Try again in a few minutes.';
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  if (error?.code === 'weak_password') return 'Choose a stronger password.';
  return 'Unable to create your account. Check your details and try again.';
}

export function oauthErrorMessage(error) {
  if (isRateLimited(error)) return 'Too many attempts. Try again in a few minutes.';
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  return 'Unable to continue with Google. Try again.';
}

export function resetRequestErrorMessage(error) {
  if (isRateLimited(error)) return 'Too many requests. Wait a minute before trying again.';
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  return 'Unable to send the reset link. Try again.';
}

export function updatePasswordErrorMessage(error) {
  if (error?.name === 'AuthSessionMissingError' || error?.code === 'session_not_found') {
    return 'This reset link has expired. Request a new one.';
  }
  if (isRateLimited(error)) return 'Too many attempts. Try again in a few minutes.';
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  if (error?.code === 'same_password') return 'Choose a password different from your current one.';
  if (error?.code === 'weak_password') return 'Choose a stronger password.';
  return 'Unable to update your password. Try again.';
}

// Only same-origin absolute paths are allowed, which blocks open redirects such as //evil.com.
export function safeRedirect(path, fallback = '/') {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
  if (path.startsWith('/sign-in') || path.startsWith('/sign-up')) return fallback;
  return path;
}
