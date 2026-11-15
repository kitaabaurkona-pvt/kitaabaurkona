// The admin book editor's form: turning a book into form values and checking the values
// before they are saved. The limits mirror supabase/schema.sql, so the database never
// has to refuse a save the form allowed.

import { cleanText, parseAmount } from './catalogueSanitizer';

const MAX_AMOUNT = 99999999.99;
const ATTRIBUTE_KEYS = ['author', 'brand', 'genre', 'ideal_for', 'pack_of', 'country_of_origin'];
const text = (value) => (value === null || value === undefined ? '' : String(value));

export function emptyBookForm() {
  return toBookForm({ is_visible: true, attributes: {}, image_urls: [], internal: {} });
}

export function toBookForm(book) {
  const attributes = book.attributes ?? {};
  return {
    title: text(book.title),
    description: text(book.description),
    category: text(book.category),
    sku: text(book.sku),
    product_code: text(book.product_code),
    price: text(book.price),
    mrp: text(book.mrp),
    gst_percent: book.gst_percent === undefined ? '' : text(book.gst_percent),
    stock_quantity: text(book.stock_quantity),
    is_visible: book.is_visible !== false,
    length_cm: text(book.length_cm),
    breadth_cm: text(book.breadth_cm),
    height_cm: text(book.height_cm),
    weight_kg: text(book.weight_kg),
    return_policy: text(book.return_policy),
    cost_price: text(book.internal?.cost_price),
    pickup_address_code: text(book.internal?.pickup_address_code),
    ...Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, text(attributes[key])])),
  };
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// Returns { errors } (field name -> message, in form order) or { fields, internal }.
// otherAttributes keeps attribute keys this form does not show (they are left as they were).
export function validateBookForm(form, { otherAttributes = {} } = {}) {
  const errors = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  const title = cleanText(form.title);
  if (!title) fail('title', 'Enter the book name.');
  else if (title.length > 300) fail('title', 'Keep the name under 300 characters.');

  const description = cleanText(form.description, { multiline: true });
  if (description.length > 5000) fail('description', 'Keep the description under 5,000 characters.');

  const amount = (field, label, { required = false, max = MAX_AMOUNT, whole = false } = {}) => {
    const parsed = parseAmount(form[field]);
    if (parsed.empty) {
      if (required) fail(field, `Enter the ${label}.`);
      return null;
    }
    if (parsed.invalid || parsed.value > max) {
      fail(field, `Enter the ${label} as a number.`);
      return null;
    }
    if (whole && !Number.isInteger(parsed.value)) {
      fail(field, `The ${label} must be a whole number.`);
      return null;
    }
    return parsed.value;
  };

  const price = amount('price', 'selling price', { required: true });
  const mrp = amount('mrp', 'MRP', { required: true });
  if (price !== null && mrp !== null && price > mrp) fail('price', 'The selling price cannot be more than the MRP.');
  const gst = amount('gst_percent', 'GST %', { max: 100 });
  const cost = amount('cost_price', 'cost price');

  const stock = amount('stock_quantity', 'stock', { required: true, max: 2147483647, whole: true });

  const sku = cleanText(form.sku);
  if (!sku) fail('sku', 'Enter a SKU (your own code for this book).');
  else if (sku.length > 64) fail('sku', 'Keep the SKU under 64 characters.');
  const productCode = cleanText(form.product_code) || sku;
  if (productCode.length > 64) fail('product_code', 'Keep the product code under 64 characters.');

  const positive = (field, label, places) => {
    const value = amount(field, label, { max: 99999 });
    if (value === null || value === 0) return null; // empty or 0 means "not given"
    return round(value, places);
  };
  const length = positive('length_cm', 'length', 2);
  const breadth = positive('breadth_cm', 'breadth', 2);
  const height = positive('height_cm', 'height', 2);
  const weight = positive('weight_kg', 'weight', 3);
  const returnDays = amount('return_policy', 'return days', { max: 100, whole: true });

  const attributes = { ...otherAttributes };
  for (const key of ATTRIBUTE_KEYS) {
    const value = cleanText(form[key]).slice(0, 100);
    if (value) attributes[key] = value;
    else delete attributes[key];
  }
  const category = cleanText(form.category).slice(0, 100);
  const pickup = cleanText(form.pickup_address_code).slice(0, 64);

  if (Object.keys(errors).length > 0) return { errors };

  return {
    fields: {
      title,
      description: description || null,
      category: category || null,
      sku,
      product_code: productCode,
      price: round(price, 2),
      mrp: round(mrp, 2),
      gst_percent: gst === null ? 0 : round(gst, 2),
      stock_quantity: stock,
      is_visible: Boolean(form.is_visible),
      length_cm: length,
      breadth_cm: breadth,
      height_cm: height,
      weight_kg: weight,
      return_policy: returnDays,
      attributes,
    },
    internal: { cost_price: cost === null ? null : round(cost, 2), pickup_address_code: pickup || null },
  };
}

// The attribute keys this form edits; anything else in books.attributes is kept as is.
export function otherAttributesOf(book) {
  return Object.fromEntries(Object.entries(book?.attributes ?? {}).filter(([key]) => !ATTRIBUTE_KEYS.includes(key)));
}

// "Customers save 25%" when both prices are valid and there is a discount.
export function discountOf(form) {
  const price = parseAmount(form.price);
  const mrp = parseAmount(form.mrp);
  if (price.empty || price.invalid || mrp.empty || mrp.invalid || mrp.value <= 0 || price.value >= mrp.value) return 0;
  return Math.floor((1 - price.value / mrp.value) * 100);
}
