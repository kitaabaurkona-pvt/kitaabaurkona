// The CSV template offered on the Bulk upload page: every column the upload reads, in
// a readable order, with one example row (its SKU starts with EXAMPLE-, and such rows
// are always skipped, so uploading the template unchanged adds nothing).

const COLUMNS = [
  ['Sku Id', 'EXAMPLE-001'],
  ['Product Code', 'EXAMPLE-001'],
  ['Name', 'Example Book Name'],
  ['attr_Author', 'Author Name'],
  ['Description', 'A few lines about the book: the story, the language, the edition.'],
  ['Selling Price', '199'],
  ['MRP', '299'],
  ['Cost Price', '120'],
  ['Quantity', '10'],
  ['GST %', '0'],
  ['Image 1', 'EXAMPLE-001.jpg'],
  ['Image 2', ''],
  ['Image 3', ''],
  ['Image 4', ''],
  ['Image 5', ''],
  ['Image 6', ''],
  ['Image 7', ''],
  ['Image 8', ''],
  ['Image 9', ''],
  ['Image 10', ''],
  ['Visibility', 'true'],
  ['attr_Genre', 'Fiction'],
  ['attr_Brand', 'Publisher Name'],
  ['attr_Ideal For', ''],
  ['attr_Pack of', '1'],
  ['attr_Country of Origin', 'India'],
  ['Packaging Length (in cm)', '22'],
  ['Packaging Breadth (in cm)', '15'],
  ['Packaging Height (in cm)', '3'],
  ['Packaging Weight (in kg)', '0.3'],
  ['Return/Exchange Condition', ''],
  ['Pickup Address Code', ''],
  ['Product Type', 'Book'],
  ['Video 1', ''],
];

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

export function templateCsv() {
  const header = COLUMNS.map(([name]) => quote(name)).join(',');
  const example = COLUMNS.map(([, value]) => quote(value)).join(',');
  // The byte order mark makes Excel read the file as UTF-8 (₹ and Indian scripts).
  return `﻿${header}\r\n${example}\r\n`;
}

export function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kitaabaurkona-books-template.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
