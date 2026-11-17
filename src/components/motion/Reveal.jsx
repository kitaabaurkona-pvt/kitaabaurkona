import { useEffect, useRef, useState } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';

// Fades a block up into place the first time it scrolls into view (0.4s, 16px; the
// look is in styles/storefront-motion.css). Cards in a row pass their position as
// `index` for a short stagger (60ms, at most 5 steps). Once in view it is marked
// data-inview, which lets CSS draw details such as the gold rule under a heading. With
// Reduce animations the content is simply there.
function Reveal({ as: Tag = 'div', index = 0, style, children, ...props }) {
  const reduce = useReduceMotion();
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (reduce || inView || !ref.current) return undefined;
    // In view once 15% of the block shows.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [reduce, inView]);

  if (reduce) {
    return (
      <Tag style={style} {...props}>
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      ref={ref}
      data-reveal=""
      data-inview={inView || undefined}
      style={index ? { '--reveal-delay': `${Math.min(index, 5) * 0.06}s`, ...style } : style}
      {...props}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
