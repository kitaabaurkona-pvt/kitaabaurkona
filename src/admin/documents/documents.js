// The admin's printable documents, laid out like the ShopDeck ones the owner uses:
// shipping labels, tax invoices, a picking list and packing slips. Each builder takes
// orders as the Orders page loads them and makes one PDF (previewed, then downloaded).
import { formatOrderNumber } from '../../utils/format';
import qrcode from 'qrcode-generator';
import { CARRIER_NAMES, carrierOf, trackingUrl } from '../../services/shippingService';
import {
  A4,
  BLACK,
  GREY,
  LINE,
  WASH,
  barcode,
  box,
  finish,
  embedLogo,
  hline,
  indiaDate,
  logo,
  money,
  newDocument,
  printable,
  text,
  vline,
  wrap,
} from './pdfTools';

const forwardOf = (order) => (order.shipments ?? []).find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;
const orderTotal = (order) => Number(order.total ?? order.subtotal ?? 0);
const toCollect = (order) => (order.payment_method === 'cod' ? Math.max(0, orderTotal(order) - Number(order.amount_paid ?? 0)) : 0);
const today = () => indiaDate(Date.now());

// Orders a label can be printed for: a booked parcel with an AWB.
export const labelReady = (order) => Boolean(forwardOf(order)?.awb_number);

// The seller details needed on an invoice; returns what is missing.
export function missingInvoiceDetails(settings) {
  const missing = [];
  if (!settings?.invoice_business_name) missing.push('business name');
  if (!settings?.invoice_address) missing.push('address');
  if (!settings?.invoice_gstin) missing.push('GSTIN');
  return missing;
}

// ---------- Shipping label (4 x 6 inch) ----------
// Laid out like a postal label: shop emblem | payment + order + tracking QR, the courier
// and its service, from / ship date / weight, ship to, the courier's sort code above the
// AWB barcode, then contents, invoice, the tamper note and handling marks. The AWB, the
// courier and its sort / routing code come from the courier (courierData, fetched when
// printing); everything else from the order.

export const LABEL_4X6 = [288, 432];

// The courier's service as printed in the banner: "DELHIVERY SURFACE", "XPRESSBEES AIR".
export function courierBanner(parcel) {
  const carrier = carrierOf(parcel);
  const name = String(parcel?.courier_name || CARRIER_NAMES[carrier] || '').trim();
  if (carrier === 'delhivery') return /express/i.test(name) ? 'DELHIVERY EXPRESS' : 'DELHIVERY SURFACE';
  const mode = /air|express/i.test(name) ? 'AIR' : /surface/i.test(name) ? 'SURFACE' : '';
  return `XPRESSBEES${mode ? ` ${mode}` : ''}`;
}

// Text shrunk until it fits `width` (never below `min`).
function fitted(page, value, { x, top, font, size, min = 7, width, align = 'center', color }) {
  let s = size;
  while (s > min && font.widthOfTextAtSize(printable(value), s) > width) s -= 0.5;
  text(page, value, { x, top, font, size: s, width, align, color });
  return s;
}

// A QR code drawn as squares (sharp at any print size).
function qrCode(page, value, { x, top, size }) {
  const qr = qrcode(0, 'M');
  qr.addData(String(value));
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  const pageTop = page.getHeight() - top;
  for (let r = 0; r < n; r += 1) {
    let run = 0;
    for (let c = 0; c <= n; c += 1) {
      if (c < n && qr.isDark(r, c)) {
        run += 1;
        continue;
      }
      if (run) page.drawRectangle({ x: x + (c - run) * cell, y: pageTop - (r + 1) * cell, width: run * cell + 0.05, height: cell + 0.05, color: BLACK });
      run = 0;
    }
  }
}

