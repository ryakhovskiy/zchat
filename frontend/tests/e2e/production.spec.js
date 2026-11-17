import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { themes } from './helpers.js';

test('production image serves bundled assets with the current four-theme UI', async ({ request, baseURL }, testInfo) => {
  test.skip(process.env.E2E_EXPECT_BUNDLE !== '1', 'Set E2E_EXPECT_BUNDLE=1 when testing the isolated production image.');
  const index = await request.get('/');
  expect(index.ok()).toBeTruthy();
  expect(index.headers().server).toMatch(/nginx/i);
  const html = await index.text();
  expect(html).not.toMatch(/@vite\/client|\/src\/main\.jsx/);
  const script = html.match(/<script\b[^>]*\bsrc="(\/assets\/index-[\w-]+\.js)"/i)?.[1];
  const stylesheet = html.match(/<link\b[^>]*\bhref="(\/assets\/index-[\w-]+\.css)"/i)?.[1];
  expect(script, 'hashed production JavaScript entry').toBeTruthy();
  expect(stylesheet, 'hashed production stylesheet').toBeTruthy();
  const assets = [];
  let css;
  for (const path of [script, stylesheet, '/theme-init.js']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBeTruthy();
    const body = await response.body();
    assets.push({ path, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, contentType: response.headers()['content-type'], cacheControl: response.headers()['cache-control'] });
    if (path === stylesheet) {
      expect(response.headers()['content-type']).toMatch(/text\/css/);
      css = body.toString('utf8');
    } else expect(response.headers()['content-type']).toMatch(/javascript/);
    if (path === '/theme-init.js') expect(body).toEqual(await readFile(new URL('../../public/theme-init.js', import.meta.url)));
  }
  for (const theme of themes) {
    expect(css, `served ${theme} theme tokens`).toMatch(new RegExp(`\\[data-theme=["']?${theme}["']?\\][^{]*\\{[^}]*--color-bg\\s*:`));
  }
  expect(css).not.toMatch(/\[data-theme=["']?hacker["']?\]/);
  await testInfo.attach('production-assets', {
    contentType: 'application/json',
    body: JSON.stringify({ baseURL, server: index.headers().server, indexSha256: createHash('sha256').update(html).digest('hex'), themes, assets }, null, 2),
  });
});
