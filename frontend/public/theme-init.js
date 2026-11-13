/*
 * Runs synchronously from <head> BEFORE React mounts, so the first paint already has the
 * right theme (no flash). External file (not inline) so a future CSP without
 * 'unsafe-inline' keeps working. Keep the id list and the colours in sync with
 * src/utils/theme.js and the --color-header-bg tokens in src/styles/themes.css
 * (ThemeContext re-reads the real token after mount, so this map only matters for first paint).
 */
(function () {
  var KEY = 'zchat-theme';
  var HEADER = {
    light: '#ffffff',
    dark: '#171a21',
    'tech-green': '#0a1310',
    'tech-red': '#140c0e'
  };
  var saved = null;
  try {
    saved = window.localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  // Legacy id: "hacker" became "tech-green"
  if (saved === 'hacker') {
    saved = 'tech-green';
    try {
      window.localStorage.setItem(KEY, saved);
    } catch (e) {
      /* storage unavailable: ignore */
    }
  }
  var theme = saved && Object.prototype.hasOwnProperty.call(HEADER, saved) ? saved : null;
  if (!theme) {
    var dark = false;
    try {
      dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      dark = false;
    }
    theme = dark ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', HEADER[theme]);
})();
