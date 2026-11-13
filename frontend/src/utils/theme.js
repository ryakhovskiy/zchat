// Theme ids, storage key and normalisation. Keep in sync with public/theme-init.js
// and the [data-theme] blocks in src/styles/themes.css.

export const THEME_STORAGE_KEY = 'zchat-theme';
export const THEMES = ['light', 'dark', 'tech-green', 'tech-red'];
const LEGACY_THEMES = { hacker: 'tech-green' };

/** Map a stored value to a valid theme id, or null if it is unknown. */
export const normalizeTheme = (value) => {
  const mapped = LEGACY_THEMES[value] || value;
  return THEMES.includes(mapped) ? mapped : null;
};

export const readStoredTheme = () => {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const writeStoredTheme = (theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode, blocked): the choice just won't persist */
  }
};

export const systemTheme = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

/** Push the active theme's header colour into <meta name="theme-color">. */
export const syncThemeColorMeta = () => {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-header-bg')
    .trim();
  if (color) meta.setAttribute('content', color);
};
