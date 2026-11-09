// The store's genres. Every book has exactly one, stored in books.category. The two
// columns are only how the Books menu groups them.
export const FICTION = ['Romance', 'Thriller & Mystery', 'Fantasy', 'Literary Fiction', 'Comics & Manga'];
export const NON_FICTION = ['Self-Help', 'Money & Business', 'Mythology & History', 'Biography & Memoir', 'Box Sets & Combos'];
export const CATEGORIES = [...FICTION, ...NON_FICTION];

// Collections are worked out from the books themselves, not stored.
export const UNDER_PRICE = 299;
export const COLLECTIONS = {
  regional: {
    label: 'Regional editions',
    // Matched on the title; the listing names these editions explicitly.
    languages: ['Tamil', 'Bengali', 'Malayalam'],
  },
};

const TINTS = ['sand', 'sage', 'rose', 'sky', 'lilac'];

// A stable soft colour for a category, so the same genre always looks the same.
export function tintFor(name) {
  const index = CATEGORIES.indexOf(name);
  if (index >= 0) return TINTS[index % TINTS.length];
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export const categoryHref = (name) => `/books?category=${encodeURIComponent(name)}`;
export const underPriceHref = `/books?max=${UNDER_PRICE}&stock=1`;
export const regionalHref = '/books?collection=regional';
export const dealsHref = '/books?sort=discount&stock=1';

// Keeps only known categories, in menu order.
export function orderCategories(names = []) {
  const known = CATEGORIES.filter((name) => names.includes(name));
  const other = names.filter((name) => !CATEGORIES.includes(name)).sort((a, b) => a.localeCompare(b));
  return [...known, ...other];
}
