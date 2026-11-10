import { useEffect, useRef } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const SPEED = 18; // Pixels per second; the browser animates transforms, not scrollLeft.
export default function GenreSlider({ children }) {
  const rail = useRef(null);
  const track = useRef(null);
  const reduced = useReduceMotion();
  useEffect(() => {
    const node = rail.current, strip = track.current;
    if (!node || !strip) return undefined;
    let animation, timer, visible = false, hovered = false, pressed = false, keyboard = false, direction = 1, position = 0, disposed = false;
    const max = () => Math.max(0, strip.scrollWidth - node.clientWidth);
    const stop = () => {
      clearTimeout(timer);
      if (animation) {
        // Materialise the visual position as a native scroll offset for manual input.
        const offset = -new DOMMatrixReadOnly(getComputedStyle(strip).transform).m41;
        animation.onfinish = null; animation.cancel(); animation = null;
        strip.style.transform = '';
        position = Math.max(0, Math.min(max(), offset));
        node.scrollLeft = position;
      } else position = node.scrollLeft;
    };
    const blocked = () => reduced || !visible || document.hidden || hovered || pressed || (keyboard && node.contains(document.activeElement));
    const play = () => {
      clearTimeout(timer);
      if (disposed || blocked() || animation || max() < 1) return;
      position = Math.max(0, Math.min(max(), node.scrollLeft));
      if (position >= max() - 1) direction = -1;
      if (position <= 1) direction = 1;
      const target = direction > 0 ? max() : 0;
      // Transfer native scroll into the transform without a visible jump.
      strip.style.transform = `translate3d(${-position}px,0,0)`;
      node.scrollLeft = 0;
      animation = strip.animate([
        { transform:`translate3d(${-position}px,0,0)` },
        { transform:`translate3d(${-target}px,0,0)` },
      ], { duration:Math.max(300,Math.abs(target-position)/SPEED*1000), easing:'linear', fill:'forwards' });
      animation.onfinish = () => {
        stop(); strip.style.transform = ''; direction *= -1;
        timer = setTimeout(play, 500);
      };
    };
    const pause = () => { stop(); strip.style.transform = ''; };
    const resume = (delay=0) => { clearTimeout(timer); timer=setTimeout(play,delay); };
    const measure = () => {
      pause();
      const width = node.clientWidth;
      node.style.setProperty('--genre-card-width',`${width < 768 ? (width-20)/3 : Math.min(280,Math.max(170,width*.28))}px`);
      resume();
    };
    const enter = e => { if(e.pointerType==='mouse') { hovered=true; pause(); } };
    const leave = () => { hovered=false; if(!pressed) resume(); };
    const down = () => { keyboard=false; pressed=true; pause(); };
    const up = () => { if(!pressed)return; pressed=false; resume(2000); };
    const pointer = () => { keyboard=false; if(!pressed) resume(); };
    const key = e => { if(['Tab','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { keyboard=true; if(node.contains(document.activeElement))pause(); } };
    const focus = () => { if(keyboard)pause(); };
    const blur = e => { if(!node.contains(e.relatedTarget))resume(); };
    const wheel = () => { pause(); resume(2000); };
    const visibility = () => { if(document.hidden)pause();else resume(); };
    const intersection = new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; if(visible)resume();else pause(); });
    const resize = new ResizeObserver(measure);
    intersection.observe(node);resize.observe(node);measure();
    node.addEventListener('pointerenter',enter);node.addEventListener('pointerleave',leave);node.addEventListener('pointerdown',down);
    node.addEventListener('touchstart',down,{passive:true});node.addEventListener('wheel',wheel,{passive:true});
    node.addEventListener('focusin',focus);node.addEventListener('focusout',blur);
    window.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('touchend',up);window.addEventListener('touchcancel',up);
    document.addEventListener('visibilitychange',visibility);
    return()=>{
      disposed=true;pause();intersection.disconnect();resize.disconnect();
      node.removeEventListener('pointerenter',enter);node.removeEventListener('pointerleave',leave);node.removeEventListener('pointerdown',down);node.removeEventListener('touchstart',down);node.removeEventListener('wheel',wheel);node.removeEventListener('focusin',focus);node.removeEventListener('focusout',blur);
      window.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('touchend',up);window.removeEventListener('touchcancel',up);document.removeEventListener('visibilitychange',visibility);
    };
  }, [reduced]);
  return <div className="genre-slider"><nav ref={rail} id="genre-rail" className="mood-grid auto-genre-rail" aria-label="Browse by genre" tabIndex={0}><div ref={track} className="genre-track">{children}</div></nav></div>;
}
