import { useEffect, useState } from 'react';
import { usePreferences } from './usePreferences';

const QUERY = '(prefers-reduced-motion: reduce)';

// True when the visitor chose "Reduce animations" in Settings or their device asks
// for reduced motion. Used for movement that motion's MotionConfig cannot cover, such
// as a slider advancing on its own or smooth scrolling.
export function useReduceMotion() {
  const { motion } = usePreferences();
  const [system, setSystem] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const onChange = () => setSystem(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return motion === 'reduce' || system;
}
