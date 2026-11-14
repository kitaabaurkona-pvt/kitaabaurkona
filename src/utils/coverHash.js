// A short, stable name for an image link (16 hex characters). The small copies of book
// covers in /public/images/covers are named by it, so a cover is only ever used for the
// exact image it was made from: when a book's image changes, its link changes, the name
// no longer matches and the original image is shown until small copies are made again.
// Used by the website (BookCover) and by scripts/make-covers.mjs, which must agree.
function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function coverHash(url) {
  return fnv1a(url, 0x811c9dc5) + fnv1a(url, 0x9e3779b9);
}
