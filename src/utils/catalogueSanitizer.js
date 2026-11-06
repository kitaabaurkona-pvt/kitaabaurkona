// Turns raw rows from listing_1.csv into rows that match supabase/schema.sql.
// Every value is treated as untrusted: text is stripped of HTML, numbers are parsed
// strictly, links must be https, and limits mirror the database's own constraints so
// the upload never fails half-way on a row the database would reject.

export const REQUIRED_COLUMNS = ['Product Code', 'Sku Id', 'Name', 'Selling Price', 'MRP'];

const LIMITS = { title: 300, sku: 64, productCode: 64, description: 5000, shortText: 100, url: 2048 };
const MAX_AMOUNT = 99999999.99; // numeric(10, 2)
const MAX_IMAGES = 10;
const ATTRIBUTE_COLUMNS = [
  ['attr_Brand', 'brand'],
  ['attr_Country of Origin', 'country_of_origin'],
  ['attr_Ideal For', 'ideal_for'],
  ['attr_Pack of', 'pack_of'],
  ['attr_Genre', 'genre'],
];
const YIELD_EVERY = 500;

// Control characters and bidirectional overrides (which can disguise text) are removed.
// Zero-width joiners (U+200C, U+200D) are kept because Tamil and other Indic scripts need them.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;
const DANGEROUS_ELEMENTS = 'script,style,template,noscript,iframe,object,embed,svg,math,title,head';

// Returns plain text with all HTML removed. The text is parsed with DOMParser, which
// never runs scripts or loads resources, and only textContent is kept. Decoding is
// repeated so double-encoded payloads such as "&amp;lt;script&amp;gt;" cannot survive
// as markup, and any "<" that could still start a tag is dropped at the end.
export function stripHtml(input) {
  let text = input;
  for (let round = 0; round < 3 && /[<&]/.test(text); round += 1) {
    const prepared = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n');
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    doc.querySelectorAll(DANGEROUS_ELEMENTS).forEach((node) => node.remove());
    const decoded = doc.body.textContent ?? '';
    if (decoded === text) break;
    text = decoded;
  }
  return text.replace(/<(?=[a-z!/?])/gi, '');
}

export function cleanText(raw, { multiline = false } = {}) {
  let text = String(raw ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  text = stripHtml(text).replace(INVISIBLE, '');
  if (multiline) {
    text = text
      .split('\n')
      .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  return text.trim();
}

// Strict number parsing: "1,299" and "₹ 499" are accepted, while "12abc", "-5",
// "1e3" or "N/A" are rejected instead of being half-read like parseFloat would.
export function parseAmount(raw) {
  const text = String(raw ?? '').replace(/[₹,\s]/g, '');
  if (text === '') return { empty: true };
  if (!/^\d+(\.\d+)?$/.test(text)) return { invalid: true };
  return { value: Number(text) };
}

export function cleanUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { empty: true };
  if (/\s/.test(text)) return { invalid: true };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { invalid: true };
  }
  if (url.protocol !== 'https:' || url.username || url.password) return { invalid: true };
  if (url.href.length > LIMITS.url) return { invalid: true };
  return { value: url.href };
}

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

