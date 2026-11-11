// Display-only parsing of existing titles; no change to database fields or API contracts.
export function bookDisplay(book) {
  const parts = book.title.split(/\s+by\s+/i);
  return { title: parts[0], author: parts.length > 1 ? parts.slice(1).join(' by ') : (book.attributes?.author || '') };
}
