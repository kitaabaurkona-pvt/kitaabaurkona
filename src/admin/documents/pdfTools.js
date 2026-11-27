// Small drawing helpers on top of pdf-lib for the admin's printable documents (labels,
// invoices, picking lists, packing slips). Everything is drawn in the browser; nothing
// leaves the admin's computer except the finished PDF the admin downloads.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JsBarcode from 'jsbarcode';

export const A4 = [595.28, 841.89];
export const BLACK = rgb(0, 0, 0);
export const GREY = rgb(0.35, 0.37, 0.4);
export const LINE = rgb(0.75, 0.78, 0.82);
export const WASH = rgb(0.95, 0.96, 0.97);

// The standard PDF fonts only know Western European letters (Windows-1252). Anything
// else (for example a name typed in Hindi) is shown as "?" rather than breaking the PDF.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function printable(value) {
  return String(value ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || CP1252_EXTRA.includes(ch)) return ch;
      return '?';
    })
    .join('')
    .trim();
}

export async function newDocument(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Kitaab Aur Kona admin');
  doc.setCreator('Kitaab Aur Kona admin');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  return { doc, fonts };
}

// The shop's emblem, for the top corner of labels and invoices (null if it cannot load).
// The picture is shrunk to 240 px first, so each PDF stays small.
export async function embedLogo(doc) {
  try {
    const response = await fetch('/images/brand/emblem-transparent.png');
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const size = 240;
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return await doc.embedPng(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

// Breaks text into lines that fit `width`; at most `maxLines`, the last one cut with "...".
export function wrap(text, font, size, width, maxLines = Infinity) {
  const words = printable(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // A single word longer than the line is cut into pieces.
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}...`;
    return kept;
  }
  return lines;
}

// Text whose top edge is at `top` (pdf-lib measures from the bottom of the page).
export function text(page, value, { x, top, font, size, color = BLACK, align = 'left', width }) {
  const t = printable(value);
  let left = x;
  if (align !== 'left' && width) {
    const w = font.widthOfTextAtSize(t, size);
    left = align === 'right' ? x + width - w : x + (width - w) / 2;
  }
  page.drawText(t, { x: left, y: page.getHeight() - top - size * 0.8, size, font, color });
}

export function box(page, { x, top, width, height, border = BLACK, fill, borderWidth = 1 }) {
  page.drawRectangle({
    x,
    y: page.getHeight() - top - height,
    width,
    height,
    borderColor: border,
    borderWidth,
    color: fill,
  });
}

export function hline(page, { x, top, width, color = BLACK, thickness = 1 }) {
  const y = page.getHeight() - top;
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
}

export function vline(page, { x, top, height, color = BLACK, thickness = 1 }) {
  const y = page.getHeight() - top;
  page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness, color });
}

// A Code 128 barcode (what couriers' scanners read), fitted into width x height.
export function barcode(page, value, { x, top, width, height }) {
  const out = {};
  JsBarcode(out, String(value), { format: 'CODE128' });
  const bits = out.encodings.map((e) => e.data).join('');
  const module = width / bits.length;
  const y = page.getHeight() - top - height;
  let run = 0;
  for (let i = 0; i <= bits.length; i += 1) {
    if (bits[i] === '1') {
      run += 1;
      continue;
    }
    if (run > 0) page.drawRectangle({ x: x + (i - run) * module, y, width: run * module, height, color: BLACK });
    run = 0;
  }
}

export function logo(page, image, { x, top, size }) {
  if (!image) return;
  const scale = size / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: x + (size - w) / 2, y: page.getHeight() - top - (size + h) / 2, width: w, height: h });
}

// dd-mm-yyyy in India's time zone (as on the ShopDeck documents).
export function indiaDate(value) {
  const d = new Date(new Date(value).getTime() + 330 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

export const money = (value) => {
  const n = Math.round(Number(value || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

// Saves the PDF on the admin's computer (a download, like ShopDeck's documents).
export async function download(doc, fileName) {
  const bytes = await doc.save();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return bytes.length;
}
