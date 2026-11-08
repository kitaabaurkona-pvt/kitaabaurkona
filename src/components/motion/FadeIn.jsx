import { motion } from 'motion/react';

// Content that has just arrived (replacing its skeleton) fades in once, as a whole.
// No stagger, no movement, nothing tied to scrolling.
export function FadeIn({ as = 'div', children, ...props }) {
  const Component = motion[as];
  return (
    <Component initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: 'linear' }} {...props}>
      {children}
    </Component>
  );
}
