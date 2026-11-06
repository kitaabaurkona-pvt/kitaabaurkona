import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { REQUIRED_COLUMNS, sanitizeCatalogue } from '../../utils/catalogueSanitizer';
import { MAX_BOOKS_PER_UPLOAD, uploadBooks, uploadErrorMessage } from '../../services/catalogueService';
import '../../styles/admin.css';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Browsers report CSV files under several MIME types (and Windows often reports none).
const ACCEPTED_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain', ''];
const MAX_LISTED_SKIPS = 50;

function validateFile(file) {
  if (!/\.csv$/i.test(file.name) || !ACCEPTED_TYPES.includes(file.type)) return 'Choose a .csv file.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'This file is larger than 5 MB. Split it into smaller files.';
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

function BulkUpload() {
  useDocumentTitle('Bulk upload');
  // Steps 1-2: reading and checking the file. status.books holds the sanitized rows.
  const [status, setStatus] = useState({ state: 'idle' });
  // Step 3: sending them to the database.
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const parseId = useRef(0);
  const uploadingRef = useRef(false);
  const uploadMessageRef = useRef(null);

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
      parseId.current += 1; // results arriving after unmount are ignored
    };
  }, []);

  // When the upload button disappears after a success, move focus to the result so
  // keyboard and screen-reader users are not left on nothing.
  useEffect(() => {
    if (uploadStatus?.tone === 'ok') uploadMessageRef.current?.focus();
  }, [uploadStatus]);

  async function processRows(id, fileName, data) {
    const { headers, rows } = toRows(data);
    const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length > 0) {
      setStatus({ state: 'error', message: `${fileName} is missing columns: ${missing.join(', ')}.` });
      return;
    }
    if (rows.length === 0) {
      setStatus({ state: 'error', message: `${fileName} has no book rows.` });
      return;
    }

    setStatus({ state: 'working', message: `Checking ${plural(rows.length, 'row')}…` });
    const { books: sanitizedBooksArray, rejected } = await sanitizeCatalogue(rows);
    if (id !== parseId.current) return;

    if (import.meta.env.DEV) {
      console.log('[BulkUpload] sanitized books', sanitizedBooksArray);
      if (rejected.length > 0) console.log('[BulkUpload] skipped rows', rejected);
    }

    if (sanitizedBooksArray.length === 0) {
      setStatus({ state: 'error', message: `${fileName}: no rows could be used.`, rejected });
    } else if (sanitizedBooksArray.length > MAX_BOOKS_PER_UPLOAD) {
      setStatus({
        state: 'error',
        message: `${fileName} has ${plural(sanitizedBooksArray.length, 'book')}. Upload at most ${MAX_BOOKS_PER_UPLOAD.toLocaleString('en-IN')} at a time.`,
        rejected,
      });
    } else {
      setStatus({
        state: 'ready',
        message: `${fileName}: ${plural(sanitizedBooksArray.length, 'book')} ready to upload.`,
        books: sanitizedBooksArray,
        rejected,
      });
    }
  }

  function parseFile(file) {
    const problem = validateFile(file);
    setUploadStatus(null);
    if (problem) {
      setStatus({ state: 'error', message: problem });
      return;
    }

    const id = ++parseId.current;
    setStatus({ state: 'working', message: `Reading ${file.name}…` });

    Papa.parse(file, {
      worker: true,
      header: false,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        if (id !== parseId.current) return;
        processRows(id, file.name, results.data).catch(() => {
          if (id === parseId.current) setStatus({ state: 'error', message: `Unable to check ${file.name}.` });
        });
      },
      error: () => {
        if (id !== parseId.current) return;
        setStatus({ state: 'error', message: `Unable to read ${file.name}.` });
      },
    });
  }

  async function handleBulkUpload() {
    if (uploadingRef.current || status.state !== 'ready') return;
    const id = parseId.current;
    const books = status.books;
    const skipped = status.rejected.length;

    uploadingRef.current = true;
    setIsUploading(true);
    setUploadStatus(null);
    try {
      const { inserted, updated } = await uploadBooks(books);
      if (id !== parseId.current) return;
      setStatus({ state: 'idle' }); // clears the file and sanitized rows, ready for the next upload
      setUploadStatus({
        tone: 'ok',
        message:
          `Uploaded ${plural(books.length, 'book')}: ${inserted.toLocaleString('en-IN')} new, ${updated.toLocaleString('en-IN')} updated.` +
          (skipped > 0 ? ` ${plural(skipped, 'row')} from the file ${skipped === 1 ? 'was' : 'were'} skipped.` : ''),
      });
    } catch (error) {
      console.error('[BulkUpload] upload failed', error?.details ?? error);
      if (id !== parseId.current) return;
      // The checked rows are kept so the admin can retry without re-reading the file.
      setUploadStatus({ tone: 'error', message: uploadErrorMessage(error) });
    } finally {
      uploadingRef.current = false;
      if (id === parseId.current) setIsUploading(false);
    }
  }

  function handleFiles(fileList) {
    if (uploadingRef.current || !fileList || fileList.length === 0) return;
    if (fileList.length > 1) {
      setUploadStatus(null);
      setStatus({ state: 'error', message: 'Drop one file at a time.' });
      return;
    }
    parseFile(fileList[0]);
  }

  function handleChange(event) {
    handleFiles(event.target.files);
    event.target.value = ''; // lets the same file be chosen again
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
    handleFiles(event.dataTransfer.files);
  }

  const working = status.state === 'working';
  const rejected = status.rejected ?? [];
  const books = status.state === 'ready' ? status.books : null;

  return (
    <section className="admin-page" aria-labelledby="bulk-heading">
      <h2 id="bulk-heading" className="admin-title">Bulk upload books</h2>

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
          Drop a CSV file here or <strong>choose a file</strong>
        </p>
        <input
          className="dropzone-input"
          type="file"
          accept=".csv,text/csv"
          disabled={isUploading}
          onChange={handleChange}
        />
      </label>

      {status.state !== 'idle' && (
        <p
          className="upload-status"
          data-tone={status.state === 'ready' ? 'ok' : status.state === 'error' ? 'error' : undefined}
          role={status.state === 'error' ? 'alert' : 'status'}
        >
          {working && <span className="upload-spinner" aria-hidden="true" />}
          {status.message}
        </p>
      )}

      {books && (
        <button
          type="button"
          className="admin-button"
          aria-disabled={isUploading || undefined}
          aria-busy={isUploading}
          onClick={handleBulkUpload}
        >
          {isUploading && <span className="upload-spinner" aria-hidden="true" />}
          {isUploading ? 'Uploading…' : `Upload ${plural(books.length, 'book')}`}
        </button>
      )}

      {uploadStatus && (
        <p
          ref={uploadMessageRef}
          tabIndex={-1}
          className="upload-status"
          data-tone={uploadStatus.tone}
          role={uploadStatus.tone === 'error' ? 'alert' : 'status'}
        >
          {uploadStatus.message}
        </p>
      )}

      {rejected.length > 0 && (
        <section className="skipped" aria-labelledby="skipped-heading">
          <h2 id="skipped-heading" className="skipped-title">
            {plural(rejected.length, 'row')} skipped
          </h2>
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
          {rejected.length > MAX_LISTED_SKIPS && (
            <p className="skipped-more">and {rejected.length - MAX_LISTED_SKIPS} more</p>
          )}
        </section>
      )}
    </section>
  );
}

export default BulkUpload;
