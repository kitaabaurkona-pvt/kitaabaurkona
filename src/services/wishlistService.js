import { supabase } from '../clients/supabase';
import { LIST_FIELDS } from './bookService';
import { unwrap } from './request';

export async function listWishlistIds() {
  const { data } = unwrap(await supabase.from('wishlist_items').select('book_id'));
  return (data ?? []).map((row) => row.book_id);
}

export async function listWishlist() {
  const { data } = unwrap(
    await supabase
      .from('wishlist_items')
      .select(`book_id, created_at, books(${LIST_FIELDS}, is_visible)`)
      .order('created_at', { ascending: false }),
  );
  return (data ?? []).filter((row) => row.books && row.books.is_visible).map((row) => row.books);
}

// user_id is filled in by the database from the session; RLS only allows your own rows.
export async function addToWishlist(bookId) {
  const { error, status } = await supabase.from('wishlist_items').insert({ book_id: bookId });
  if (error && error.code !== '23505') unwrap({ error, status });
}

export async function removeFromWishlist(bookId) {
  unwrap(await supabase.from('wishlist_items').delete().eq('book_id', bookId));
}
