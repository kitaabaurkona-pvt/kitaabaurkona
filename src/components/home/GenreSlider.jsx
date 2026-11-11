import { Children, cloneElement, useEffect, useRef } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';

// Pixels per second the row drifts by.
const SPEED = 30;
// After a swipe, scroll or keyboard visit the row waits this long before drifting again.
const RESUME_MS = 2500;
// Copies of the tiles that follow the real ones, so the loop never runs out.
const COPIES = 2;

// The genre row: a seamless loop that drifts to the left. The real tiles are followed
// by copies (hidden from assistive tech and the keyboard), and the row moves by exactly
// one set of tiles per cycle, so it never reverses or jumps. The browser runs the
// movement (Web Animations, transforms only); swiping, a sideways trackpad scroll and
// keyboard focus move it by hand. It pauses while pointed at, touched or focused, while
// off screen or in a hidden tab, and stays still with Reduce animations (swiping and
// scrolling still work).
export default function GenreSlider({ children, label = 'Browse by genre' }) {
  const rail = useRef(null);
  const track = useRef(null);
  const firstSet = useRef(null);
  const reduce = useReduceMotion();

  useEffect(() => {
    const node = rail.current;
    const strip = track.current;
    const set = firstSet.current;
    if (!node || !strip || !set || typeof strip.animate !== 'function') return undefined;

    let animation = null;
    let width = 0;
    let visible = false;
    let hovered = false;
    let focused = false;
    let held = false;
    let drag = null;
    let swallowClick = false;
    let resumeTimer = 0;

    const duration = () => animation?.effect.getTiming().duration ?? 1;
    // Moves the row by px pixels (positive: the tiles go left), wrapping around.
    const shift = (px) => {
      if (!animation || !width) return;
      const d = duration();
      animation.currentTime = ((((animation.currentTime ?? 0) + (px / width) * d) % d) + d) % d;
    };
    const update = () => {
      if (!animation) return;
      const run = !reduce && visible && !document.hidden && !hovered && !focused && !held && !drag;
      if (run && animation.playState !== 'running') animation.play();
      if (!run && animation.playState === 'running') animation.pause();
    };
    const holdForAWhile = () => {
      held = true;
      update();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        held = false;
        update();
      }, RESUME_MS);
    };

    // One cycle moves the row by the width of one set of tiles (and the gap after it).
    const build = () => {
      const progress = animation ? ((animation.currentTime ?? 0) % duration()) / duration() : 0;
      animation?.cancel();
      const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
      width = set.getBoundingClientRect().width + gap;
      if (!width) return;
      animation = strip.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${-width}px, 0, 0)` }], {
        duration: (width / SPEED) * 1000,
        iterations: Infinity,
        easing: 'linear',
      });
      animation.currentTime = progress * duration();
      animation.pause();
      update();
    };
    // Tile size follows the row: three to a row on phones, wider tiles on large screens.
    const measure = () => {
      const w = node.clientWidth;
      node.style.setProperty('--genre-tile', `${w < 768 ? (w - 20) / 3 : Math.min(270, Math.max(180, w * 0.24))}px`);
      build();
    };

    // Swiping (touch and pen) drags the row; a mouse can simply click the tiles.
    const down = (e) => {
      if (e.pointerType === 'mouse') return;
      drag = { x: e.clientX, y: e.clientY, axis: null, moved: false };
      update();
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (drag.axis !== 'x') return;
      drag.moved = true;
      shift(-dx);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = () => {
      if (!drag) return;
      swallowClick = drag.moved;
      drag = null;
      holdForAWhile();
    };
    // A swipe that ends on a tile must not open it.
    const click = (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    // A sideways trackpad or shift-wheel scroll moves the row by hand.
    const wheel = (e) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      shift(dx);
      holdForAWhile();
    };
    const enter = (e) => {
      if (e.pointerType !== 'mouse') return;
      hovered = true;
      update();
    };
    const leave = (e) => {
      if (e.pointerType !== 'mouse') return;
      hovered = false;
      update();
    };
    // Tabbing to a tile pauses the row and brings that tile fully into view.
    const focusIn = (e) => {
      const tile = e.target.closest('.mood-tile');
      focused = true;
      if (tile && set.contains(tile) && animation) {
        const d = duration();
        animation.currentTime = ((Math.max(0, tile.offsetLeft - 24) % width) / width) * d;
      }
      update();
    };
    const focusOut = (e) => {
      if (node.contains(e.relatedTarget)) return;
      focused = false;
      update();
    };
    const visibility = () => update();

    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    const resize = new ResizeObserver(measure);
    seen.observe(node);
    resize.observe(node);
    measure();

    node.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    node.addEventListener('click', click, true);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focusin', focusIn);
    node.addEventListener('focusout', focusOut);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(resumeTimer);
      seen.disconnect();
      resize.disconnect();
      animation?.cancel();
      node.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      node.removeEventListener('click', click, true);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focusin', focusIn);
      node.removeEventListener('focusout', focusOut);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [reduce]);

  const copies = Array.from({ length: COPIES }, (_, i) => (
    <div key={i} className="genre-set" aria-hidden="true" inert>
      {Children.map(children, (child) => cloneElement(child, { tabIndex: -1 }))}
    </div>
  ));

  return (
    <div className="genre-slider">
      <nav ref={rail} id="genre-rail" className="genre-rail-loop" aria-label={label}>
        <div ref={track} className="genre-track">
          <div ref={firstSet} className="genre-set">
            {children}
          </div>
          {copies}
        </div>
      </nav>
    </div>
  );
}
