// Makes small copies of every book's cover image, so lists show a ~20 KB picture
// instead of the original (often over 1 MB). Run it after adding books or changing a
// book's first image:   npm run covers
//
// For each visible book it downloads the first image, shrinks it in headless Chrome to
// 720 and 360 pixels wide (never enlarged) and saves WebP files in public/images/covers,
// named by the image link (src/utils/coverHash.js). It then writes the list of covers
// the website may use to src/utils/coverList.js. Covers that already exist are skipped,
// and covers no book uses any more are deleted.
//
// The catalogue is read with the public anon key from .env.local (read only). The
// original images and the database are never changed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { fetchPublicBooks } from '../e2e/fake-supabase.mjs';
import { coverHash } from '../src/utils/coverHash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'images', 'covers');
const LIST = path.join(ROOT, 'src', 'utils', 'coverList.js');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = [720, 360];
const QUALITY = 0.8;
const PARALLEL = 4;
fs.mkdirSync(OUT, { recursive: true });

const fileFor = (hash, width) => path.join(OUT, width === 720 ? `${hash}.webp` : `${hash}-${width}.webp`);
const done = (hash) => WIDTHS.every((w) => fs.existsSync(fileFor(hash, w)));

const books = await fetchPublicBooks(path.join(ROOT, '.env.local'));
const sources = [...new Set(books.map((b) => b.image_urls?.[0]).filter((u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u)))];
const todo = sources.filter((url) => !done(coverHash(url)));
console.log(`${books.length} books, ${sources.length} cover images, ${todo.length} to make`);

let made = 0;
const failed = [];
if (todo.length) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    // Shrinks one image (given as base64) to each width and returns WebP files as base64.
    const shrink = async (page, base64, widths, quality) =>
      page.evaluate(
        async (data, sizes, q) => {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const source = await createImageBitmap(new Blob([bytes]));
          const out = [];
          for (const want of sizes) {
            const width = Math.min(want, source.width);
            const height = Math.round((source.height * width) / source.width);
            const small = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
            const canvas = new OffscreenCanvas(width, height);
            canvas.getContext('2d').drawImage(small, 0, 0);
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
            const buffer = new Uint8Array(await blob.arrayBuffer());
            let text = '';
            for (let i = 0; i < buffer.length; i += 0x8000) text += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
            out.push({ want, width, height, data: btoa(text) });
          }
          return out;
        },
        base64,
        widths,
        quality,
      );

    const queue = [...todo];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        const page = await browser.newPage();
        await page.goto('about:blank');
        for (let url = queue.shift(); url; url = queue.shift()) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const original = Buffer.from(await res.arrayBuffer());
            const hash = coverHash(url);
            for (const file of await shrink(page, original.toString('base64'), WIDTHS, QUALITY)) {
              fs.writeFileSync(fileFor(hash, file.want), Buffer.from(file.data, 'base64'));
            }
            made += 1;
            if (made % 25 === 0) console.log(`  ${made}/${todo.length}`);
          } catch (e) {
            failed.push(`${url} (${String(e.message).slice(0, 80)})`);
          }
        }
        await page.close();
      }),
    );
  } finally {
    await browser.close();
  }
}

// Covers no book uses any more are removed; the list holds only complete pairs.
const wanted = new Set(sources.map(coverHash));
let removed = 0;
for (const name of fs.readdirSync(OUT)) {
  const hash = name.slice(0, 16);
  if (!/^[0-9a-f]{16}(-360)?\.webp$/.test(name) || !wanted.has(hash)) {
    fs.rmSync(path.join(OUT, name));
    removed += 1;
  }
}
const ready = [...wanted].filter(done).sort();
fs.writeFileSync(
  LIST,
  `// Made by scripts/make-covers.mjs (npm run covers). Do not edit by hand.\n// The names of the book cover images that have small copies in /public/images/covers.\nexport const coverList = new Set(${JSON.stringify(ready)});\n`,
);

const size = fs.readdirSync(OUT).reduce((sum, name) => sum + fs.statSync(path.join(OUT, name)).size, 0);
console.log(`made ${made}, removed ${removed}, failed ${failed.length}; ${ready.length} covers ready, ${(size / 1024 / 1024).toFixed(1)} MB in public/images/covers`);
for (const line of failed) console.log(`  FAILED ${line}`);
process.exit(failed.length ? 1 : 0);
