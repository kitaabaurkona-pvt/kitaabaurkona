import { useCallback, useEffect, useMemo, useState } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { PreferencesContext } from './preferencesContextObject';
import { applyPreferences, readPreferences, savePreferences } from '../utils/preferences';

// Animations use the small `m.` components; the engine that runs them is a separate
// file, fetched while the first screen is drawn (nothing animates before a visitor does
// something). `strict` makes a full `motion.` component, which would bring the whole
// engine back into the first download, an error.
const loadMotionFeatures = () => import('../utils/motionFeatures').then((module) => module.default);

// Theme (system / light / dark) and motion (system / reduce), saved in this browser.
export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(readPreferences);

  useEffect(() => {
    applyPreferences(prefs);
    savePreferences(prefs);
    if (prefs.theme !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPreferences(prefs);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [prefs]);

  const setTheme = useCallback((theme) => setPrefs((p) => ({ ...p, theme })), []);
  const setMotion = useCallback((motion) => setPrefs((p) => ({ ...p, motion })), []);

  const value = useMemo(() => {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return { ...prefs, dark, setTheme, setMotion };
  }, [prefs, setTheme, setMotion]);

  return (
    <PreferencesContext.Provider value={value}>
      <LazyMotion features={loadMotionFeatures} strict>
        <MotionConfig reducedMotion={prefs.motion === 'reduce' ? 'always' : 'user'}>{children}</MotionConfig>
      </LazyMotion>
    </PreferencesContext.Provider>
  );
}
