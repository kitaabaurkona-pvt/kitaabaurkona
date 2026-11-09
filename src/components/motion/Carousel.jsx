import { Children, useCallback, useEffect, useRef, useState } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const SLIDE_MS = 500;
const SWIPE = 48;

// perView is a number or a map of min-width → slides, e.g. { 0: 2, 768: 3, 1280: 5 }.
function readPerView(spec) {
  if (typeof spec === 'number') return spec;
  let value = 1;
  for (const [min, n] of Object.entries(spec)
    .map(([k, v]) => [Number(k), v])
    .sort((a, b) => a[0] - b[0])) {
    if (window.matchMedia(`(min-width: ${min}px)`).matches) value = n;
  }
  return value;
}

function usePerView(spec) {
  const key = JSON.stringify(spec);
  const [value, setValue] = useState(() => readPerView(spec));
  useEffect(() => {
    const parsed = JSON.parse(key);
    if (typeof parsed === 'number') return undefined;
    const queries = Object.keys(parsed).map((min) => window.matchMedia(`(min-width: ${min}px)`));
    const update = () => setValue(readPerView(parsed));
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, [key]);
  return typeof spec === 'number' ? spec : value;
}

// A sideways-sliding carousel like the previous store's: slides move 0.5s, loop without
// end, and can be moved with arrows, dots or a swipe. With `autoplay` it moves on by
// itself, pauses while hovered, focused or the tab is hidden, and stops for good once
// someone uses it. Reduce animations: no autoplay and no sliding (instant changes).
function Carousel({
  children,
  label,
  itemLabel = 'slide',
  perView = 1,
  autoplay = 0,
  arrows = true,
  dots = true,
  loop: loopProp = true,
  className = '',
}) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const per = Math.max(1, Math.min(usePerView(perView), count || 1));
  const loop = loopProp && count > per;
  const clones = loop ? per : 0;
  const maxOffset = loop ? count - 1 : Math.max(0, count - per);
  const reduce = useReduceMotion();

  const [rawOffset, setOffset] = useState(0);
  // A non-looping row may have fewer positions after the screen widens; stay in range.
  const offset = loop ? rawOffset : Math.min(Math.max(rawOffset, 0), maxOffset);
  const [animate, setAnimate] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [stopped, setStopped] = useState(false);
  const [dragX, setDragX] = useState(0);
  const drag = useRef(null);
  const dragged = useRef(false);

  const movable = count > per;
  const auto = autoplay > 0 && movable && !stopped && !reduce;
  const running = auto && !hovered && !focused && !hidden;

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Moves by one slide. While a loop is passing over its seam (showing a copy of the
  // first or last slide) further moves wait until it has been put back in place.
  const step = useCallback(
    (dir) => {
      setAnimate(true);
      setOffset((current) => {
        if (loop) return current < 0 || current >= count ? current : current + dir;
        const next = Math.min(Math.max(current, 0), maxOffset) + dir;
        if (next > maxOffset) return 0;
        if (next < 0) return maxOffset;
        return next;
      });
    },
    [loop, count, maxOffset],
  );

  const goTo = (index) => {
    setStopped(true);
    setAnimate(true);
    setOffset(Math.max(0, Math.min(index, maxOffset)));
  };

  const userStep = (dir) => {
    setStopped(true);
    step(dir);
  };

  // After sliding onto a copy at either end, jump (without animation) to the real slide.
  useEffect(() => {
    if (!loop || (offset >= 0 && offset < count)) return undefined;
    const fix = () => {
      setAnimate(false);
      setOffset((current) => ((current % count) + count) % count);
    };
    if (reduce) {
      fix();
      return undefined;
    }
    const timer = setTimeout(fix, SLIDE_MS + 40);
    return () => clearTimeout(timer);
  }, [offset, loop, count, reduce]);

  useEffect(() => {
    if (animate) return undefined;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setAnimate(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [animate]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => step(1), autoplay);
    return () => clearInterval(timer);
  }, [running, autoplay, step]);

  if (count === 0) return null;

  const track = loop
    ? [
        ...slides.slice(count - clones).map((node, i) => ({ node, real: count - clones + i, copy: true })),
        ...slides.map((node, i) => ({ node, real: i, copy: false })),
        ...slides.slice(0, clones).map((node, i) => ({ node, real: i, copy: true })),
      ]
    : slides.map((node, i) => ({ node, real: i, copy: false }));
  const pos = offset + clones;
  const current = ((offset % count) + count) % count;
  const pages = loop ? count : maxOffset + 1;
  const sliding = animate && !reduce && dragX === 0;

  function onPointerDown(event) {
    if (!movable || event.pointerType === 'mouse') return;
    drag.current = { x: event.clientX };
    dragged.current = false;
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    if (Math.abs(dx) > 6) dragged.current = true;
    setDragX(dx);
  }

  function endDrag(event, cancelled) {
    if (!drag.current) return;
    const dx = cancelled ? 0 : event.clientX - drag.current.x;
    drag.current = null;
    setDragX(0);
    if (Math.abs(dx) > SWIPE) userStep(dx < 0 ? 1 : -1);
  }

  return (
    <section
      className={`carousel ${className}`.trim()}
      aria-roledescription="carousel"
      aria-label={label}
      data-per-view={per}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className="carousel-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault();
            event.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        <div
          className="carousel-track"
          aria-live={auto ? 'off' : 'polite'}
          style={{
            transform: `translateX(calc(${(-pos * 100) / per}% + ${dragX}px))`,
            transition: sliding ? `transform ${SLIDE_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)` : 'none',
          }}
        >
          {track.map(({ node, real, copy }, index) => {
            const visible = !copy && index >= pos && index < pos + per;
            return (
              <div
                key={`${copy ? 'copy' : 'slide'}-${index}`}
                className="carousel-slide"
                style={{ flexBasis: `${100 / per}%` }}
                role={copy ? undefined : 'group'}
                aria-roledescription={copy ? undefined : 'slide'}
                aria-label={copy ? undefined : `${real + 1} of ${count}`}
                aria-hidden={!visible || undefined}
                inert={!visible || undefined}
                data-copy={copy || undefined}
              >
                {node}
              </div>
            );
          })}
        </div>
      </div>

      {movable && arrows && (
        <>
          <button type="button" className="carousel-arrow carousel-prev" aria-label={`Previous ${itemLabel}`} onClick={() => userStep(-1)}>
            <ChevronLeftIcon size={20} />
          </button>
          <button type="button" className="carousel-arrow carousel-next" aria-label={`Next ${itemLabel}`} onClick={() => userStep(1)}>
            <ChevronRightIcon size={20} />
          </button>
        </>
      )}

      {movable && dots && (
        <div className="carousel-dots">
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              className="carousel-dot"
              aria-label={`Show ${itemLabel} ${index + 1} of ${pages}`}
              aria-current={index === current ? 'true' : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default Carousel;