// Handling marks (24 x 24 drawings): handle with care, this way up, keep dry.
const MARKS = {
  care: ['M7 3 L17 3 L17 12 L7 12 Z M7 6 L17 6', 'M2 11 L2 16 Q2 20 6 20 L18 20 Q22 20 22 16 L22 11', 'M2 15 L7 15 M22 15 L17 15'],
  up: ['M7 20 L7 5 M3 9 L7 4 L11 9', 'M17 20 L17 5 M13 9 L17 4 L21 9', 'M3 22 L21 22'],
  dry: ['M3 12 Q12 2 21 12 Z', 'M12 12 L12 20 Q12 22 10 22 Q8 22 8 20', 'M5 4 L4 6 M9 2 L8 4 M17 3 L16 5 M20 6 L19 8'],
};
function mark(page, kind, { x, top, size }) {
  box(page, { x, top, width: size, height: size, borderWidth: 0.8 });
  const scale = (size - 4) / 24;
  for (const path of MARKS[kind]) page.drawSvgPath(path, { x: x + 2, y: page.getHeight() - top - 2, scale, borderColor: BLACK, borderWidth: 1 });
}

function drawLabel(page, fonts, image, order, invoice, settings, courier) {
  const parcel = forwardOf(order);
  const awb = courier?.awb || parcel.awb_number;
  const [PW, PH] = LABEL_4X6;
  const x = 8;
  const W = PW - 16;
  let top = 8;
  box(page, { x, top, width: W, height: PH - 16, borderWidth: 1.4 });

  // 1. Emblem | payment, order number and the tracking QR code.
  const headH = 86;
  const left = 78;
  if (image) logo(page, image, { x: x + 6, top: top + 7, size: left - 12 });
  else text(page, 'KAK', { x, top: top + 34, font: fonts.bold, size: 22, width: left, align: 'center' });
  vline(page, { x: x + left, top, height: headH, thickness: 1.2 });
  const cod = order.payment_method === 'cod';
  const qr = 70;
  const infoX = x + left + 8;
  const infoW = W - left - qr - 22;
  text(page, cod ? 'COD' : 'PREPAID', { x: infoX, top: top + 9, font: fonts.bold, size: 17 });
  fitted(page, cod ? `Collect Rs. ${money(toCollect(order))}` : 'Do not collect cash', { x: infoX, top: top + 31, font: fonts.bold, size: 11, width: infoW, align: 'left' });
  text(page, 'ORDER', { x: infoX, top: top + 52, font: fonts.regular, size: 7, color: GREY });
  fitted(page, formatOrderNumber(order.order_number), { x: infoX, top: top + 61, font: fonts.bold, size: 12, width: infoW, align: 'left' });
  qrCode(page, trackingUrl({ ...parcel, awb_number: awb }), { x: x + W - qr - 8, top: top + 8, size: qr });
  top += headH;
  hline(page, { x, top, width: W, thickness: 1.2 });

  // 2. The courier and its service, as big as the line allows.
  const bannerH = 30;
  fitted(page, courierBanner(parcel), { x: x + 6, top: top + 7, font: fonts.bold, size: 19, min: 10, width: W - 12 });
  top += bannerH;
  hline(page, { x, top, width: W, thickness: 1.2 });

  // 3. From (the pickup address) with ship date / weight / size, then ship to.
  const fromTop = top;
  const half = W / 2 + 6;
  text(page, 'FROM:', { x: x + 7, top: top + 6, font: fonts.bold, size: 7 });
  let y = top + 15;
  text(page, settings?.pickup_name || 'Kitaabaurkona', { x: x + 7, top: y, font: fonts.bold, size: 8.5 });
  y += 10;
  for (const line of wrap(settings?.pickup_address, fonts.regular, 7.5, half - 18, 3)) {
    text(page, line, { x: x + 7, top: y, font: fonts.regular, size: 7.5 });
    y += 9;
  }
  const fromCity = [settings?.pickup_city, settings?.pickup_state].filter(Boolean).join(', ');
  text(page, `${fromCity}${settings?.pickup_pincode ? ` ${settings.pickup_pincode}` : ''}`, { x: x + 7, top: y, font: fonts.regular, size: 7.5 });
  y += 9;
  if (settings?.pickup_phone) text(page, `Ph. ${settings.pickup_phone}`, { x: x + 7, top: y, font: fonts.regular, size: 7.5 });
  const facts = [['SHIP DATE', today()]];
  if (Number(parcel?.package_weight_g) > 0) facts.push(['WEIGHT', `${(Number(parcel.package_weight_g) / 1000).toFixed(2)} KG`]);
  const dims = [parcel?.package_length_cm, parcel?.package_breadth_cm, parcel?.package_height_cm];
  if (dims.every((d) => Number(d) > 0)) facts.push(['SIZE', `${dims.map((d) => money(d)).join(' x ')} CM`]);
  facts.forEach(([k, v], i) => {
    text(page, `${k}:`, { x: x + half, top: fromTop + 7 + i * 15, font: fonts.bold, size: 7 });
    text(page, v, { x: x + half + 46, top: fromTop + 6 + i * 15, font: fonts.regular, size: 8.5 });
  });

  top = Math.max(y + 14, fromTop + 62);
  const toX = x + 62;
  const toW = W - (toX - x) - 8;
  text(page, 'SHIP', { x: x + 7, top: top + 1, font: fonts.bold, size: 12, width: 48, align: 'right' });
  text(page, 'TO:', { x: x + 7, top: top + 14, font: fonts.bold, size: 12, width: 48, align: 'right' });
  y = top;
  for (const line of wrap(order.shipping_name, fonts.bold, 11, toW, 2)) {
    text(page, line, { x: toX, top: y, font: fonts.bold, size: 11 });
    y += 13;
  }
  for (const line of wrap(order.shipping_address, fonts.regular, 8.5, toW, 3)) {
    text(page, line, { x: toX, top: y, font: fonts.regular, size: 8.5 });
    y += 10.5;
  }
  for (const line of wrap(`${order.shipping_city}, ${order.shipping_state}`, fonts.regular, 8.5, toW, 1)) {
    text(page, line, { x: toX, top: y, font: fonts.regular, size: 8.5 });
    y += 11;
  }
  text(page, `PIN ${order.shipping_pincode}`, { x: toX, top: y, font: fonts.bold, size: 12 });
  y += 15;
  text(page, `M.No. ${order.shipping_phone}`, { x: toX, top: y, font: fonts.regular, size: 8.5 });
  if (order.alt_phone) text(page, `Alt. ${order.alt_phone}`, { x: toX + 100, top: y, font: fonts.regular, size: 8.5 });
  top = y + 15;
  hline(page, { x, top, width: W, thickness: 2 });

  // 4. The courier's sort / routing code over the AWB barcode.
  const code = courier?.routing_code || parcel?.routing_code || '';
  const codeLabel = carrierOf(parcel) === 'delhivery' ? 'SORT CODE' : 'ROUTING CODE';
  if (code) fitted(page, `${codeLabel}: ${code}`, { x: x + 6, top: top + 6, font: fonts.bold, size: 13, min: 8, width: W - 12 });
  else text(page, 'AWB', { x: x + 6, top: top + 7, font: fonts.bold, size: 11, width: W - 12, align: 'center' });
  // The barcode takes the room left above the order row and footer (72 pt), within 26-66
  // pt (a very long address leaves it the least).
  const bottom = PH - 8;
  const barTop = top + 24;
  const barH = Math.min(66, Math.max(26, bottom - 72 - barTop - 19));
  barcode(page, awb, { x: x + 14, top: barTop, width: W - 28, height: barH });
  text(page, `AWB: ${awb}`, { x, top: barTop + barH + 4, font: fonts.bold, size: 11.5, width: W, align: 'center' });
  top = barTop + barH + 19;
  hline(page, { x, top, width: W, thickness: 1.2 });

  // 5. The order as the courier knows it (KAK-<number>, sent at booking) as a barcode,
  // like the order ID barcode on the couriers' own labels, beside the invoice and counts.
  const courierOrder = `KAK-${order.order_number}`;
  const obX = x + 12;
  const obW = 132;
  const rowH = 40;
  barcode(page, courierOrder, { x: obX, top: top + 5, width: obW, height: 22 });
  text(page, `ORDER ID: ${courierOrder}`, { x: obX, top: top + 30, font: fonts.bold, size: 7, width: obW, align: 'center' });
  const rx = obX + obW + 12;
  const rw = x + W - rx - 12;
  vline(page, { x: rx, top, height: rowH });
  const skus = order.order_items.length;
  const quantity = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  text(page, 'INVOICE', { x: rx + 6, top: top + 5, font: fonts.regular, size: 6, color: GREY });
  fitted(page, invoice?.invoice_number || '-', { x: rx + 6, top: top + 13, font: fonts.bold, size: 8.5, min: 6, width: rw, align: 'left' });
  text(page, `SKUs: ${skus}   Qty: ${quantity}`, { x: rx + 6, top: top + 27, font: fonts.bold, size: 7 });
  top += rowH;
  hline(page, { x, top, width: W, thickness: 1.2 });

  // 6. Contents, the tamper note and handling marks.
  const markSize = 18;
  const notesW = W - (markSize * 3 + 8) - 18;
  y = top + 4;
  const first = order.order_items[0];
  const more = skus > 1 ? ` + ${skus - 1} more` : '';
  for (const line of wrap(`Contents: ${first ? `${first.title}${more}` : '-'}`, fonts.regular, 6.8, notesW, 1)) {
    text(page, line, { x: x + 6, top: y, font: fonts.regular, size: 6.8 });
    y += 8.5;
  }
  fitted(page, 'Do not accept if the packaging or label is tampered or damaged.', { x: x + 6, top: y, font: fonts.regular, size: 6.3, min: 5, width: notesW, align: 'left' });
  const markTop = top + Math.max(3, Math.min(8, (bottom - top - markSize) / 2));
  ['dry', 'up', 'care'].forEach((kind, i) => mark(page, kind, { x: x + W - 6 - markSize - i * (markSize + 4), top: markTop, size: markSize }));
}

