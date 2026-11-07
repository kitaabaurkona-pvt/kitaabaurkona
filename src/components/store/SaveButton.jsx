import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useWishlist } from '../../hooks/useWishlist';
import { useToast } from '../../hooks/useToast';
import { BookmarkIcon } from '../icons';

// Saves a book to the signed-in user's wishlist. Visitors are taken to sign in and
// brought back to this page afterwards.
function SaveButton({ bookId, title, className = 'save-button', withLabel = false }) {
  const { isAuthenticated } = useAuth();
  const { has, toggle } = useWishlist();
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const { show } = useToast();
  const saved = has(bookId);

  async function handleClick() {
    if (!isAuthenticated) {
      navigate('/sign-in', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setFailed(false);
    try {
      const nowSaved = await toggle(bookId);
      if (nowSaved !== null) {
        show(nowSaved ? { message: `Saved “${title}” to your wishlist`, action: { label: 'View', to: '/wishlist' } } : { message: `Removed “${title}” from your wishlist` });
      }
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
      <BookmarkIcon size={20} filled={saved} />
      {withLabel && (saved ? 'Saved' : 'Save')}
    </button>
  );
}

export default SaveButton;
