import { useState } from 'react';

// Covers are links to an external image host. If one fails to load, the title is
// shown in its place instead of a broken-image icon.
function BookCover({ src, title, eager = false, className = 'cover' }) {
  const [failed, setFailed] = useState(false);
  const responsiveListing = src?.startsWith('/images/listing-') && src.endsWith('.webp');
  return (
    <div className={className}>
      {src && !failed ? (
        <img
          src={src}
          srcSet={responsiveListing ? `${src.replace('.webp', '-360.webp')} 360w, ${src} 720w` : undefined}
          sizes={responsiveListing ? '(max-width: 767px) calc((100vw - 68px) / 2), (max-width: 1023px) 30vw, 280px' : undefined}
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
