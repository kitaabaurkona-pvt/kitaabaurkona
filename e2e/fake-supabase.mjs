// A local stand-in for the Supabase API used by the browser tests.
//
// It runs the project's real supabase/schema.sql inside PGlite (Postgres compiled to
// WebAssembly) and answers the small part of PostgREST and Supabase Auth that the site
// uses. Every request runs as the caller's role (anon or authenticated) with their user
// id in request.jwt.claims, so Row Level Security and grants behave as in production.
//
// Nothing here talks to the live project except `fetchPublicBooks`, which reads the public
// catalogue with the anon key so tests use real books. No keys are stored in this folder.

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const USERS = {
  'admin@example.com': { id: '11111111-1111-4111-8111-111111111111', password: 'admin-pass-1', meta: { full_name: 'Store Admin' } },
  'reader@example.com': {
    id: '22222222-2222-4222-8222-222222222222',
    password: 'reader-pass-1',
    meta: { full_name: 'Asha Rao', phone: '9876543210', gender: 'female', address: '12 MG Road, Near City Palace' },
  },
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
// Embedded resources the site asks for, e.g. `orders?select=*,order_items(*)`.
const RELATIONS = {
  orders: { order_items: { many: true, local: 'id', remote: 'order_id' } },
  wishlist_items: { books: { many: false, local: 'book_id', remote: 'id' } },
};

const PRELUDE = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- As on Supabase: the service role gets every table, sequence and function by default.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
`;

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// A stand-in for the service-role key the shipping Edge Function gets from Supabase.
export const SERVICE_TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role' })}.sig`;

export function sessionFor(email) {
  const u = USERS[email];
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: { provider: 'email' },
    user_metadata: u.meta,
    created_at: new Date().toISOString(),
  };
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', email, exp })}.sig`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${u.id}`,
    user,
  };
}

function claimsFrom(headers) {
  const auth = headers.authorization || headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.role === 'authenticated' && payload.sub) return { role: 'authenticated', sub: payload.sub };
    if (payload.role === 'service_role') return { role: 'service_role', sub: null };
  } catch {
    // not a JWT we issued: treat as the anonymous key
  }
  return { role: 'anon', sub: null };
}

export async function asRole(db, { role, sub }, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role })]);
    const pgRole = role === 'authenticated' || role === 'service_role' ? role : 'anon';
    await tx.exec(`set local role ${pgRole}`);
    return fn(tx);
  });
}

// Reads the public catalogue from the live project with the anon key in .env.local.
export async function fetchPublicBooks(envPath) {
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\s*VITE_SUPABASE_(URL|ANON_KEY)\s*=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      }),
  );
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/books?select=*&order=sku.asc`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Could not read the public catalogue (${res.status})`);
  return res.json();
}

export async function createBackend({ schemaPath, books }) {
  const db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(fs.readFileSync(path.resolve(schemaPath), 'utf8'));
  for (const [email, u] of Object.entries(USERS)) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [u.id, email, u.meta]);
  }
  await db.query(`update public.users set role = 'admin' where id = $1`, [USERS['admin@example.com'].id]);
  const payload = books.map((b) => ({
    product_code: b.product_code,
    sku: b.sku,
    title: b.title,
    description: b.description,
    price: Number(b.price),
    mrp: Number(b.mrp),
    gst_percent: Number(b.gst_percent),
    stock_quantity: b.stock_quantity,
    image_urls: b.image_urls,
    video_url: b.video_url,
    length_cm: b.length_cm,
    breadth_cm: b.breadth_cm,
    height_cm: b.height_cm,
    weight_kg: b.weight_kg,
    return_policy: b.return_policy,
    is_visible: b.is_visible,
    product_type: b.product_type,
    attributes: b.attributes ?? {},
    internal: { cost_price: null, pickup_address_code: null },
  }));
  await asRole(db, { role: 'authenticated', sub: USERS['admin@example.com'].id }, (tx) =>
    tx.query('select * from public.admin_upsert_books($1::jsonb)', [JSON.stringify(payload)]),
  );
  // Categories are set separately from uploads, so copy them over from the live data.
  const categories = books.filter((b) => b.category).map((b) => ({ sku: b.sku, category: b.category }));
  if (categories.length) {
    await db.query(
      `update public.books b set category = c.category
       from jsonb_to_recordset($1::jsonb) as c(sku text, category text) where b.sku = c.sku`,
      [JSON.stringify(categories)],
    );
  }
  return db;
}