export async function makeLabels(orders, invoices, settings, courierData = {}) {
  const { doc, fonts } = await newDocument('Shipping labels');
  const image = await embedLogo(doc);
  for (const order of orders) {
    const page = doc.addPage(LABEL_4X6);
    drawLabel(page, fonts, image, order, invoices[order.id], settings, courierData[order.id]);
  }
  const name = orders.length === 1 ? `label-${formatOrderNumber(orders[0].order_number)}` : `labels-${orders.length}-orders-${today()}`;
  return finish(doc, `${name}.pdf`);
}

// ---------- Tax invoice ----------

// Splits the order's discount over its lines (largest share last) so the lines add up
// to exactly what the customer paid.
function invoiceLines(order) {
  const lines = order.order_items.map((item) => ({ item, gross: Number(item.unit_price) * item.quantity }));
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const discount = Math.min(Number(order.discount_total ?? 0), gross);
  let left = Math.round(discount * 100);
  lines.forEach((line, i) => {
    const share = i === lines.length - 1 ? left : Math.round((discount * 100 * line.gross) / (gross || 1));
    line.discount = Math.min(share, left) / 100;
    left -= Math.round(line.discount * 100);
    line.amount = Math.round((line.gross - line.discount) * 100) / 100;
  });
  const other = Number(order.other_charges ?? 0);
  if (other > 0) lines.push({ item: { title: 'Shipping / cash on delivery charges', sku: '', quantity: 1, unit_price: other }, gross: other, discount: 0, amount: other });
  return lines;
}

