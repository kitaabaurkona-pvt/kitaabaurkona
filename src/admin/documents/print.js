// Makes one kind of document for some orders: gives invoice numbers where needed, reads
// the seller details and draws ONE PDF for all of them (a page per label or invoice). The
// PDF is shown in a preview; the admin downloads or prints it from there. Loaded only when
// the admin prints something, so the PDF code is not part of the panel's first download.
import { adminIssueInvoices } from '../../services/adminService';
import { getLabelData, getShippingSettings } from '../../services/shippingService';
import { labelReady, makeInvoices, makeLabels, makePackingSlips, makePickList, missingInvoiceDetails } from './documents';

export { saveFile } from './pdfTools';

// kind: 'labels' | 'invoices' | 'picklist' | 'slips'. Returns { file, printed, skipped }:
// file is { blob, fileName, pages } (null when nothing could be printed), printed the
// orders in it and skipped the ones left out, with why.
export async function makeDocuments(kind, orders) {
  if (kind === 'picklist') return { file: await makePickList(orders), printed: orders, skipped: [] };
  if (kind === 'slips') return { file: await makePackingSlips(orders), printed: orders, skipped: [] };

  const settings = await getShippingSettings();
  if (kind === 'invoices') {
    const missing = missingInvoiceDetails(settings);
    if (missing.length) throw new Error(`Fill in the invoice details first (Shipping > Invoice details): ${missing.join(', ')}.`);
  }
  const wanted = kind === 'labels' ? orders.filter(labelReady) : orders.filter((o) => !['pending_payment', 'cancelled'].includes(o.status));
  const skipped = orders.filter((o) => !wanted.includes(o));
  if (wanted.length === 0) return { file: null, printed: [], skipped };

  const invoices = await adminIssueInvoices(wanted.map((o) => o.id));
  if (kind === 'invoices') return { file: await makeInvoices(wanted, invoices, settings), printed: wanted, skipped };

  // The couriers' own label data (sort / routing code). Labels still print without it:
  // the AWB barcode is what the courier scans.
  let courierData = {};
  let courierError = '';
  try {
    courierData = await getLabelData(wanted.map((o) => o.id));
  } catch (err) {
    courierError = err.message;
  }
  const file = await makeLabels(wanted, invoices, settings, courierData);
  // Orders whose label has no sort / routing code, and why (shown to the admin).
  const noCode = wanted.filter((o) => !courierData[o.id]?.routing_code);
  const why = courierError || [...new Set(noCode.map((o) => courierData[o.id]?.error).filter(Boolean))].join('; ');
  return { file, printed: wanted, skipped, noCode, why };
}
