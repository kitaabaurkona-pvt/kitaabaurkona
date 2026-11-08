import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ToastContext } from './toastContextObject';
import { takeAuthRedirectError } from '../utils/authRedirect';
import { CloseIcon } from '../components/icons';

const MAX_TOASTS = 3;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    ({ message, tone = 'ok', action = null, duration }) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, message, tone, action }]);
      timers.current.set(id, setTimeout(() => dismiss(id), duration ?? (tone === 'error' ? 7000 : 3500)));
      return id;
    },
    [dismiss],
  );

  // A sign-in that failed on Supabase's side comes back with an error in the URL.
  useEffect(() => {
    const message = takeAuthRedirectError();
    if (message) show({ message, tone: 'error', action: { label: 'Sign in', to: '/sign-in' } });
  }, [show]);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              className="toast"
              data-tone={toast.tone}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <span className="toast-text">{toast.message}</span>
              {toast.action?.to && (
                <Link to={toast.action.to} onClick={() => dismiss(toast.id)}>
                  {toast.action.label}
                </Link>
              )}
              {toast.action?.onClick && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    dismiss(toast.id);
                    toast.action.onClick();
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
                <CloseIcon size={18} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
