// Prints one kind of document for some orders: gives invoice numbers where needed,
// reads the seller details, draws the PDF and downloads it. Loaded only when the admin
// prints something, so the PDF code is not part of the panel's first download.
import { adminIssueInvoices } from '../../services/adminService';
import { getShippingSettings } from '../../services/shippingService';
import { downloadInvoices, downloadLabels, downloadPackingSlips, downloadPickList, labelReady, missingInvoiceDetails } from './documents';

// kind: 'labels' | 'invoices' | 'picklist' | 'slips'. Returns { printed, skipped } where
// printed are the orders in the PDF and skipped the ones left out, with why.
export async function printDocuments(kind, orders) {
  if (kind === 'picklist') {
    await downloadPickList(orders);
    return { printed: orders, skipped: [] };
  }
  if (kind === 'slips') {
    await downloadPackingSlips(orders);
    return { printed: orders, skipped: [] };
  }

  const settings = await getShippingSettings();
  if (kind === 'invoices') {
    const missing = missingInvoiceDetails(settings);
    if (missing.length) throw new Error(`Fill in the invoice details first (Shipping > Invoice details): ${missing.join(', ')}.`);
  }
  const wanted = kind === 'labels' ? orders.filter(labelReady) : orders.filter((o) => !['pending_payment', 'cancelled'].includes(o.status));
  const skipped = orders.filter((o) => !wanted.includes(o));
  if (wanted.length === 0) return { printed: [], skipped };

  const invoices = await adminIssueInvoices(wanted.map((o) => o.id));
  if (kind === 'labels') await downloadLabels(wanted, invoices, settings);
  else await downloadInvoices(wanted, invoices, settings);
  return { printed: wanted, skipped };
}
