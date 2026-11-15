// Matching the photos added in Bulk upload to the books in the CSV. Two ways, as the
// owner chose:
//   1. a photo's file name typed in a book's Image 1-10 column (godan.jpg), or
//   2. otherwise, photos named after the book's SKU: "<SKU>.jpg" is the cover and
//      "<SKU>-2.jpg", "<SKU>-3.jpg" ... are the next photos, in number order.
// Names are compared without regard to upper or lower case.

import { PHOTO_TOKEN } from './catalogueSanitizer';
import { isPhotoFile, MAX_PHOTOS } from '../services/photoService';

export const photoKey = (name) => String(name ?? '').trim().toLowerCase();
const baseName = (name) => photoKey(name).replace(/\.[a-z0-9]+$/, '');

// file name (lower case) -> File
export function indexPhotos(files) {
  const index = new Map();
  for (const file of files) if (isPhotoFile(file)) index.set(photoKey(file.name), file);
  return index;
}

export const isPhotoToken = (value) => value.startsWith(PHOTO_TOKEN);
export const tokenKey = (value) => value.slice(PHOTO_TOKEN.length);

// Adds SKU-named photos to the books that do not name photos in the CSV, and reports
// which photos were used. Changes book.image_urls in place.
export function applySkuPhotos(books, index) {
  const used = new Set();
  for (const book of books) for (const url of book.image_urls) if (isPhotoToken(url)) used.add(tokenKey(url));

  // sku (lower case) -> [{ position, key }]. A name that is itself a SKU ("ABC-2.jpg"
  // when there is a book with SKU ABC-2) is that book's cover, not ABC's second photo.
  const skus = new Set(books.map((book) => book.sku.toLowerCase()));
  const bySku = new Map();
  for (const key of index.keys()) {
    if (used.has(key)) continue;
    const base = baseName(key);
    const numbered = skus.has(base) ? null : base.match(/^(.*)-(\d{1,2})$/);
    const candidates = numbered ? [[numbered[1], Number(numbered[2])]] : [[base, 0]];
    for (const [sku, position] of candidates) {
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push({ position, key });
    }
  }

  let matchedBooks = 0;
  for (const book of books) {
    if (book.image_urls.some(isPhotoToken)) continue; // this row names its photos itself
    const found = bySku.get(book.sku.toLowerCase());
    if (!found) continue;
    // "<SKU>.jpg" first, then "<SKU>-1.jpg", "<SKU>-2.jpg" ... in number order.
    const photos = [...found].sort((a, b) => a.position - b.position);
    const keys = photos.map((p) => p.key).filter((key) => !used.has(key)).slice(0, MAX_PHOTOS);
    if (keys.length === 0) continue;
    keys.forEach((key) => used.add(key));
    book.image_urls = keys.map((key) => `${PHOTO_TOKEN}${key}`);
    book.photosFromFiles = true;
    matchedBooks += 1;
  }
  for (const book of books) if (book.image_urls.some(isPhotoToken)) book.photosFromFiles = true;

  const unused = [...index.keys()].filter((key) => !used.has(key)).map((key) => index.get(key).name);
  return { used, unused, matchedBooks };
}

export const hasPhotoTokens = (book) => book.image_urls.some(isPhotoToken);
