const STORAGE_KEY = 'kitaab_corner_prefs';
const THEMES = ['system', 'light', 'dark'];
const MOTIONS = ['system', 'reduce'];

export function readPreferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      theme: THEMES.includes(raw.theme) ? raw.theme : 'light',
      motion: MOTIONS.includes(raw.motion) ? raw.motion : 'system',
    };
  } catch {
    return { theme: 'light', motion: 'system' };
  }
}

export function savePreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable; the choice still applies for this visit.
  }
}

export function applyPreferences({ theme, motion }) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const themeColor = document.querySelector('meta[name=theme-color]');
  if (themeColor) themeColor.content = dark ? '#080808' : '#fff1bd';
  if (motion === 'reduce') root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}
