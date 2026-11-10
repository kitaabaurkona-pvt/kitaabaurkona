import { useEffect, useRef } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';

// A real scroll area: no cloned links. Change SPEED to adjust pixels per second.
const SPEED = 18;
export default function GenreSlider({ children }) {
  const rail = useRef(null);
  const reduced = useReduceMotion();
  useEffect(() => {
    const node = rail.current;
    if (!node || reduced) return undefined;
    let frame = 0, previous = 0, direction = 1, position = node.scrollLeft;
    let visible = false, hovered = false, pressed = false, resumeAt = 0;
    const tick = (now) => {
      const dt = previous ? Math.min(now - previous, 50) / 1000 : 0;
      previous = now;
      const focused = node.contains(document.activeElement);
      if (!hovered && !pressed && !focused && now > resumeAt) {
        const max = node.scrollWidth - node.clientWidth;
        if (max > 1) {
          position = Math.max(0, Math.min(max, position + direction * SPEED * dt));
          node.scrollLeft = position;
          if (position >= max) { direction = -1; resumeAt = now + 1000; }
          else if (position <= 0) { direction = 1; resumeAt = now + 1000; }
        }
      } else position = node.scrollLeft;
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame); previous = 0;
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(node);
    const enter = (e) => { if (e.pointerType === 'mouse') hovered = true; };
    const leave = () => { hovered = false; };
    const down = () => { pressed = true; };
    const up = () => { pressed = false; resumeAt = performance.now() + 3000; position = node.scrollLeft; };
    const wheel = () => { resumeAt = performance.now() + 3000; position = node.scrollLeft; };
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('pointerdown', down);
    node.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', down); node.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [reduced]);
  return <div className="genre-slider">
    <nav ref={rail} id="genre-rail" className="mood-grid auto-genre-rail" aria-label="Browse by genre" tabIndex={0}>{children}</nav>
  </div>;
}
