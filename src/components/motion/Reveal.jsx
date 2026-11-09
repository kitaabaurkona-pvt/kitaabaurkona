import { motion } from 'motion/react';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const EASE = [0.25, 0.8, 0.25, 1];

// Fades a block up into place the first time it scrolls into view (0.4s, 16px).
// Cards in a row pass their position as `index` for a short stagger (60ms, at most 5
// steps). With Reduce animations the content is simply there.
function Reveal({ as = 'div', index = 0, children, ...props }) {
  const reduce = useReduceMotion();
  if (reduce) {
    const Tag = as;
    return <Tag {...props}>{children}</Tag>;
  }
  const Component = motion[as];
  return (
    <Component
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.4, ease: EASE, delay: Math.min(index, 5) * 0.06 }}
      {...props}
    >
      {children}
    </Component>
  );
}

export default Reveal;
