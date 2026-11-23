import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { adminErrorMessage, adminSetOrderStatus } from '../../services/adminService';
import { useToast } from '../../hooks/useToast';
import { formatOrderNumber } from '../../utils/format';
import { NoteEditor } from './OrderDrawer';

// A small box in the middle of the screen (ShopDeck's Notes and Cancel pop-ups).
function OrderDialog({ open, title, onClose, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay" />
        <Dialog.Content className="ap-dialog ap" aria-describedby={undefined}>
          <div className="ap-dialog-head">
            <Dialog.Title className="ap-dialog-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="ap-icon-button" aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NoteDialog({ order, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(order)} title={order ? `Notes · ${formatOrderNumber(order.order_number)}` : ''} onClose={onClose}>
      {order && <NoteEditor key={order.id} order={order} onChanged={onChanged} onSaved={onClose} />}
    </OrderDialog>
  );
}

export function CancelDialog({ order, onClose, onChanged }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const { show } = useToast();

  async function cancel() {
    if (busy.current || !order) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await adminSetOrderStatus(order.id, 'cancelled');
      show({ message: `${formatOrderNumber(order.order_number)} is now cancelled` });
      onChanged();
      onClose();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <OrderDialog
      open={Boolean(order)}
      title={order ? `Cancel ${formatOrderNumber(order.order_number)}?` : ''}
      onClose={() => {
        setError(null);
        onClose();
      }}
    >
      {order && (
        <div className="stack-sm">
          <p>{order.status === 'pending_payment' ? 'The order was never paid, so nothing else changes.' : 'The books go back into stock and a booked parcel is cancelled with the courier.'}</p>
          {error && (
            <p className="notice" data-tone="error" role="alert">
              {error}
            </p>
          )}
          <div className="inline-actions">
            <button type="button" className="btn btn-danger btn-sm" aria-busy={working} onClick={cancel}>
              {working && <span className="spinner" aria-hidden="true" />}
              Yes, cancel order
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
              Keep order
            </button>
          </div>
        </div>
      )}
    </OrderDialog>
  );
}
