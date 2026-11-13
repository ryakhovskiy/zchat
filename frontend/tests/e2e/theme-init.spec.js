import { test, expect } from '@playwright/test';
import { themes } from './helpers.js';

for (const { stored, scheme, expected } of [
  ...themes.map(theme => ({ stored: theme, scheme: 'light', expected: theme })),
  { stored: 'hacker', scheme: 'light', expected: 'tech-green' },
  { stored: 'unknown-value', scheme: 'dark', expected: 'dark' },
  { stored: null, scheme: 'light', expected: 'light' },
  { stored: null, scheme: 'dark', expected: 'dark' },
]) {
  test(`before React: stored ${stored}, OS ${scheme} resolves ${expected}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(value => {
      if (value !== null) localStorage.setItem('zchat-theme', value);
      else localStorage.removeItem('zchat-theme');
    }, stored);
    let releaseEntry;
    let sawEntry;
    const entryBlocked = new Promise(resolve => { sawEntry = resolve; });
    const release = new Promise(resolve => { releaseEntry = resolve; });
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().resourceType() === 'script' && (/\/src\/main\.jsx$/.test(path) || /\/assets\/index[-.].*\.js$/.test(path))) {
        sawEntry();
        await release;
      }
      await route.continue();
    });
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await Promise.race([entryBlocked, new Promise((_, reject) => setTimeout(() => reject(new Error('React entry script was not intercepted')), 10_000))]);
      await expect(page.locator('#root')).toBeEmpty();
      await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
      const init = page.locator('head script[src*="theme-init"]');
      await expect(init).toHaveCount(1);
      expect(await init.evaluate(element => ({ async: element.async, defer: element.defer, type: element.type }))).toEqual({ async: false, defer: false, type: '' });
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#[\da-f]{6}$/i);
      if (stored === 'hacker') expect(await page.evaluate(() => localStorage.getItem('zchat-theme'))).toBe('tech-green');
    } finally { releaseEntry(); }
    await expect(page.locator('.auth-card')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
  });
}

test('storage denial still boots the OS theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'zchat-theme') throw new DOMException('Denied', 'SecurityError');
      return original.call(this, key);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.auth-card')).toBeVisible();
  expect(errors).toEqual([]);
});
