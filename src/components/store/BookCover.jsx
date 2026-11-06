import { useState } from 'react';

// Covers are links to an external image host. If one fails to load, the title is
// shown in its place instead of a broken-image icon.
function BookCover({ src, title, eager = false, className = 'cover' }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={className}>
      {src && !failed ? (
        <img
          src={src}
          alt={title}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="cover-fallback">{title}</span>
      )}
    </div>
  );
}

export default BookCover;
