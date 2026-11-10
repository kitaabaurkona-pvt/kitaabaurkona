import { motion, useReducedMotion } from 'motion/react';
import { usePreferences } from '../../hooks/usePreferences';

// Entrance timing lives here. Reveal once; reduced motion keeps content stationary.
export function Reveal({ children, className, ...props }) {
  const systemReduced = useReducedMotion();
  const { motion: preference } = usePreferences();
  const reduced = systemReduced || preference === 'reduce';
  return <motion.section className={className} initial={reduced ? false : { opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.12 }}
    transition={{ duration: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }} {...props}>{children}</motion.section>;
}
