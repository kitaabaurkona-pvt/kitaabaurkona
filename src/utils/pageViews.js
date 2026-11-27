import { COLLECTIONS, UNDER_PRICE } from './categories';

// What GoKwik's KwikPass is told about the page a customer is on ("page_view_kp", for
// KwikEngage reminders). GoKwik's types: product, collection, other. Our "collections" are
// the genres (books.category) and the made-up lists on the Books page.

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function bookPageView(book, origin = window.location.origin) {
  const image = book.image_urls?.[0];
  return {
    type: 'product',
    data: {
      product_id: String(book.id),
      name: book.title,
      price: Number(book.price),
      image_url: image || `${origin}/logo-192.png`,
      handle: `/books/${book.id}`,
    },
  };
}

// The Books page: a genre, a collection or the under-₹299 list is a collection; a search
// or the whole shelf is "other".
export function booksPageView({ q = '', category = '', collection = '', maxPrice = null }) {
  if (q) return { type: 'other', data: {} };
  if (category) return { type: 'collection', data: { collection_id: slug(category), name: category, handle: `/books?category=${encodeURIComponent(category)}` } };
  if (collection && COLLECTIONS[collection]) return { type: 'collection', data: { collection_id: collection, name: COLLECTIONS[collection].label, handle: `/books?collection=${collection}` } };
  if (maxPrice === UNDER_PRICE) return { type: 'collection', data: { collection_id: `under-${UNDER_PRICE}`, name: `Books under ₹${UNDER_PRICE}`, handle: `/books?max=${UNDER_PRICE}` } };
  return { type: 'other', data: {} };
}

// Pages that send their own view (the rest send "other" from the layout).
export const hasOwnPageView = (pathname) => pathname === '/books' || pathname.startsWith('/books/');