function drawInvoice(page, fonts, image, order, invoice, settings) {
  const parcel = forwardOf(order);
  const x = 18;
  const W = A4[0] - 36;
  const sameState = (settings.invoice_state || '').trim().toLowerCase() === (order.shipping_state || '').trim().toLowerCase();
  const tax = sameState ? ['CGST@0%=0', 'SGST@0%=0'] : ['IGST@0%=0'];

  text(page, 'Tax Invoice (Original for Recipient)', { x, top: 40, font: fonts.bold, size: 17, width: A4[0] - 36, align: 'center' });
  logo(page, image, { x: x + W - 140, top: 80, size: 60 });
  text(page, `Invoice No: ${invoice.invoice_number}`, { x: x + 10, top: 160, font: fonts.regular, size: 11 });
  text(page, `Invoice Date: ${indiaDate(invoice.issued_at)}`, { x: x + W / 2 + 10, top: 160, font: fonts.regular, size: 11 });

  // Sold by / Bill to.
  const top = 178;
  const half = W / 2;
  const sold = [
    ['Company Name', settings.invoice_business_name],
    ['Seller Address', settings.invoice_address],
    ['Ph No', settings.invoice_phone],
    ['GSTIN', settings.invoice_gstin],
    ['PAN', settings.invoice_pan],
    ['Delivery Partner', parcel ? parcel.courier_name || CARRIER_NAMES[carrierOf(parcel)] : ''],
    ['AWB', parcel?.awb_number],
  ].filter(([, v]) => v);
  const bill = [
    ['Customer Name', order.shipping_name],
    ['Customer Address', `${order.shipping_address}, ${order.shipping_city} ${order.shipping_pincode}`],
    ['Mobile No', order.shipping_phone],
    ['Place of Supply', order.shipping_state],
    ['Order ID', formatOrderNumber(order.order_number)],
    ['Order Via', 'kitaabaurkona.com'],
  ];
  const column = (rows, left) => {
    let y = top + 42;
    for (const [label, value] of rows) {
      const lines = wrap(`${label}: ${value}`, fonts.regular, 10.5, half - 40, 3);
      lines.forEach((line, i) => text(page, line, { x: left + 18, top: y + i * 14, font: fonts.regular, size: 10.5 }));
      y += lines.length * 14 + 10;
    }
    return y;
  };
  text(page, 'Sold By:', { x: x + 12, top: top + 16, font: fonts.bold, size: 13 });
  text(page, 'Bill to:', { x: x + half + 12, top: top + 16, font: fonts.bold, size: 13 });
  const bottom = Math.max(column(sold, x), column(bill, x + half)) + 4;
  box(page, { x, top, width: W, height: bottom - top, border: LINE });
  vline(page, { x: x + half, top, height: bottom - top, color: LINE });

  // Lines.
  const cols = [
    ['Sr .No', 40, 'right'],
    ['Product', 130, 'right'],
    ['Unit Price', 64, 'right'],
    ['Qty', 34, 'right'],
    ['Discount', 48, 'right'],
    ['Amount', 64, 'right'],
    ['Taxes', 100, 'center'],
    ['Total', 0, 'right'],
  ];
  cols[cols.length - 1][1] = W - cols.reduce((s, c) => s + c[1], 0);
  const lefts = [];
  cols.reduce((left, c) => (lefts.push(left), left + c[1]), x);
  let y = bottom + 24;
  const head = 16;
  const lines = invoiceLines(order);
  const rowLines = lines.map((l) => wrap(`${l.item.title}${l.item.sku ? ` - (${l.item.sku})` : ''}`, fonts.regular, 8.5, cols[1][1] - 8, 5));
  const rowHeights = rowLines.map((r) => Math.max(r.length * 11 + 12, 34));
  const bodyH = rowHeights.reduce((s, h) => s + h, 0);
  const totalH = 30;
  box(page, { x, top: y, width: W, height: head + bodyH + totalH });
  cols.forEach(([label, width], i) => {
    text(page, label, { x: lefts[i], top: y + 4, font: fonts.bold, size: 8.5, width, align: 'center' });
    if (i > 0) vline(page, { x: lefts[i], top: y, height: head + bodyH });
  });
  hline(page, { x, top: y + head, width: W, color: LINE });
  let rowTop = y + head;
  lines.forEach((l, r) => {
    const cell = (i, value, font = fonts.regular) => text(page, value, { x: lefts[i] + 4, top: rowTop + 8, font, size: 8.5, width: cols[i][1] - 8, align: cols[i][2] });
    cell(0, String(r + 1));
    rowLines[r].forEach((line, i) => text(page, line, { x: lefts[1] + 4, top: rowTop + 8 + i * 11, font: fonts.regular, size: 8.5, width: cols[1][1] - 8, align: 'right' }));
    cell(2, money(l.item.unit_price));
    cell(3, String(l.item.quantity));
    cell(4, money(l.discount));
    cell(5, money(l.amount));
    tax.forEach((line, i) => text(page, line, { x: lefts[6] + 2, top: rowTop + 8 + i * 10, font: fonts.regular, size: 8, width: cols[6][1] - 4, align: 'center' }));
    cell(7, money(l.amount));
    rowTop += rowHeights[r];
  });
  hline(page, { x, top: rowTop, width: W });
  const qty = lines.reduce((s, l) => s + l.item.quantity, 0);
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  text(page, 'Total:', { x: x + 12, top: rowTop + 11, font: fonts.regular, size: 9 });
  vline(page, { x: lefts[2], top: rowTop, height: totalH });
  text(page, String(qty), { x: lefts[2], top: rowTop + 11, font: fonts.regular, size: 9, width: lefts[5] - lefts[2], align: 'center' });
  vline(page, { x: lefts[5], top: rowTop, height: totalH });
  text(page, money(amount), { x: lefts[5] + 4, top: rowTop + 11, font: fonts.regular, size: 9, width: cols[5][1] - 8, align: 'right' });
  vline(page, { x: lefts[6], top: rowTop, height: totalH });
  text(page, '0', { x: lefts[6] + 4, top: rowTop + 11, font: fonts.regular, size: 9, width: cols[6][1] - 8, align: 'right' });
  vline(page, { x: lefts[7], top: rowTop, height: totalH });
  text(page, money(amount), { x: lefts[7] + 4, top: rowTop + 11, font: fonts.regular, size: 9, width: cols[7][1] - 8, align: 'right' });

  text(page, 'This is a computer-generated document and does not require a signature', { x, top: rowTop + totalH + 28, font: fonts.regular, size: 10.5, width: A4[0] - 36, align: 'center' });
}

