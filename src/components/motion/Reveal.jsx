import { motion } from 'motion/react';

import { EASE } from './presets';

// Fades and lifts its content into place the first time it scrolls into view.
export function Reveal({ as = 'div', delay = 0, children, ...props }) {
  const Component = motion[as];
  return (
    <Component
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.5, ease: EASE, delay }}
      {...props}
    >
      {children}
    </Component>
  );
}
