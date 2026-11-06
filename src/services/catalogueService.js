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
export function uploadErrorMessage(error) {
  if (error?.code === '42501' || error?.status === 403) return "You don't have permission to upload books.";
  if (error?.code === 'PGRST301' || error?.status === 401) return 'Your session has expired. Sign in again, then retry the upload.';
  if (error?.status === 0 || /fetch|network/i.test(error?.details?.message ?? '')) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return 'Upload failed. Please check the data format or your permissions.';
}
