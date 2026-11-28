// What the couriers print on their own labels, for the admin's own label (Print > Labels).
//
// Delhivery: its packing-slip API answers with the label's data as JSON
//   (/api/p/packing_slip?wbns=<awb>&pdf=false): sort code and the other label fields.
// Xpressbees: its API has no label data, only a link to its own label PDF (saved at
//   booking). The routing code is read out of that PDF's text.
// Nothing here is saved except the sort / routing code (on the parcel), and nothing is
// logged except field names and whether a code was found.

import { clean } from './text.js';

// A sort / routing code as couriers print them: "E/S-90/1C/028", "UDR/ABC", "DEL-12".
const CODE = /^[A-Z0-9][A-Z0-9 /._-]{1,38}[A-Z0-9]$/i;
export const routingCode = (value) => {
  const v = clean(value, 40).replace(/\s+/g, ' ').trim();
  return CODE.test(v) ? v : null;
};

// The short text fields of Delhivery's packing-slip answer. Pictures (barcodes and logos
// come as base64 images) and links are left out: the label draws its own barcodes.
const MAX_FIELDS = 60;
export function delhiveryLabelFields(pkg) {
  const fields = {};
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return fields;
  for (const [key, value] of Object.entries(pkg)) {
    if (Object.keys(fields).length >= MAX_FIELDS) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const s = String(value);
    if (s.length > 300 || /^(data:|https?:)/i.test(s.trim())) continue;
    const v = clean(s, 300);
    if (v) fields[key] = v;
  }
  return fields;
}

// ---------- Reading text out of a PDF ----------
// Just enough of PDF to find printed words: content streams (plain or Flate-compressed),
// literal "(...)" and hex "<...>" strings, and ToUnicode maps for fonts that print glyph
// numbers instead of letters. Anything it cannot read is skipped; it never throws on a
// strange file.

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
};

// Inflates a Flate stream. The bytes before "endstream" often end with a line break the
// decoder calls junk, so whatever was decoded before an error is kept.
async function inflate(bytes) {
  for (const format of ['deflate', 'deflate-raw']) {
    const chunks = [];
    let size = 0;
    try {
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size > 4_000_000) break;
      }
    } catch {
      // keep what was decoded
    }
    if (size > 0) {
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    }
  }
  return null;
}

// Every stream in the file, decoded when it is plain or Flate-compressed.
async function streams(raw, bytes, limit = 400) {
  const out = [];
  // Not the "stream" inside "endstream": that would swallow the next real stream.
  const re = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) && out.length < limit) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dict = raw.slice(Math.max(0, raw.lastIndexOf('<<', m.index)), m.index);
    let body = bytes.subarray(start, end);
    if (/\/Filter\s*\[?\s*\/FlateDecode\s*\]?/.test(dict)) body = await inflate(body);
    else if (/\/Filter/.test(dict)) body = null; // images and other filters: not text
    if (body && body.length < 2_000_000) out.push(latin1(body));
    re.lastIndex = end + 'endstream'.length;
  }
  return out;
}

const hexBytes = (hex) => {
  const h = hex.replace(/[^0-9a-f]/gi, '');
  const even = h.length % 2 ? `${h}0` : h;
  const out = [];
  for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
  return out;
};

const utf16 = (hex) => {
  const b = hexBytes(hex);
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
};

// A ToUnicode map: glyph code (hex, as written) -> text.
export function parseCMap(src) {
  const map = new Map();
  let width = 0;
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, from, to] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      map.set(parseInt(from, 16), utf16(to));
      width = Math.max(width, from.length / 2);
    }
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      const a = parseInt(lo, 16);
      const z = Math.min(parseInt(hi, 16), a + 4096);
      width = Math.max(width, lo.length / 2);
      if (rest.startsWith('[')) {
        [...rest.matchAll(/<([0-9a-f]*)>/gi)].forEach(([, to], i) => a + i <= z && map.set(a + i, utf16(to)));
      } else {
        const base = utf16(rest.slice(1, -1));
        for (let c = a; c <= z; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - a)));
      }
    }
  }
  return map.size ? { map, width: width || 1 } : null;
}

