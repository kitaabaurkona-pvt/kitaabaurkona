import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { DownloadSimple, Printer, X } from '@phosphor-icons/react';

// A printed document shown before it is saved: the PDF as the browser draws it, every
// page of it (several labels or invoices are one PDF), with Download and Print.
// preview: { title, url, file: { blob, fileName, pages } } | null, url being the PDF's
// blob URL. onUse('download' | 'print') runs after the admin downloads or prints it.
function DocumentPreview({ preview, onClose, onUse }) {
  const frame = useRef(null);
  const url = preview?.url ?? null;

  function print() {
    try {
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
    } catch {
      // A browser that cannot print from the preview opens the PDF in a tab instead.
      window.open(url, '_blank', 'noopener');
    }
    onUse('print');
  }

  return (
    <Dialog.Root open={Boolean(preview)} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay ap-preview-overlay" />
        <Dialog.Content className="ap-dialog ap ap-preview" aria-describedby={undefined}>
          <div className="ap-dialog-head">
            <Dialog.Title className="ap-dialog-title">{preview?.title}</Dialog.Title>
            <div className="inline-actions">
              <button type="button" className="btn btn-outline btn-sm" aria-disabled={!url || undefined} onClick={() => url && print()}>
                <Printer size={16} aria-hidden="true" />
                Print
              </button>
              <button type="button" className="btn btn-dark btn-sm" aria-disabled={!url || undefined} onClick={() => url && onUse('download')}>
                <DownloadSimple size={16} aria-hidden="true" />
                Download
              </button>
              <Dialog.Close asChild>
                <button type="button" className="ap-icon-button" aria-label="Close">
                  <X size={20} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
          </div>
          {url && <iframe ref={frame} className="ap-preview-frame" src={url} title={preview.title} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DocumentPreview;
