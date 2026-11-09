import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useWishlist } from '../../hooks/useWishlist';
import { useToast } from '../../hooks/useToast';
import { BookmarkIcon } from '../icons';

// Saves a book to the signed-in user's wishlist. No pop-up message: the bookmark fills
// in with a small spring and the label changes to "Saved". Visitors are taken to sign
// in and brought back to this page afterwards.
function SaveButton({ bookId, title, className = 'save-button', withLabel = false }) {
  const { isAuthenticated } = useAuth();
  const { has, toggle } = useWishlist();
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  // Only animate after the visitor clicks, never when the page first shows the state.
  const [touched, setTouched] = useState(false);
  const { show } = useToast();
  const saved = has(bookId);

  async function handleClick() {
    if (!isAuthenticated) {
      navigate('/sign-in', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setFailed(false);
    setTouched(true);
    try {
      await toggle(bookId);
    } catch {
      setFailed(true);
      show({ message: 'Could not update your wishlist. Try again.', tone: 'error' });
    }
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={saved}
      aria-label={withLabel ? undefined : `Save ${title} to wishlist`}
      title={failed ? 'Could not update your wishlist. Try again.' : undefined}
      onClick={handleClick}
    >
      <motion.span
        key={saved ? 'saved' : 'not-saved'}
        className="save-icon"
        initial={touched ? { scale: saved ? 0.5 : 0.85 } : false}
        animate={{ scale: 1 }}
        transition={saved ? { type: 'spring', stiffness: 520, damping: 14 } : { duration: 0.18, ease: 'easeOut' }}
      >
        <BookmarkIcon size={20} filled={saved} />
      </motion.span>
      {withLabel && (
        <span className="save-label">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={saved ? 'saved' : 'save'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {saved ? 'Saved' : 'Save'}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
    </button>
  );
}

export default SaveButton;
