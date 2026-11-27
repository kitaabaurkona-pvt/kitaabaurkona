// The admin's printable documents, laid out like the ShopDeck ones the owner uses:
// shipping labels, tax invoices, a picking list and packing slips. Each builder takes
// orders as the Orders page loads them and downloads one PDF.
import { formatOrderNumber } from '../../utils/format';
import { CARRIER_NAMES, carrierOf } from '../../services/shippingService';
import {
  A4,
  GREY,
  LINE,
  WASH,
  barcode,
  box,
  download,
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

// ---------- Shipping label ----------

function drawLabel(page, fonts, image, order, invoice, settings) {
  const parcel = forwardOf(order);
  const x = 18;
  const W = A4[0] - 36;
  let top = 18;

  // 1. To (the customer) and the shop's emblem.
  const toHeight = 150;
  box(page, { x, top, width: W, height: toHeight });
  text(page, 'To:', { x: x + 10, top: top + 10, font: fonts.italic, size: 10 });
  text(page, order.shipping_name, { x: x + 10, top: top + 26, font: fonts.boldItalic, size: 18 });
  let y = top + 50;
  for (const line of wrap(order.shipping_address, fonts.italic, 11, 360, 3)) {
    text(page, line, { x: x + 10, top: y, font: fonts.italic, size: 11 });
    y += 14;
  }
  text(page, `${order.shipping_city}, ${order.shipping_state}`, { x: x + 10, top: y, font: fonts.italic, size: 11 });
  y += 15;
  text(page, order.shipping_pincode, { x: x + 10, top: y, font: fonts.boldItalic, size: 13 });
  y += 17;
  text(page, `M.No. ${order.shipping_phone}`, { x: x + 10, top: y, font: fonts.italic, size: 11 });
  logo(page, image, { x: x + W - 110, top: top + 25, size: 80 });
  top += toHeight;

  // 2. Parcel size and weight, the courier's sort code, the AWB barcode.
  const awbHeight = 100;
  box(page, { x, top, width: W, height: awbHeight });
  const dims = [parcel?.package_length_cm, parcel?.package_breadth_cm, parcel?.package_height_cm];
  if (dims.every((d) => Number(d) > 0)) text(page, `Dimensions: ${dims.map((d) => money(d)).join('*')} CM`, { x: x + 10, top: top + 30, font: fonts.regular, size: 10 });
  if (Number(parcel?.package_weight_g) > 0) text(page, `Weight: ${(Number(parcel.package_weight_g) / 1000).toFixed(2)} KG`, { x: x + 10, top: top + 45, font: fonts.regular, size: 10 });
  if (parcel?.routing_code) {
    text(page, 'Sort code', { x: x + 10, top: top + 62, font: fonts.regular, size: 8, color: GREY });
    text(page, parcel.routing_code, { x: x + 10, top: top + 72, font: fonts.bold, size: 14 });
  }
  text(page, `AWB: ${parcel.awb_number}`, { x: x + 250, top: top + 8, font: fonts.regular, size: 12, width: W - 260, align: 'center' });
  barcode(page, parcel.awb_number, { x: x + 250, top: top + 25, width: W - 260, height: 66 });
  top += awbHeight;

  // 3. Payment and courier.
  box(page, { x, top, width: W, height: 22, fill: WASH });
  const cod = order.payment_method === 'cod';
  text(page, cod ? 'COD' : 'PREPAID', { x: x + 8, top: top + 7, font: fonts.bold, size: 10 });
  text(page, cod ? `(Collectable Value: Rs. ${money(toCollect(order))})` : '(Do not collect cash)', { x: x + (cod ? 38 : 60), top: top + 7, font: fonts.regular, size: 10 });
  const courier = (parcel.courier_name || CARRIER_NAMES[carrierOf(parcel)]).toUpperCase();
  text(page, courier, { x: x + 8, top: top + 7, font: fonts.bold, size: 10, width: W - 16, align: 'right' });
  top += 22;

  // 4. Counts and the order number.
  const skus = order.order_items.length;
  const quantity = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  box(page, { x, top, width: W, height: 36 });
  text(page, `Number of Skus: ${skus}`, { x: x + 8, top: top + 13, font: fonts.bold, size: 10 });
  text(page, `Total Quantity: ${quantity}`, { x: x + 170, top: top + 13, font: fonts.bold, size: 10 });
  text(page, 'Order Id:', { x: x + 8, top: top + 5, font: fonts.bold, size: 10, width: W - 16, align: 'right' });
  text(page, formatOrderNumber(order.order_number), { x: x + 8, top: top + 19, font: fonts.bold, size: 11, width: W - 16, align: 'right' });
  top += 36;

  // 5. Invoice number barcode, then the books.
  const tableTop = top;
  const rowsMax = 8;
  const items = order.order_items.slice(0, rowsMax);
  const extra = order.order_items.length - items.length;
  const columns = [
    ['Product Name', 0, 300],
    ['SKU ID', 300, 140],
    ['Qty', 440, 36],
    ['Total Price', 476, W - 12 - 476],
  ];
  const tableX = x + 6;
  const tableW = W - 12;
  let rowTop = tableTop + 70;
  const rows = items.map((item) => ({
    name: wrap(`${item.title}`, fonts.regular, 9.5, 290, 2),
    sku: wrap(item.sku, fonts.regular, 9.5, 130, 2),
    qty: String(item.quantity),
    price: money(Number(item.unit_price) * item.quantity),
  }));
  const bodyHeight = rows.reduce((h, r) => h + Math.max(r.name.length, r.sku.length) * 12 + 8, 0) + (extra > 0 ? 18 : 0);
  const sectionHeight = 70 + 26 + bodyHeight + 8;
  box(page, { x, top, width: W, height: sectionHeight });
  if (invoice) {
    barcode(page, invoice.invoice_number, { x: x + W - 230, top: top + 8, width: 220, height: 30 });
    text(page, `Invoice No.: ${invoice.invoice_number}`, { x: x + 8, top: top + 42, font: fonts.regular, size: 8.5, width: W - 18, align: 'right' });
    text(page, `Invoice Date: ${indiaDate(invoice.issued_at)}`, { x: x + 8, top: top + 54, font: fonts.regular, size: 8.5, width: W - 18, align: 'right' });
  }
  box(page, { x: tableX, top: rowTop, width: tableW, height: 26 + bodyHeight });
  for (const [title, left, width] of columns) {
    text(page, title, { x: tableX + left, top: rowTop + 9, font: fonts.bold, size: 10, width, align: 'center' });
    if (left > 0) vline(page, { x: tableX + left, top: rowTop, height: 26 + bodyHeight });
  }
  hline(page, { x: tableX, top: rowTop + 26, width: tableW });
  rowTop += 26;
  for (const row of rows) {
    const h = Math.max(row.name.length, row.sku.length) * 12 + 8;
    row.name.forEach((line, i) => text(page, line, { x: tableX + 5, top: rowTop + 5 + i * 12, font: fonts.regular, size: 9.5 }));
    row.sku.forEach((line, i) => text(page, line, { x: tableX + 300, top: rowTop + 5 + i * 12, font: fonts.regular, size: 9.5, width: 140, align: 'center' }));
    text(page, row.qty, { x: tableX + 440, top: rowTop + 5, font: fonts.regular, size: 9.5, width: 36, align: 'center' });
    text(page, row.price, { x: tableX + 476, top: rowTop + 5, font: fonts.regular, size: 9.5, width: tableW - 476, align: 'center' });
    rowTop += h;
    hline(page, { x: tableX, top: rowTop, width: tableW, color: LINE });
  }
  if (extra > 0) text(page, `+ ${extra} more ${extra === 1 ? 'book' : 'books'} (see the invoice)`, { x: tableX + 5, top: rowTop + 4, font: fonts.italic, size: 9 });
  top += sectionHeight;

  // 6. Notes.
  box(page, { x, top, width: W, height: 34 });
  text(page, 'NOTE: If outer packaging/label is found tampered/damaged, do not accept parcel.', { x: x + 8, top: top + 6, font: fonts.regular, size: 9 });
  text(page, `All disputes are subject to ${settings?.invoice_state || 'Rajasthan'} jurisdiction only.`, { x: x + 8, top: top + 19, font: fonts.regular, size: 9 });
}

export async function downloadLabels(orders, invoices, settings) {
  const { doc, fonts } = await newDocument('Shipping labels');
  const image = await embedLogo(doc);
  for (const order of orders) {
    const page = doc.addPage(A4);
    drawLabel(page, fonts, image, order, invoices[order.id], settings);
  }
  const name = orders.length === 1 ? `label-${formatOrderNumber(orders[0].order_number)}` : `labels-${orders.length}-orders-${today()}`;
  await download(doc, `${name}.pdf`);
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

export async function downloadInvoices(orders, invoices, settings) {
  const { doc, fonts } = await newDocument('Tax invoices');
  const image = await embedLogo(doc);
  let count = 0;
  for (const order of orders) {
    if (!invoices[order.id]) continue;
    drawInvoice(doc.addPage(A4), fonts, image, order, invoices[order.id], settings);
    count += 1;
  }
  if (count === 0) return 0;
  const first = orders.find((o) => invoices[o.id]);
  const name = count === 1 ? `invoice-${printable(invoices[first.id].invoice_number).replace(/\//g, '-')}` : `invoices-${count}-orders-${today()}`;
  await download(doc, `${name}.pdf`);
  return count;
}

// ---------- Picking list ----------

const copiesText = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

export async function downloadPickList(orders) {
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
  await download(doc, `picking-list-${today()}.pdf`);
}

// ---------- Packing slips (three to a page, cut along the dashes) ----------

export async function downloadPackingSlips(orders) {
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
  await download(doc, `packing-slips-${today()}.pdf`);
}