// Returns { book } for a valid row or { reason } explaining why it was skipped.
export function sanitizeRow(row) {
  const get = (column) => row[column] ?? '';

  const title = cleanText(get('Name'));
  const sku = cleanText(get('Sku Id'));
  const productCode = cleanText(get('Product Code'));
  if (!title) return { reason: 'Name is empty' };
  if (!sku) return { reason: 'Sku Id is empty' };
  if (!productCode) return { reason: 'Product Code is empty' };
  if (title.length > LIMITS.title) return { reason: `Name is longer than ${LIMITS.title} characters` };
  if (sku.length > LIMITS.sku) return { reason: `Sku Id is longer than ${LIMITS.sku} characters` };
  if (productCode.length > LIMITS.productCode) return { reason: `Product Code is longer than ${LIMITS.productCode} characters` };

  const description = cleanText(get('Description'), { multiline: true });
  if (description.length > LIMITS.description) {
    return { reason: `Description is longer than ${LIMITS.description} characters` };
  }

  // Prices are required: a missing price must never turn into a free book.
  const price = parseAmount(get('Selling Price'));
  if (price.empty || price.invalid || price.value > MAX_AMOUNT) return { reason: 'Selling Price is missing or not a number' };
  const mrp = parseAmount(get('MRP'));
  if (mrp.empty || mrp.invalid || mrp.value > MAX_AMOUNT) return { reason: 'MRP is missing or not a number' };
  if (price.value > mrp.value) return { reason: 'Selling Price is higher than MRP' };

  const stock = parseAmount(get('Quantity'));
  if (stock.invalid || (!stock.empty && !Number.isInteger(stock.value))) {
    return { reason: 'Quantity must be a whole number' };
  }
  if (!stock.empty && stock.value > 2147483647) return { reason: 'Quantity is too large' };

  const gst = parseAmount(get('GST %'));
  if (gst.invalid || (!gst.empty && gst.value > 100)) return { reason: 'GST % must be between 0 and 100' };

  // Optional measurements: empty or 0 means "not provided".
  const measurement = (column, label) => {
    const parsed = parseAmount(get(column));
    if (parsed.invalid) return { reason: `${label} is not a number` };
    return { value: parsed.empty || parsed.value === 0 ? null : parsed.value };
  };
  const length = measurement('Packaging Length (in cm)', 'Packaging Length');
  const breadth = measurement('Packaging Breadth (in cm)', 'Packaging Breadth');
  const height = measurement('Packaging Height (in cm)', 'Packaging Height');
  const weight = measurement('Packaging Weight (in kg)', 'Packaging Weight');
  for (const part of [length, breadth, height, weight]) if (part.reason) return { reason: part.reason };

  const returnPolicy = parseAmount(get('Return/Exchange Condition'));
  if (returnPolicy.invalid || (!returnPolicy.empty && (!Number.isInteger(returnPolicy.value) || returnPolicy.value > 100))) {
    return { reason: 'Return/Exchange Condition must be a whole number' };
  }

  const imageUrls = [];
  for (let i = 1; i <= MAX_IMAGES; i += 1) {
    const url = cleanUrl(get(`Image ${i}`));
    if (url.invalid) return { reason: `Image ${i} is not a valid https link` };
    if (url.value) imageUrls.push(url.value);
  }
  const video = cleanUrl(get('Video 1'));
  if (video.invalid) return { reason: 'Video 1 is not a valid https link' };

  const visibility = cleanText(get('Visibility')).toLowerCase();
  if (visibility && visibility !== 'true' && visibility !== 'false') {
    return { reason: 'Visibility must be true or false' };
  }

  const productType = cleanText(get('Product Type')).slice(0, LIMITS.shortText) || null;
  const attributes = {};
  for (const [column, key] of ATTRIBUTE_COLUMNS) {
    const value = cleanText(get(column)).slice(0, LIMITS.shortText);
    if (value) attributes[key] = value;
  }

  const cost = parseAmount(get('Cost Price'));
  if (cost.invalid || (!cost.empty && cost.value > MAX_AMOUNT)) return { reason: 'Cost Price is not a number' };
  const pickup = cleanText(get('Pickup Address Code')).slice(0, 64) || null;

  return {
    book: {
      product_code: productCode,
      sku,
      title,
      description: description || null,
      price: round2(price.value),
      mrp: round2(mrp.value),
      gst_percent: gst.empty ? 0 : round2(gst.value),
      stock_quantity: stock.empty ? 0 : stock.value,
      image_urls: imageUrls,
      video_url: video.value ?? null,
      length_cm: length.value === null ? null : round2(length.value),
      breadth_cm: breadth.value === null ? null : round2(breadth.value),
      height_cm: height.value === null ? null : round2(height.value),
      weight_kg: weight.value === null ? null : round3(weight.value),
      return_policy: returnPolicy.empty ? null : returnPolicy.value,
      is_visible: visibility !== 'false',
      product_type: productType,
      attributes,
      // Goes to the admin-only book_internal table, never to books.
      internal: {
        cost_price: cost.empty ? null : round2(cost.value),
        pickup_address_code: pickup,
      },
    },
  };
}

// Sanitizes every row, yielding to the browser between batches so a large file never
// freezes the page. Rows are numbered from 1 in file order (the header is not a row).
export async function sanitizeCatalogue(rows) {
  const books = [];
  const rejected = [];
  const seenSku = new Set();
  const seenCode = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0 && index % YIELD_EVERY === 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const result = sanitizeRow(rows[index]);
    const label = { row: index + 1, sku: cleanText(rows[index]['Sku Id'] ?? '') || null };
    if (result.reason) {
      rejected.push({ ...label, reason: result.reason });
      continue;
    }
    const { book } = result;
    const skuKey = book.sku.toLowerCase();
    if (seenSku.has(skuKey)) {
      rejected.push({ ...label, reason: 'Sku Id appears earlier in the file' });
      continue;
    }
    if (seenCode.has(book.product_code)) {
      rejected.push({ ...label, reason: 'Product Code appears earlier in the file' });
      continue;
    }
    seenSku.add(skuKey);
    seenCode.add(book.product_code);
    books.push(book);
  }

  return { books, rejected };
}