function decodeWith(bytes, cmap) {
  if (!cmap) return String.fromCharCode(...bytes);
  let s = '';
  for (let i = 0; i + cmap.width <= bytes.length; i += cmap.width) {
    let code = 0;
    for (let k = 0; k < cmap.width; k++) code = (code << 8) | bytes[i + k];
    s += cmap.map.get(code) ?? '';
  }
  return s;
}

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
function literalBytes(src, i) {
  // src[i] === '('; returns [bytes, next index]
  const out = [];
  let depth = 1;
  let j = i + 1;
  while (j < src.length && depth > 0) {
    const ch = src[j];
    if (ch === '\\') {
      const n = src[j + 1];
      if (n === undefined) break;
      if (Object.hasOwn(ESCAPES, n)) {
        out.push(ESCAPES[n].charCodeAt(0));
        j += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = src.slice(j + 1, j + 4).match(/^[0-7]{1,3}/)[0];
        out.push(parseInt(oct, 8) & 255);
        j += 1 + oct.length;
      } else if (n === '\r' || n === '\n') {
        j += n === '\r' && src[j + 2] === '\n' ? 3 : 2;
      } else {
        out.push(n.charCodeAt(0) & 255);
        j += 2;
      }
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth > 0) out.push(ch.charCodeAt(0) & 255);
    j++;
  }
  return [out, j];
}

// The strings a content stream prints, one entry per text-showing operator.
function shownStrings(content) {
  const shown = [];
  let current = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '%') {
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (ch === '(') {
      const [b, next] = literalBytes(content, i);
      current.push(b);
      i = next;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end < 0) break;
      current.push(hexBytes(content.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (ch === '<' || ch === '>') {
      i += 2;
      continue;
    }
    const op = content.slice(i).match(/^(Tj|TJ|'|")(?![A-Za-z])/);
    if (op) {
      if (current.length) shown.push(current);
      current = [];
      i += op[0].length;
      continue;
    }
    // any other operator ends a pending operand list
    if (/[A-Za-z*]/.test(ch)) {
      const word = content.slice(i).match(/^[A-Za-z*]+/)[0];
      if (!['Tj', 'TJ'].includes(word)) current = [];
      i += word.length;
      continue;
    }
    i++;
  }
  return shown;
}

// Joins what each operator printed. Text drawn one letter at a time is joined without
// spaces, so "R", "o", "u"... reads as one word again.
function joinShown(parts) {
  let out = '';
  parts.forEach((p, i) => {
    out += i > 0 && !(p.length === 1 && parts[i - 1].length === 1) ? ` ${p}` : p;
  });
  return out;
}

// The page text of a PDF, once per font map found (plus once read as plain letters),
// because a font's glyph numbers only make sense with that font's own map.
export async function pdfTexts(bytes, { maxBytes = 3_000_000 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > maxBytes) return [];
  const raw = latin1(bytes);
  if (!raw.startsWith('%PDF')) return [];
  const all = await streams(raw, bytes);
  const cmaps = all.filter((s) => s.includes('begincmap')).map(parseCMap).filter(Boolean);
  const contents = all.filter((s) => /\bBT\b/.test(s) && /\b(Tj|TJ)\b/.test(s)).map(shownStrings);
  const texts = [];
  for (const cmap of [null, ...cmaps]) {
    texts.push(contents.map((ops) => joinShown(ops.map((parts) => parts.map((b) => decodeWith(b, cmap)).join('')))).join('\n'));
  }
  return texts;
}

// "Routing Code: E/S-90/1C/028" (or "Sort Code", "Routing No") as printed on a label.
const PRINTED = /(?:routing|sort(?:ing)?)\s*(?:code|no\.?)\s*[:-]?\s*([A-Z0-9][A-Z0-9/._-]{1,38}[A-Z0-9])/i;
export async function routingCodeFromPdf(bytes) {
  for (const text of await pdfTexts(bytes)) {
    const found = text.match(PRINTED);
    if (found) return routingCode(found[1]);
    // Letters drawn one by one: try again with the spaces taken out.
    const tight = text.replace(/\s+/g, '').match(/(?:[Rr]outing|[Ss]ort(?:ing)?)(?:[Cc]ode|[Nn]o\.?)[:-]?([A-Z0-9][A-Z0-9/._-]{1,38}?)(?=[A-Z][a-z]|$)/);
    if (tight) return routingCode(tight[1]);
  }
  return null;
}

// Downloads a courier's label PDF (only from the hosts the caller allows), with a time
// and size limit.
export async function fetchPdf(url, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 3_000_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') || 0);
    if (length > maxBytes) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