export async function makeInvoices(orders, invoices, settings) {
  const { doc, fonts } = await newDocument('Tax invoices');
  const image = await embedLogo(doc);
  let count = 0;
  for (const order of orders) {
    if (!invoices[order.id]) continue;
    drawInvoice(doc.addPage(A4), fonts, image, order, invoices[order.id], settings);
    count += 1;
  }
  if (count === 0) return null;
  const first = orders.find((o) => invoices[o.id]);
  const name = count === 1 ? `invoice-${printable(invoices[first.id].invoice_number).replace(/\//g, '-')}` : `invoices-${count}-orders-${today()}`;
  return finish(doc, `${name}.pdf`);
}

// ---------- Picking list ----------

const copiesText = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

export async function makePickList(orders) {
  const { doc, fonts } = await newDocument('Picking list');
  const bySku = new Map();
  for (const order of orders) {
    for (const item of order.order_items) {
      const row = bySku.get(item.sku) ?? { sku: item.sku, title: item.title, quantity: 0, orders: [] };
      row.quantity += item.quantity;
      row.orders.push(formatOrderNumber(order.order_number));
      bySku.set(item.sku, row);
    }
  }
  const rows = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true }));
  const x = 30;
  const W = A4[0] - 60;
  const cols = [
    ['', 22],
    ['SKU', 110],
    ['Book', 0],
    ['Qty', 44],
  ];
  cols[2][1] = W - cols.reduce((s, c) => s + c[1], 0);
  let page = doc.addPage(A4);
  let top = 36;
  const header = () => {
    text(page, 'Picking list', { x, top, font: fonts.bold, size: 18 });
    text(page, `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} · ${rows.length} ${rows.length === 1 ? 'book' : 'different books'} · ${copiesText(rows.reduce((s, r) => s + r.quantity, 0))} · ${today()}`, {
      x,
      top: top + 24,
      font: fonts.regular,
      size: 10,
      color: GREY,
    });
    top += 50;
    box(page, { x, top, width: W, height: 20, fill: WASH, border: LINE });
    let left = x;
    for (const [label, width] of cols) {
      text(page, label, { x: left + 6, top: top + 6, font: fonts.bold, size: 9.5, width: width - 12, align: label === 'Qty' ? 'right' : 'left' });
      left += width;
    }
    top += 20;
  };
  header();
  for (const row of rows) {
    const title = wrap(row.title, fonts.regular, 10, cols[2][1] - 12, 2);
    const orderLine = wrap(`Orders: ${row.orders.join(', ')}`, fonts.regular, 8, cols[2][1] - 12, 2);
    const h = title.length * 13 + orderLine.length * 10 + 12;
    if (top + h > A4[1] - 36) {
      page = doc.addPage(A4);
      top = 36;
      header();
    }
    box(page, { x: x + 6, top: top + 7, width: 11, height: 11, border: GREY, borderWidth: 0.8 });
    text(page, row.sku, { x: x + cols[0][1] + 6, top: top + 7, font: fonts.bold, size: 10 });
    title.forEach((line, i) => text(page, line, { x: x + cols[0][1] + cols[1][1] + 6, top: top + 7 + i * 13, font: fonts.regular, size: 10 }));
    orderLine.forEach((line, i) => text(page, line, { x: x + cols[0][1] + cols[1][1] + 6, top: top + 9 + title.length * 13 + i * 10, font: fonts.regular, size: 8, color: GREY }));
    text(page, `x ${row.quantity}`, { x: x + W - cols[3][1], top: top + 6, font: fonts.bold, size: 12, width: cols[3][1] - 6, align: 'right' });
    top += h;
    hline(page, { x, top, width: W, color: LINE });
  }
  return finish(doc, `picking-list-${today()}.pdf`);
}

