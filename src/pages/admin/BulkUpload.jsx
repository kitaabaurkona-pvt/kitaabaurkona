import { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadSimple, FileCsv, Images, X } from '@phosphor-icons/react';
import { parseCsvFile } from '../../utils/parseCsvFile';
import { REQUIRED_COLUMNS, sanitizeCatalogue } from '../../utils/catalogueSanitizer';
import { applySkuPhotos, hasPhotoTokens, indexPhotos, isPhotoToken, photoKey, tokenKey } from '../../utils/bulkPhotos';
import { downloadTemplate } from '../../utils/csvTemplate';
import { currentPhotosBySku, MAX_BOOKS_PER_UPLOAD, uploadBooks, uploadErrorMessage } from '../../services/catalogueService';
import { isPhotoFile, PHOTO_ACCEPT, photoErrorMessage, runLimited, uploadPhoto } from '../../services/photoService';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { formatPrice } from '../../utils/format';
import PageHead from '../../components/admin/PageHead';
import '../../styles/admin.css';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Browsers report CSV files under several MIME types (and Windows often reports none).
const CSV_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain', ''];
const MAX_PHOTO_FILES = 3000;
const MAX_LISTED_SKIPS = 50;
const MAX_LISTED_UNUSED = 20;
const PREVIEW_ROWS = 8;

const isCsv = (file) => /\.csv$/i.test(file.name);

