// Measures WCAG contrast for the token pairs in src/styles/themes.css.
// Usage: node scripts/check-contrast.mjs   (exit code 1 if any pair fails)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/styles/themes.css'),
  'utf8'
);

const themes = {};
for (const m of css.matchAll(/\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
  const tokens = {};
  for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[d[1]] = d[2].trim();
  if (!themes[m[1]]) themes[m[1]] = {};
  Object.assign(themes[m[1]], tokens);
}
delete themes.undefined;

const hex = (v) => {
  const h = v.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (c) => {
  const [r, g, b] = hex(c).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground token, background token, minimum ratio, label]
const PAIRS = [
  ['--color-text', '--color-bg', 4.5, 'text on page'],
  ['--color-text', '--color-surface', 4.5, 'text on surface'],
  ['--color-text', '--color-surface-raised', 4.5, 'text on raised surface'],
  ['--color-text-secondary', '--color-bg', 4.5, 'secondary text on page'],
  ['--color-text-secondary', '--color-surface', 4.5, 'secondary text on surface'],
  ['--color-text-muted', '--color-bg', 4.5, 'muted text on page'],
  ['--color-text-muted', '--color-surface', 4.5, 'muted text on surface'],
  ['--color-text-muted', '--color-surface-raised', 4.5, 'muted text on raised surface'],
  ['--color-header-text', '--color-header-bg', 4.5, 'header text'],
  ['--color-on-accent', '--color-accent', 4.5, 'text on accent button'],
  ['--color-on-accent', '--color-accent-hover', 4.5, 'text on accent button (hover)'],
  ['--color-accent-text', '--color-bg', 4.5, 'accent text/link on page'],
  ['--color-accent-text', '--color-surface', 4.5, 'accent text/link on surface'],
  ['--color-accent-text', '--color-accent-soft', 4.5, 'accent text on accent-soft'],
  ['--color-focus-ring', '--color-bg', 3, 'focus ring on page'],
  ['--color-focus-ring', '--color-surface', 3, 'focus ring on surface'],
  ['--bubble-out-text', '--bubble-out-bg', 4.5, 'outgoing bubble text'],
  ['--bubble-in-text', '--bubble-in-bg', 4.5, 'incoming bubble text'],
  ['--color-text-secondary', '--bubble-in-bg', 4.5, 'secondary text in incoming bubble'],
  ['--color-danger', '--color-bg', 4.5, 'danger text on page'],
  ['--color-danger', '--color-surface', 4.5, 'danger text on surface'],
  ['--color-danger', '--color-danger-soft', 4.5, 'danger text on danger-soft'],
  ['--color-success', '--color-surface', 4.5, 'success text on surface'],
  ['--color-warning', '--color-surface', 4.5, 'warning text on surface'],
  ['--color-online', '--color-surface', 3, 'online dot on surface'],
  ['--avatar-text', '@avatar', 4.5, 'avatar initials (worst hue)'],
];

// Avatar background is hsl(hue, --avatar-s, --avatar-l); check the worst hue
const hsl2hex = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
};

let failed = 0;
const report = {};
for (const [id, t] of Object.entries(themes)) {
  console.log(`\n${id}`);
  for (const [fg, bg, min, label] of PAIRS) {
    let r;
    if (bg === '@avatar') {
      const s = parseFloat(t['--avatar-s']);
      const l = parseFloat(t['--avatar-l']);
      r = Math.min(...Array.from({ length: 36 }, (_, i) => ratio(t[fg], hsl2hex(i * 10, s, l))));
    } else {
      if (!t[fg] || !t[bg]) { console.log(`  ?? ${label}: missing ${fg} or ${bg}`); failed++; continue; }
      r = ratio(t[fg], t[bg]);
    }
    const ok = r >= min;
    if (!ok) failed++;
    (report[id] ||= []).push([label, r.toFixed(2), min]);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}  (>= ${min})  ${label}`);
  }
}
console.log(failed ? `\n${failed} pair(s) failed` : '\nAll pairs pass WCAG AA');
process.exit(failed ? 1 : 0);