// ---------- PostgREST emulation ----------

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function ident(name) {
  if (!IDENT.test(name)) throw Object.assign(new Error(`Bad identifier ${name}`), { status: 400 });
  return `"${name}"`;
}

function selectList(table, select, alias) {
  return splitTop(select || '*')
    .map((item) => {
      const m = item.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/s);
      if (m) {
        const rel = RELATIONS[table]?.[m[1]];
        if (!rel) throw Object.assign(new Error(`Unknown relation ${m[1]}`), { status: 400 });
        const inner = selectList(m[1], m[2], 'c');
        const where = `c.${ident(rel.remote)} = ${alias}.${ident(rel.local)}`;
        return rel.many
          ? `(select coalesce(json_agg(x), '[]'::json) from (select ${inner} from public.${ident(m[1])} c where ${where}) x) as ${ident(m[1])}`
          : `(select row_to_json(x) from (select ${inner} from public.${ident(m[1])} c where ${where}) x) as ${ident(m[1])}`;
      }
      return item === '*' ? `${alias}.*` : `${alias}.${ident(item)}`;
    })
    .join(', ');
}

function condition(col, expr, params) {
  const c = `t.${ident(col)}`;
  const dot = expr.indexOf('.');
  let op = expr.slice(0, dot);
  let value = expr.slice(dot + 1);
  let negate = false;
  if (op === 'not') {
    negate = true;
    const d2 = value.indexOf('.');
    op = value.slice(0, d2);
    value = value.slice(d2 + 1);
  }
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  let sql;
  switch (op) {
    case 'eq': sql = `${c}::text = ${p(value)}`; break;
    case 'neq': sql = `${c}::text <> ${p(value)}`; break;
    case 'gt': sql = `${c} > ${p(value)}`; break;
    case 'gte': sql = `${c} >= ${p(value)}`; break;
    case 'lt': sql = `${c} < ${p(value)}`; break;
    case 'lte': sql = `${c} <= ${p(value)}`; break;
    case 'ilike': sql = `${c} ilike ${p(value.replace(/\*/g, '%'))}`; break;
    case 'is': sql = value === 'null' ? `${c} is null` : `${c} is ${value === 'true' ? 'true' : 'false'}`; break;
    case 'in': {
      const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      sql = `${c}::text = any(${p(list)}::text[])`;
      break;
    }
    default:
      throw Object.assign(new Error(`Unsupported operator ${op}`), { status: 400 });
  }
  return negate ? `not (${sql})` : sql;
}

function whereClause(url, params) {
  const conds = [];
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    if (key === 'or') {
      const inner = splitTop(value.replace(/^\(|\)$/g, '')).map((part) => {
        const d = part.indexOf('.');
        return condition(part.slice(0, d), part.slice(d + 1), params);
      });
      conds.push(`(${inner.join(' or ')})`);
    } else {
      conds.push(condition(key, value, params));
    }
  }
  return conds.length ? `where ${conds.join(' and ')}` : '';
}

