import { useEffect, useRef, useState } from 'react';
import BookCover from './BookCover';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

// A book's photos as a strip that snaps to one photo at a time: swipe on phones,
// scroll sideways with a trackpad, use the arrows (shown when pointing at it), the
// arrow keys, or the thumbnails. Dots and thumbnails always show which photo is on.
function BookGallery({ images, title, discount = 0 }) {
  const photos = images.length > 0 ? images : [null];
  const many = photos.length > 1;
  const [active, setActive] = useState(0);
  const track = useRef(null);
  const frame = useRef(0);
  const reduce = useReduceMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The photo in view decides which dot and thumbnail are lit.
  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current;
      if (!el || !el.clientWidth) return;
      const index = Math.round(el.scrollLeft / el.clientWidth);
      setActive(Math.max(0, Math.min(photos.length - 1, index)));
    });
  }

  function go(index) {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(photos.length - 1, index));
    setActive(next);
    el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowRight') go(active + 1);
    else if (event.key === 'ArrowLeft') go(active - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(photos.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <>
      <div className="gallery-main">
        <div
          ref={track}
          className="gallery-track"
          role="group"
          aria-roledescription={many ? 'carousel' : undefined}
          aria-label={many ? `Photos of ${title}: ${active + 1} of ${photos.length}` : undefined}
          tabIndex={many ? 0 : undefined}
          onScroll={many ? onScroll : undefined}
          onKeyDown={many ? onKeyDown : undefined}
        >
          {photos.map((src, index) => (
            <div key={src ?? 'none'} className="gallery-slide" data-active={index === active || undefined} aria-hidden={(many && index !== active) || undefined}>
              <BookCover src={src} title={title} eager={index === 0} full />
            </div>
          ))}
        </div>
        {discount > 0 && <span className="cover-tag">−{discount}%</span>}
        {many && (
          <>
            <button type="button" className="gallery-arrow gallery-prev" aria-label="Previous photo" disabled={active === 0} onClick={() => go(active - 1)}>
              <ChevronLeftIcon size={20} />
            </button>
            <button type="button" className="gallery-arrow gallery-next" aria-label="Next photo" disabled={active === photos.length - 1} onClick={() => go(active + 1)}>
              <ChevronRightIcon size={20} />
            </button>
            <div className="gallery-dots" aria-hidden="true">
              {photos.map((src, index) => (
                <span key={src} data-active={index === active || undefined} />
              ))}
            </div>
          </>
        )}
      </div>
      {many && (
        <ul className="gallery-thumbs" aria-label="Book images">
          {photos.map((src, index) => (
            <li key={src}>
              <button type="button" className="thumb" aria-pressed={index === active} aria-label={`Show image ${index + 1} of ${photos.length}`} onClick={() => go(index)}>
                <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default BookGallery;
