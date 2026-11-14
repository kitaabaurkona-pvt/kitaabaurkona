import { useState } from 'react';
import { coverHash } from '../../utils/coverHash';
import { coverList } from '../../utils/coverList';

const LISTING_SIZES = '(max-width: 767px) calc((100vw - 68px) / 2), (max-width: 1023px) 30vw, 280px';

// The small copy of a cover (720 and 360 pixels wide, made by `npm run covers`), when
// one exists for exactly this image link. Lists then download a few KB instead of the
// original, which is often over 1 MB.
function smallCopy(src) {
  if (typeof src !== 'string' || !src.startsWith('https://')) return null;
  const hash = coverHash(src);
  return coverList.has(hash) ? `/images/covers/${hash}.webp` : null;
}

// Covers are links to an external image host. If one fails to load, the title is
// shown in its place instead of a broken-image icon. `full` always shows the original
// image (the book page's own photos); everywhere else the small copy is used when there
// is one, falling back to the original if it cannot be loaded.
function BookCover({ src, title, eager = false, full = false, className = 'cover' }) {
  const [failed, setFailed] = useState(false);
  const [smallFailed, setSmallFailed] = useState(false);
  const small = full || smallFailed ? null : smallCopy(src);
  const shown = small ?? src;
  const responsive = Boolean(small) || (src?.startsWith('/images/listing-') && src.endsWith('.webp'));
  return (
    <div className={className}>
      {shown && !failed ? (
        <img
          src={shown}
          srcSet={responsive ? `${shown.replace('.webp', '-360.webp')} 360w, ${shown} 720w` : undefined}
          sizes={responsive ? LISTING_SIZES : undefined}
          alt={title}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => (small ? setSmallFailed(true) : setFailed(true))}
        />
      ) : (
        <span className="cover-fallback">{title}</span>
      )}
    </div>
  );
}

export default BookCover;
