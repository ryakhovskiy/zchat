import { test, expect } from '@playwright/test';
import {
  themes, prepare, login, openConversation, openSettings, selectTheme,
  capture, assertFits, assertNoOverflow, assertTouchTargets, dismiss,
} from './helpers.js';

for (const theme of themes) {
  test(`${theme}: login, register, list, settings, picker and chat`, async ({ page }, testInfo) => {
    await prepare(page, theme);
    await page.goto('/');
    await expect(page.locator('.auth-card')).toBeVisible();
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe(theme === 'light' ? 'light' : 'dark');
    await capture(page, testInfo, 'login');
    // Auth forms may scroll vertically on a short landscape viewport. Every
    // control must remain reachable; the whole card need not fit at once.
    for (const selector of ['#username', '#password', '.auth-card button[type="submit"]']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await assertFits(page.locator(selector), `login ${selector}`);
    }
    await assertTouchTargets(page, '.password-toggle, .auth-card button[type="submit"], .auth-switch button', 'login');
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await capture(page, testInfo, 'register');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await login(page);
    await capture(page, testInfo, 'conversation-list');
    await assertTouchTargets(page, '.top-bar button, .new-chat-button, .conversation-item', 'list');

    await openSettings(page);
    const themeGroup = page.getByRole('radiogroup', { name: /theme/i });
    await expect(themeGroup.getByRole('radio')).toHaveCount(4);
    await expect(themeGroup.getByRole('radio', { checked: true })).toHaveCount(1);
    await capture(page, testInfo, 'settings', page.getByTestId('settings-sheet'));
    await assertTouchTargets(page, '[data-testid="settings-sheet"] button', 'settings');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radiogroup', { name: /theme/i })).toBeHidden();

    await page.locator('.new-chat-button').click();
    await expect(page.locator('.user-list-modal')).toBeVisible();
    await capture(page, testInfo, 'user-picker', page.locator('.user-list-modal'));
    await assertTouchTargets(page, '.user-list-modal button, .user-item, .toggle-option', 'user picker');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-list-root')).toBeHidden();

    await openConversation(page);
    await expect(page.locator('.message').first()).toBeVisible();
    await capture(page, testInfo, 'chat');
    await assertFits(page.locator('.message-input-container'), 'composer');
    await assertTouchTargets(page, '.mobile-back-button, .call-button, .emoji-button, .attachment-button, .send-button', 'chat');
    if (page.viewportSize().width < 768) {
      expect(await page.locator('.message-input').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
      await expect(page.locator('.top-bar')).toBeHidden();
      await expect(page.locator('.sidebar')).toBeHidden();
      await page.locator('.message-input').focus();
      await assertFits(page.locator('.message-input'), 'focused composer');
      await page.locator('.mobile-back-button').click();
      await expect(page.getByTestId('conversation-list')).toBeVisible();
      await expect(page.locator('.message-input')).toBeHidden();
      await expect(page.locator('.top-bar')).toBeVisible();
      await openConversation(page);
    } else {
      await expect(page.locator('.sidebar')).toBeVisible();
      const width = (await page.locator('.sidebar').boundingBox()).width;
      if (page.viewportSize().width < 1024) expect(width).toBeGreaterThanOrEqual(280);
    }
    // Exercise textarea growth and shrinking without sending to shared seed data.
    const input = page.locator('.message-input');
    const initialHeight = (await input.boundingBox()).height;
    await input.fill('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    expect((await input.boundingBox()).height).toBeGreaterThan(initialHeight);
    expect((await input.boundingBox()).height).toBeLessThanOrEqual(160);
    await assertFits(page.locator('.message-input-container'), 'grown composer');
    await assertNoOverflow(page, 'grown composer');
    await input.fill('');
  });
}

test('theme choices persist across reload and update browser chrome', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await login(page);
  const metaColors = new Set();
  for (const theme of themes) {
    await openSettings(page);
    await selectTheme(page, theme);
    expect(await page.evaluate(() => localStorage.getItem('zchat-theme'))).toBe(theme);
    const color = await page.locator('meta[name="theme-color"]').getAttribute('content');
    metaColors.add(color.toLowerCase());
    const tokenColor = await page.locator('html').evaluate(element => {
      const probe = document.createElement('div');
      probe.style.background = getComputedStyle(element).getPropertyValue('--color-header-bg');
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    });
    const normalizedMeta = await page.evaluate(value => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return rgb;
    }, color);
    expect(normalizedMeta).toBe(tokenColor);
    await page.reload();
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', color);
  }
  expect(metaColors.size).toBe(4);
  // The radiogroup must support keyboard navigation, not just pointer selection.
  await openSettings(page);
  await page.getByRole('radiogroup', { name: /theme/i }).getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^Light/i })).toBeChecked();
});

for (const mode of ['close', 'scrim', 'escape']) {
  test(`settings and user picker dismiss with ${mode}`, async ({ page }) => {
    await prepare(page, 'tech-green');
    await page.goto('/');
    await login(page);
    await openSettings(page);
    await dismiss(page, page.getByTestId('settings-sheet-root'), mode, '[data-testid="sheet-close"]');
    await expect(page.getByTestId('settings-button')).toBeFocused();
    await page.locator('.new-chat-button').click();
    await dismiss(page, page.getByTestId('user-list-root'), mode, '[data-testid="sheet-close"]');
  });
}

test('settings traps keyboard focus, preserves language-radio focus and saves language', async ({ page }) => {
  await prepare(page, 'light');
  await page.goto('/');
  await login(page);
  await openSettings(page);
  const sheet = page.getByTestId('settings-sheet');
  const close = sheet.getByTestId('sheet-close');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sheet.getByTestId('logout-button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  const language = page.getByTestId('language-option-en');
  await language.focus();
  for (const code of ['de', 'ru', 'en']) {
    await page.keyboard.press('ArrowRight');
    const selected = page.getByTestId(`language-option-${code}`);
    await expect(selected).toBeChecked();
    await expect(selected).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toMatch(new RegExp(`^${code}`));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-button')).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await openSettings(page);
    await expect(page.getByTestId(`language-option-${code}`)).toBeChecked();
    await page.getByTestId(`language-option-${code}`).focus();
  }
});

test('unauthenticated settings wraps after the selected language radio', async ({ page }) => {
  await prepare(page, 'light');
  await page.goto('/');
  await expect(page.locator('.auth-card')).toBeVisible();
  await openSettings(page);
  const close = page.getByTestId('settings-sheet').getByTestId('sheet-close');
  await page.getByTestId('language-option-en').focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('language-option-en')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-button')).toBeFocused();
});

test('theme selection survives denied writes during the session and ignores OS changes', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'zchat-theme') throw new DOMException('Denied', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await login(page);
  await openSettings(page);
  await selectTheme(page, 'tech-red');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'tech-red');
  await page.reload();
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const theme of themes) {
  test(`${theme}: keyboard focus has a visible computed ring`, async ({ page }) => {
    await prepare(page, theme);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.locator('#username').focus();
    const focus = await page.locator('#username').evaluate(element => {
      const css = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'), outline: css.outlineStyle, outlineWidth: parseFloat(css.outlineWidth), shadow: css.boxShadow };
    });
    expect(focus.visible).toBeTruthy();
    expect((focus.outline !== 'none' && focus.outlineWidth > 0) || focus.shadow !== 'none', `computed focus appearance: ${JSON.stringify(focus)}`).toBeTruthy();
  });
}
