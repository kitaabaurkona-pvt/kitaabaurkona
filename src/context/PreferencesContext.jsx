import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { PreferencesContext } from './preferencesContextObject';
import { applyPreferences, readPreferences, savePreferences } from '../utils/preferences';

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
      <MotionConfig reducedMotion={prefs.motion === 'reduce' ? 'always' : 'user'}>{children}</MotionConfig>
    </PreferencesContext.Provider>
  );
}
