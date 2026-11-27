import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TIP_WIDTH = 260;

// ShopDeck's hover text: a small dark box next to an underlined label, shown while the
// pointer is on it (or it has keyboard focus). It is drawn on top of the page, so table
// edges never cut it off.
function HoverHint({ tip, children, className = '' }) {
  const [box, setBox] = useState(null);
  const anchor = useRef(null);
  const id = useId();

  function open() {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.bottom + 90 < window.innerHeight;
    setBox({
      left: Math.round(Math.min(Math.max(8, r.left), window.innerWidth - TIP_WIDTH - 8)),
      top: Math.round(below ? r.bottom + 6 : r.top - 6),
      below,
    });
  }
  const close = () => setBox(null);

  return (
    <>
      <span
        ref={anchor}
        className={`ap-hint ${className}`.trim()}
        tabIndex={0}
        aria-describedby={box ? id : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        {children}
      </span>
      {box &&
        createPortal(
          <span id={id} role="tooltip" className="ap-tooltip" data-place={box.below ? 'below' : 'above'} style={{ left: box.left, top: box.top, maxWidth: TIP_WIDTH }}>
            {tip}
          </span>,
          document.body,
        )}
    </>
  );
}

export default HoverHint;
