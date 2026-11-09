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
