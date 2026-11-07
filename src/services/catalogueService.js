import { supabase } from '../clients/supabase';

export const MAX_BOOKS_PER_UPLOAD = 5000;

// One database call: admin_upsert_books (supabase/schema.sql) adds or updates every
// book and its admin-only internal data in a single transaction, matched on sku.
// The request carries the signed-in admin's session; the database's RLS policies and
// is_admin() check decide whether it is allowed.
export async function uploadBooks(books) {
  const { data, error, status } = await supabase.rpc('admin_upsert_books', { payload: books });
  if (error) {
    const failure = new Error('Bulk upload failed');
    failure.code = error.code;
    failure.status = status;
    failure.details = error;
    throw failure;
  }
  const summary = Array.isArray(data) ? data[0] : data;
  return { inserted: summary?.inserted ?? 0, updated: summary?.updated ?? 0 };
}

// Never shows database wording in the page; the full error goes to the console.
// Known causes get a specific instruction; anything else shows its error code so it
// can be looked up.
export function uploadErrorMessage(error) {
  const code = error?.code;
  if (code === '42501' || error?.status === 403) return "You don't have permission to upload books.";
  if (code === 'PGRST301' || error?.status === 401) return 'Your session has expired. Sign in again, then retry the upload.';
  if (error?.status === 0 || /fetch|network/i.test(error?.details?.message ?? '')) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  if (code === 'PGRST202' || code === '42883' || code === '42703' || code === 'PGRST204' || code === '42P01') {
    return 'The database is not set up for this version of the site. Run the latest supabase/schema.sql in the Supabase SQL Editor, then upload again.';
  }
  if (code === '23505') return 'A Product Code in this file already belongs to a book with a different SKU. Fix the file and upload again.';
  if (code === '23514' || code === '22P02' || code === '22023') return 'A row breaks a catalogue rule (for example a price above MRP). Fix the file and upload again.';
  if (code === '57014') return 'The upload took too long. Split the file into smaller files.';
  if (error?.status === 413) return 'The file is too large to send at once. Split it into smaller files.';
  const shown = /^[A-Z0-9]{1,10}$/i.test(String(code ?? error?.status ?? '')) ? String(code ?? error?.status) : 'unknown';
  return `Upload failed (error ${shown}). Please check the data format or your permissions.`;
}
