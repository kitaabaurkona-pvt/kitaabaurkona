const PARSE_TIMEOUT_MS = 60000;

// Resolves with the parsed rows (array of arrays) or rejects. The worker is always
// terminated, and a stuck parse gives up after a minute instead of hanging forever.
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../workers/csvParser.worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (fn, value) => {
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), PARSE_TIMEOUT_MS);
    worker.onmessage = (event) => {
      if (event.data?.ok) finish(resolve, event.data.data);
      else finish(reject, new Error('parse'));
    };
    worker.onerror = () => finish(reject, new Error('worker'));
    worker.onmessageerror = () => finish(reject, new Error('worker'));
    worker.postMessage({ file });
  });
}
