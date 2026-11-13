// Text cleaning shared by the shipping function: control characters and angle brackets
// become spaces, runs of spaces collapse, and the result is cut to a maximum length.

const isUnsafe = (ch) => {
  const code = ch.charCodeAt(0);
  return code < 32 || code === 127 || ch === '<' || ch === '>';
};

export const hasUnsafe = (value) => [...String(value)].some(isUnsafe);

export function clean(value, max) {
  return [...String(value ?? '')]
    .map((ch) => (isUnsafe(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Courier messages can echo request data: phone numbers and email addresses are
// blanked, and the text is kept short and on one line.
export function redact(value) {
  return String(value ?? '')
    .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone]')
    .replace(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/gi, '[email]');
}
export const cleanMessage = (value) => clean(redact(value), 200);