// ---------- Packing slips (three to a page, cut along the dashes) ----------

export async function makePackingSlips(orders) {
  const { doc, fonts } = await newDocument('Packing slips');
  const image = await embedLogo(doc);
  const x = 30;
  const W = A4[0] - 60;
  const slotH = (A4[1] - 40) / 3;
  let page = null;
  orders.forEach((order, index) => {
    const slot = index % 3;
    if (slot === 0) page = doc.addPage(A4);
    let top = 20 + slot * slotH + 14;
    if (slot > 0) {
      const y = A4[1] - (20 + slot * slotH);
      page.drawLine({ start: { x: 10, y }, end: { x: A4[0] - 10, y }, thickness: 0.6, color: GREY, dashArray: [4, 4] });
    }
    logo(page, image, { x: x + W - 40, top, size: 40 });
    text(page, 'Packing slip', { x, top, font: fonts.bold, size: 14 });
    text(page, `${formatOrderNumber(order.order_number)} · ${indiaDate(order.created_at)}`, { x, top: top + 19, font: fonts.regular, size: 10 });
    text(page, `${order.shipping_name}, ${order.shipping_city}`, { x, top: top + 33, font: fonts.regular, size: 10, color: GREY });
    top += 54;
    box(page, { x, top, width: W, height: 18, fill: WASH, border: LINE });
    text(page, 'Book', { x: x + 6, top: top + 5, font: fonts.bold, size: 9 });
    text(page, 'SKU', { x: x + W - 160, top: top + 5, font: fonts.bold, size: 9 });
    text(page, 'Qty', { x: x + W - 46, top: top + 5, font: fonts.bold, size: 9, width: 40, align: 'right' });
    top += 18;
    const limit = slotH - 100;
    let used = 0;
    let shown = 0;
    for (const item of order.order_items) {
      const lines = wrap(item.title, fonts.regular, 9.5, W - 180, 2);
      const h = lines.length * 12 + 6;
      if (used + h > limit) break;
      lines.forEach((line, i) => text(page, line, { x: x + 6, top: top + 4 + i * 12, font: fonts.regular, size: 9.5 }));
      text(page, item.sku, { x: x + W - 160, top: top + 4, font: fonts.regular, size: 9.5 });
      text(page, String(item.quantity), { x: x + W - 46, top: top + 4, font: fonts.bold, size: 9.5, width: 40, align: 'right' });
      top += h;
      used += h;
      shown += 1;
      hline(page, { x, top, width: W, color: LINE });
    }
    const rest = order.order_items.length - shown;
    if (rest > 0) text(page, `+ ${rest} more (see the invoice)`, { x: x + 6, top: top + 4, font: fonts.italic, size: 9 });
    const copies = order.order_items.reduce((s, i) => s + i.quantity, 0);
    text(page, `${copies} ${copies === 1 ? 'book' : 'books'} in this parcel`, { x, top: 20 + (slot + 1) * slotH - 26, font: fonts.italic, size: 9, color: GREY });
  });
  return finish(doc, `packing-slips-${today()}.pdf`);
}