function validateCsv(file) {
  if (!CSV_TYPES.includes(file.type)) return 'Choose a .csv file.';
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 5 MB. Split it into smaller files.`;
  return null;
}

// Rows are built with Object.fromEntries, which defines own properties, so a header
// such as "__proto__" cannot change a row object's prototype.
function toRows(data) {
  const [headerRow = [], ...dataRows] = data;
  const headers = headerRow.map((cell) => String(cell).replace(/^﻿/, '').trim());
  const rows = dataRows.map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ''])));
  return { headers, rows };
}

const plural = (count, word) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`;

function photoSummary(book) {
  if (book.photosFromFiles) return `${book.image_urls.length} new`;
  if (book.keptPhotos) return `${book.image_urls.length} current`;
  return book.image_urls.length > 0 ? `${book.image_urls.length} links` : 'None';
}

function BulkUpload() {
  useDocumentTitle('Bulk upload');
  const [csv, setCsv] = useState(null);
  const [photos, setPhotos] = useState([]);
  // Reading and checking: { state: idle | working | error | ready, ... }
  const [status, setStatus] = useState({ state: 'idle' });
  // Sending: photos first, then the books.
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [intakeNote, setIntakeNote] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const checkId = useRef(0);
  const uploadingRef = useRef(false);
  const uploadMessageRef = useRef(null);
  // Photos already uploaded for the current files (file key -> link), so pressing
  // Upload again after a problem does not upload them twice.
  const uploadedPhotos = useRef(new Map());

  const index = useMemo(() => indexPhotos(photos), [photos]);

  // Stop a file dropped outside the drop area from making the browser open it and
  // leave the admin page; also clear the highlight if a drag ends anywhere.
  useEffect(() => {
    const isFileDrag = (event) => event.dataTransfer?.types?.includes('Files');
    const block = (event) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onDrop = (event) => {
      block(event);
      reset();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
      checkId.current += 1; // results arriving after unmount are ignored
    };
  }, []);

  // When the upload button disappears after a success, move focus to the result so
  // keyboard and screen-reader users are not left on nothing.
  useEffect(() => {
    if (uploadStatus?.tone === 'ok') uploadMessageRef.current?.focus();
  }, [uploadStatus]);

  // Small previews of the first rows' covers (photos still on this computer).
  const books = status.state === 'ready' ? status.books : null;
  const previews = useMemo(() => {
    const map = new Map();
    for (const book of books?.slice(0, PREVIEW_ROWS) ?? []) {
      const first = book.image_urls[0];
      if (first && isPhotoToken(first)) {
        const file = index.get(tokenKey(first));
        if (file) map.set(book.sku, URL.createObjectURL(file));
      }
    }
    return map;
  }, [books, index]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  // Reads and checks the CSV against the photos; runs again whenever either changes.
  async function check(csvFile, photoIndex) {
    const id = ++checkId.current;
    const stale = () => id !== checkId.current;
    if (!csvFile) {
      setStatus({ state: 'idle' });
      return;
    }
    const problem = validateCsv(csvFile);
    if (problem) {
      setStatus({ state: 'error', message: problem });
      return;
    }
    setStatus({ state: 'working', message: `Reading ${csvFile.name}…` });
    let data;
    try {
      data = await parseCsvFile(csvFile);
    } catch (error) {
      if (stale()) return;
      setStatus({
        state: 'error',
        message: error?.message === 'timeout' ? `Reading ${csvFile.name} took too long. Try a smaller file.` : `Unable to read ${csvFile.name}. Check that it is a valid CSV file.`,
      });
      return;
    }
    if (stale()) return;

    const { headers, rows } = toRows(data);
    const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length > 0) {
      setStatus({ state: 'error', message: `${csvFile.name} is missing columns: ${missing.join(', ')}. Start from the template.` });
      return;
    }
    if (rows.length === 0) {
      setStatus({ state: 'error', message: `${csvFile.name} has no book rows.` });
      return;
    }

    setStatus({ state: 'working', message: `Checking ${plural(rows.length, 'row')}…` });
    try {
      const photoFor = (cell) => {
        const key = photoKey(cell.split(/[\\/]/).pop());
        return photoIndex.has(key) ? key : null;
      };
      const { books: checked, rejected } = await sanitizeCatalogue(rows, { photoFor });
      if (stale()) return;
      if (checked.length === 0) {
        setStatus({ state: 'error', message: `${csvFile.name}: no rows could be used.`, rejected });
        return;
      }
      if (checked.length > MAX_BOOKS_PER_UPLOAD) {
        setStatus({ state: 'error', message: `${csvFile.name} has ${plural(checked.length, 'book')}. Upload at most ${MAX_BOOKS_PER_UPLOAD.toLocaleString('en-IN')} at a time.`, rejected });
        return;
      }
      const { unused } = applySkuPhotos(checked, photoIndex);

      // A row with no photo at all keeps the photos its book already has.
      const bare = checked.filter((book) => book.image_urls.length === 0);
      if (bare.length > 0) {
        setStatus({ state: 'working', message: 'Checking the photos books already have…' });
        const current = await currentPhotosBySku(bare.map((book) => book.sku));
        if (stale()) return;
        for (const book of bare) {
          const urls = current.get(book.sku);
          if (urls) {
            book.image_urls = urls;
            book.keptPhotos = true;
          }
        }
      }
      setStatus({ state: 'ready', books: checked, rejected, unused });
    } catch (error) {
      console.error('[BulkUpload] check failed', error);
      if (!stale()) setStatus({ state: 'error', message: `Unable to check ${csvFile.name}. Check your connection and try again.` });
    }
  }

  function addFiles(fileList) {
    if (uploadingRef.current) return;
    const files = [...(fileList ?? [])];
    if (files.length === 0) return;
    const csvs = files.filter(isCsv);
    const images = files.filter((file) => !isCsv(file) && isPhotoFile(file));
    const others = files.length - csvs.length - images.length;
    setUploadStatus(null);

    const notes = [];
    if (csvs.length > 1) notes.push('Add one CSV file at a time; the first one was used.');
    if (others > 0) notes.push(`${plural(others, 'file')} ${others === 1 ? 'was' : 'were'} not a CSV or a JPG, PNG or WebP photo and ${others === 1 ? 'was' : 'were'} left out.`);

    const nextCsv = csvs[0] ?? csv;
    let nextPhotos = photos;
    if (images.length > 0) {
      const byName = new Map(photos.map((file) => [photoKey(file.name), file]));
      for (const file of images) byName.set(photoKey(file.name), file); // a newer photo with the same name replaces the older
      nextPhotos = [...byName.values()];
      if (nextPhotos.length > MAX_PHOTO_FILES) {
        nextPhotos = nextPhotos.slice(0, MAX_PHOTO_FILES);
        notes.push(`At most ${MAX_PHOTO_FILES.toLocaleString('en-IN')} photos can be added at once.`);
      }
    }
    setIntakeNote(notes.join(' ') || null);
    if (nextCsv !== csv) setCsv(nextCsv);
    if (nextPhotos !== photos) {
      setPhotos(nextPhotos);
      uploadedPhotos.current = new Map();
    }
    check(nextCsv, indexPhotos(nextPhotos));
  }

  function removeCsv() {
    setCsv(null);
    setUploadStatus(null);
    check(null, index);
  }

  function removePhotos() {
    setPhotos([]);
    uploadedPhotos.current = new Map();
    setUploadStatus(null);
    check(csv, new Map());
  }

  async function handleUpload() {
    if (uploadingRef.current || status.state !== 'ready') return;
    const id = checkId.current;
    const ready = status.books;
    const skipped = status.rejected.length;
    uploadingRef.current = true;
    setIsUploading(true);
    setUploadStatus(null);

    try {
      // 1. Photos from this computer go to the photo storage first.
      const keys = [...new Set(ready.flatMap((book) => book.image_urls.filter((u) => isPhotoToken(u)).map(tokenKey)))];
      const missing = keys.filter((key) => !uploadedPhotos.current.has(key));
      if (missing.length > 0) {
        setProgress({ label: 'Uploading photos', done: 0, total: missing.length });
        await runLimited(
          missing,
          async (key) => {
            const file = index.get(key);
            try {
              uploadedPhotos.current.set(key, await uploadPhoto(file));
            } catch (error) {
              throw Object.assign(new Error('photo'), { photoName: file?.name ?? key, photoMessage: photoErrorMessage(error) });
            }
          },
          { limit: 3, onProgress: (done, total) => setProgress({ label: 'Uploading photos', done, total }) },
        );
      }

      // 2. Then every book in one go, with the photo links in place.
      setProgress({ label: `Saving ${plural(ready.length, 'book')}`, done: 0, total: 0 });
      const payload = ready.map((book) => {
        const { photosFromFiles: _f, keptPhotos: _k, ...row } = book;
        return { ...row, image_urls: book.image_urls.map((u) => (isPhotoToken(u) ? uploadedPhotos.current.get(tokenKey(u)) : u)) };
      });
      if (payload.some((book) => book.image_urls.some((u) => typeof u !== 'string' || !u.startsWith('https://')))) {
        throw Object.assign(new Error('photo'), { photoName: '', photoMessage: 'A photo link is missing. Press Upload again.' });
      }
      const { inserted, updated } = await uploadBooks(payload);
      if (id !== checkId.current) return;

      const withNewPhotos = ready.filter(hasPhotoTokens).length;
      setCsv(null);
      setPhotos([]);
      uploadedPhotos.current = new Map();
      setStatus({ state: 'idle' });
      setIntakeNote(null);
      setUploadStatus({
        tone: 'ok',
        message:
          `Uploaded ${plural(ready.length, 'book')}: ${inserted.toLocaleString('en-IN')} new, ${updated.toLocaleString('en-IN')} updated.` +
          (withNewPhotos > 0 ? ` ${plural(keys.length, 'photo')} added to ${plural(withNewPhotos, 'book')}.` : '') +
          (skipped > 0 ? ` ${plural(skipped, 'row')} from the file ${skipped === 1 ? 'was' : 'were'} skipped.` : ''),
      });
    } catch (error) {
      if (id !== checkId.current) return;
      if (error?.photoMessage) {
        setUploadStatus({
          tone: 'error',
          message: `${error.photoName ? `Photo ${error.photoName}: ` : ''}${error.photoMessage} No books were saved yet. Fix the problem and press Upload again; photos already sent are not sent twice.`,
        });
      } else {
        console.error('[BulkUpload] upload failed', error?.details ?? error);
        // The checked rows are kept so the admin can retry without re-reading the file.
        setUploadStatus({ tone: 'error', message: uploadErrorMessage(error) });
      }
    } finally {
      uploadingRef.current = false;
      setProgress(null);
      if (id === checkId.current) setIsUploading(false);
    }
  }

  function handleDragEnter(event) {
    event.preventDefault();
    if (uploadingRef.current) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const working = status.state === 'working';
  const rejected = status.rejected ?? [];
  const unused = status.unused ?? [];
  const newPhotoBooks = books ? books.filter((b) => b.photosFromFiles).length : 0;
  const keptBooks = books ? books.filter((b) => b.keptPhotos).length : 0;
  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <>
      <PageHead title="Bulk upload">
        <button type="button" className="btn btn-outline" onClick={downloadTemplate}>
          <DownloadSimple size={18} aria-hidden="true" />
          Download template
        </button>
      </PageHead>

      <section className="ap-card" aria-labelledby="how-heading">
        <div className="ap-card-head">
          <h2 id="how-heading" className="ap-card-title">
            How it works
          </h2>
        </div>
        <div className="ap-card-body">
          <ol className="ap-steps">
            <li>
              <span>Download the template. Fill in one row per book in Excel or Google Sheets, then save it as a CSV file. A row whose SKU is already in the store updates that book.</span>
            </li>
            <li>
              <span>
              For photos, either type each photo&rsquo;s file name in the Image 1 to Image 10 columns, or name the photos after the book&rsquo;s SKU: <strong>SKU.jpg</strong> becomes the cover, <strong>SKU-2.jpg</strong>, <strong>SKU-3.jpg</strong> the next photos.
              </span>
            </li>
            <li>
              <span>Drop the CSV file and the photos together below, check the list, then press Upload.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="ap-card" aria-labelledby="files-heading">
        <div className="ap-card-head">
          <h2 id="files-heading" className="ap-card-title">
            Your files
          </h2>
        </div>
        <div className="ap-card-body admin-page">
          <label
            className="dropzone"
            data-dragging={dragging || undefined}
            data-disabled={isUploading || undefined}
            aria-busy={working || isUploading || undefined}
            onDragEnter={handleDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <svg className="dropzone-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
              <path d="M12 17v-6" />
              <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
            </svg>
            <p className="dropzone-text">
              Drop the CSV file and photos here or <strong>choose files</strong>
            </p>
            <input
              className="dropzone-input"
              type="file"
              multiple
              accept={`.csv,text/csv,${PHOTO_ACCEPT}`}
              disabled={isUploading}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = ''; // lets the same files be chosen again
              }}
            />
          </label>

          {(csv || photos.length > 0) && (
            <ul className="ap-files" aria-label="Added files">
              {csv && (
                <li>
                  <FileCsv size={18} aria-hidden="true" />
                  {csv.name}
                  <button type="button" aria-label={`Remove ${csv.name}`} disabled={isUploading} onClick={removeCsv}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              )}
              {photos.length > 0 && (
                <li>
                  <Images size={18} aria-hidden="true" />
                  {plural(photos.length, 'photo')}
                  <button type="button" aria-label="Remove the photos" disabled={isUploading} onClick={removePhotos}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              )}
            </ul>
          )}

          {intakeNote && (
            <p className="notice" data-tone="warn" role="status" style={{ marginTop: 16 }}>
              {intakeNote}
            </p>
          )}

          {!csv && photos.length > 0 && (
            <p className="upload-status" role="status">
              Now add the CSV file that lists these books.
            </p>
          )}

          {status.state !== 'idle' && status.state !== 'ready' && (
            <p className="upload-status" data-tone={status.state === 'error' ? 'error' : undefined} role={status.state === 'error' ? 'alert' : 'status'}>
              {working && <span className="upload-spinner" aria-hidden="true" />}
              {status.message}
            </p>
          )}

          {uploadStatus && (
            <p ref={uploadMessageRef} tabIndex={-1} className="upload-status" data-tone={uploadStatus.tone} role={uploadStatus.tone === 'error' ? 'alert' : 'status'}>
              {uploadStatus.message}
            </p>
          )}
        </div>
      </section>

      {books && (
        <section className="ap-card" aria-labelledby="preview-heading">
          <div className="ap-card-head">
            <h2 id="preview-heading" className="ap-card-title">
              Ready to upload
            </h2>
            <span className="page-meta">{plural(books.length, 'book')}</span>
          </div>
          <div className="ap-card-body admin-page stack-sm">
            <p className="upload-status" data-tone="ok" role="status" style={{ marginTop: 0 }}>
              {plural(books.length, 'book')} ready.
              {newPhotoBooks > 0 && ` ${plural(newPhotoBooks, 'book')} get new photos.`}
              {keptBooks > 0 && ` ${plural(keptBooks, 'book')} keep the photos they already have.`}
            </p>
            {unused.length > 0 && (
              <div className="notice" data-tone="warn" role="status">
                {plural(unused.length, 'photo')} did not match any book and will not be uploaded: {unused.slice(0, MAX_LISTED_UNUSED).join(', ')}
                {unused.length > MAX_LISTED_UNUSED ? ` and ${unused.length - MAX_LISTED_UNUSED} more` : ''}. Check that each name is a SKU from the file, or is typed in an Image column.
              </div>
            )}
            <div className="preview-scroll">
              <table className="preview-table">
                <caption className="visually-hidden">The first {Math.min(PREVIEW_ROWS, books.length)} books in the file</caption>
                <thead>
                  <tr>
                    <th scope="col">Cover</th>
                    <th scope="col">Name</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Price</th>
                    <th scope="col">MRP</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {books.slice(0, PREVIEW_ROWS).map((book) => {
                    const first = book.image_urls[0];
                    const src = previews.get(book.sku) ?? (first && !isPhotoToken(first) ? first : null);
                    return (
                      <tr key={book.sku}>
                        <td>{src ? <img src={src} alt="" width="36" height="54" loading="lazy" referrerPolicy="no-referrer" /> : '—'}</td>
                        <td>{book.title}</td>
                        <td>{book.sku}</td>
                        <td className="num">{formatPrice(book.price)}</td>
                        <td className="num">{formatPrice(book.mrp)}</td>
                        <td className="num">{book.stock_quantity}</td>
                        <td>{photoSummary(book)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {books.length > PREVIEW_ROWS && <p className="page-meta">Showing the first {PREVIEW_ROWS} of {plural(books.length, 'book')}.</p>}

            {progress && (
              <div className="stack-sm" role="status" aria-live="polite">
                <p className="page-meta" style={{ margin: 0 }}>
                  {progress.label}
                  {progress.total ? `: ${progress.done.toLocaleString('en-IN')} of ${progress.total.toLocaleString('en-IN')}` : '…'}
                </p>
                <div className="ap-progress" aria-hidden="true">
                  <span style={{ width: `${percent ?? 100}%` }} />
                </div>
              </div>
            )}

            <button type="button" className="admin-button" aria-disabled={isUploading || undefined} aria-busy={isUploading} onClick={handleUpload}>
              {isUploading && <span className="upload-spinner" aria-hidden="true" />}
              {isUploading ? 'Uploading…' : `Upload ${plural(books.length, 'book')}`}
            </button>
          </div>
        </section>
      )}

      {rejected.length > 0 && (
        <section className="ap-card" aria-labelledby="skipped-heading">
          <div className="ap-card-head">
            <h2 id="skipped-heading" className="ap-card-title">
              {plural(rejected.length, 'row')} will be skipped
            </h2>
          </div>
          <div className="ap-card-body admin-page">
            <ul className="skipped-list">
              {rejected.slice(0, MAX_LISTED_SKIPS).map((item) => (
                <li key={item.row}>
                  <span className="skipped-where">
                    Row {item.row}
                    {item.sku ? ` (${item.sku})` : ''}
                  </span>
                  {item.reason}
                </li>
              ))}
            </ul>
            {rejected.length > MAX_LISTED_SKIPS && <p className="skipped-more">and {rejected.length - MAX_LISTED_SKIPS} more</p>}
          </div>
        </section>
      )}
    </>
  );
}

export default BulkUpload;
