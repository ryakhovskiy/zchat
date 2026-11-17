import { readdir, readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const source = new URL('../../src/', import.meta.url);

async function styles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await styles(path));
    else if (entry.name.endsWith('.css')) files.push(path);
  }
  return files;
}

test('component styles consume theme colors or explain a literal exception', async () => {
  const violations = [];
  for (const file of await styles(source)) {
    if (file.pathname.endsWith('/styles/themes.css')) continue;
    const css = await readFile(file, 'utf8');
    // Keep comment boundaries/newlines so diagnostics identify the original line.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
    const originalLines = css.split('\n');
    stripped.split('\n').forEach((line, index) => {
      if (/(?:#[\da-f]{3,8}\b|\brgba?\s*\(|:\s*(?:white|black|red|green|blue|gray|grey|darkgray|silver|navy|teal|lime|maroon|purple|aqua|fuchsia|orange)\b)/i.test(line)) {
        const reason = originalLines[index].match(/\/\*\s*(.{12,}?)\s*\*\//);
        if (!reason) violations.push(`${file.pathname.split('/src/')[1]}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  expect(violations, 'literal colors outside theme tokens need an inline justification').toEqual([]);
});

test('the viewport opts into device width and safe areas', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i)?.[1];
  expect(viewport).toContain('width=device-width');
  expect(viewport).toContain('initial-scale=1');
  expect(viewport).toContain('viewport-fit=cover');
});
