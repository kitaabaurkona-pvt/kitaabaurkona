// Reads of the public catalogue (the `books` table, visible to everyone), made straight
// to the database's REST address with the browser's own fetch, so the first screen does
// not wait for the Supabase client library (clients/supabase.js loads it for everything
// else).
//
// The public key goes in the address rather than in headers: a plain GET with no
// custom headers needs no CORS "may I?" request first, which saves a whole round trip
// to the database on every read. Asking for a total count (`count: true`) needs a
// header, so those reads still make that extra trip.
//
// `params` are PostgREST query parameters, as supabase-js would send them, e.g.
// [['select', 'id,title'], ['is_visible', 'eq.true'], ['order', 'title.asc']].
// Errors are thrown in the same shape as services/request.js unwrap().

const BASE = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function readPublic(table, params, { count = false } = {}) {
  const url = new URL(`${BASE}/rest/v1/${table}`);
  for (const [key, value] of params) url.searchParams.append(key, value);
  url.searchParams.set('apikey', KEY);

  let response;
  try {
    response = await fetch(url, count ? { headers: { Prefer: 'count=exact' } } : undefined);
  } catch (cause) {
    throw Object.assign(new Error('Failed to fetch'), { status: 0, details: { message: String(cause?.message ?? cause) } });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || 'Request failed'), {
      code: body?.code,
      hint: body?.hint,
      status: response.status,
      details: body,
    });
  }
  let total = null;
  if (count) {
    const after = Number(response.headers.get('content-range')?.split('/')[1]);
    if (Number.isFinite(after)) total = after;
  }
  return { data: Array.isArray(body) ? body : [], count: total };
}

// A list of values for an `in.(…)` filter (ids, plain category names).
export const inList = (values) => `in.(${values.join(',')})`;
