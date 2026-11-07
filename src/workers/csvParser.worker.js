// Parses an uploaded CSV off the main thread. Vite bundles this as its own worker
// file, which keeps working after production minification (PapaParse's built-in
// `worker: true` mode does not: it rebuilds itself from minified source and fails).
import Papa from 'papaparse';

// Importing PapaParse inside a worker makes it install its own message handler;
// assigning ours afterwards replaces it.
self.onmessage = (event) => {
  const { file } = event.data ?? {};
  if (!(file instanceof Blob)) {
    self.postMessage({ ok: false });
    return;
  }
  Papa.parse(file, {
    header: false,
    skipEmptyLines: 'greedy',
    complete: (results) => self.postMessage({ ok: true, data: results.data }),
    error: () => self.postMessage({ ok: false }),
  });
};