function orderClause(url) {
  const order = url.searchParams.get('order');
  if (!order) return '';
  return `order by ${order
    .split(',')
    .map((part) => {
      const [col, dir, nulls] = part.split('.');
      return `t.${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
    })
    .join(', ')}`;
}

function pgError(error) {
  const code = error.code || 'PGRST000';
  const status = error.status || (code === '42501' ? 403 : code === '23505' ? 409 : code === 'P0002' ? 404 : 400);
  return {
    status,
    body: JSON.stringify({ code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null }),
  };
}

export async function handleRest(db, { method, url, headers, body }) {
  const claims = claimsFrom(headers);
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  try {
    if (parts[0] === 'rpc') {
      const fn = ident(parts[1]);
      const args = body ? JSON.parse(body) : {};
      const names = Object.keys(args);
      names.forEach(ident);
      const values = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
      const call = `public.${fn}(${names.map((n, i) => `"${n}" => $${i + 1}`).join(', ')})`;
      const rows = await asRole(db, claims, async (tx) => {
        const shape = await tx.query(
          `select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 limit 1`,
          [parts[1]],
        );
        const setof = shape.rows[0]?.proretset || shape.rows[0]?.typtype === 'c';
        const sql = setof
          ? `select coalesce(json_agg(r), '[]'::json) as j from ${call} r`
          : `select to_json(${call}) as j`;
        return (await tx.query(sql, values)).rows;
      });
      return { status: 200, body: JSON.stringify(rows[0].j) };
    }

    const table = parts[0];
    ident(table);
    const params = [];
    const where = whereClause(url, params);
    const wantObject = String(headers.accept || '').includes('vnd.pgrst.object');
    const prefer = String(headers.prefer || '');

    if (method === 'GET' || method === 'HEAD') {
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const page = `${limit ? `limit ${Number(limit)}` : ''} ${offset ? `offset ${Number(offset)}` : ''}`;
      return await asRole(db, claims, async (tx) => {
        const listSql = `select coalesce(json_agg(r), '[]'::json) as j from (select ${selectList(table, url.searchParams.get('select'), 't')} from public.${ident(table)} t ${where} ${orderClause(url)} ${page}) r`;
        const rows = method === 'HEAD' ? [] : (await tx.query(listSql, params)).rows[0].j;
        const out = { status: 200, headers: {}, body: method === 'HEAD' ? '' : JSON.stringify(rows) };
        if (prefer.includes('count=exact')) {
          const total = (await tx.query(`select count(*)::int as n from public.${ident(table)} t ${where}`, params)).rows[0].n;
          const from = Number(offset || 0);
          out.headers['content-range'] = rows.length ? `${from}-${from + rows.length - 1}/${total}` : `*/${total}`;
        }
        if (wantObject) {
          if (rows.length !== 1) return { status: 406, body: JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }) };
          out.body = JSON.stringify(rows[0]);
        }
        return out;
      });
    }

    if (method === 'POST') {
      const input = JSON.parse(body || '{}');
      const rowsIn = Array.isArray(input) ? input : [input];
      return await asRole(db, claims, async (tx) => {
        const out = [];
        for (const row of rowsIn) {
          const cols = Object.keys(row);
          cols.forEach(ident);
          const vals = cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
          const r = await tx.query(
            `insert into public.${ident(table)} (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
            vals,
          );
          out.push(...r.rows);
        }
        return prefer.includes('return=representation') ? { status: 201, body: JSON.stringify(out) } : { status: 201, body: '' };
      });
    }

    if (method === 'PATCH') {
      const patch = JSON.parse(body || '{}');
      const cols = Object.keys(patch);
      cols.forEach(ident);
      return await asRole(db, claims, async (tx) => {
        const vals = cols.map((c) => patch[c]);
        const sets = cols.map((c, i) => `"${c}" = $${params.length + i + 1}`).join(', ');
        const r = await tx.query(`update public.${ident(table)} t set ${sets} ${where} returning t.id`, [...params, ...vals]);
        if (!prefer.includes('return=representation')) return { status: 204, body: '' };
        const ids = r.rows.map((row) => row.id);
        const sel = await tx.query(
          `select coalesce(json_agg(r), '[]'::json) as j from (select ${selectList(table, url.searchParams.get('select'), 't')} from public.${ident(table)} t where t.id = any($1::uuid[])) r`,
          [ids],
        );
        const rows = sel.rows[0].j;
        if (wantObject) {
          if (rows.length !== 1) return { status: 406, body: JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }) };
          return { status: 200, body: JSON.stringify(rows[0]) };
        }
        return { status: 200, body: JSON.stringify(rows) };
      });
    }

    if (method === 'DELETE') {
      return await asRole(db, claims, async (tx) => {
        await tx.query(`delete from public.${ident(table)} t ${where}`, params);
        return { status: 204, body: '' };
      });
    }

    return { status: 405, body: '{}' };
  } catch (error) {
    return pgError(error);
  }
}

// ---------- Auth emulation ----------

export function handleAuth({ url, headers, body }) {
  const json = (status, value) => ({ status, body: JSON.stringify(value) });
  if (url.pathname === '/auth/v1/token') {
    const input = JSON.parse(body || '{}');
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const entry = Object.entries(USERS).find(([, u]) => `refresh-${u.id}` === input.refresh_token);
      return entry ? json(200, sessionFor(entry[0])) : json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    }
    const u = USERS[input.email];
    if (u && u.password === input.password) return json(200, sessionFor(input.email));
    return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/user') {
    const { sub } = claimsFrom(headers);
    const entry = Object.entries(USERS).find(([, u]) => u.id === sub);
    if (!entry) return json(401, { error_code: 'no_authorization', msg: 'No user' });
    return json(200, sessionFor(entry[0]).user);
  }
  if (url.pathname === '/auth/v1/logout') return { status: 204, body: '' };
  return json(404, {});
}
