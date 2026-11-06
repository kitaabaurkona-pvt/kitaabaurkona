// Turns a Supabase response into data or a thrown error that keeps the code,
// hint and HTTP status for the UI's message mapping (raw text is never shown).
export function unwrap({ data, error, status, count }) {
  if (error) {
    const failure = new Error(error.message || 'Request failed');
    failure.code = error.code;
    failure.hint = error.hint;
    failure.status = status;
    failure.details = error;
    throw failure;
  }
  return { data, count };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
