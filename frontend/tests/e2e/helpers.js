import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const themes = ['light', 'dark', 'tech-green', 'tech-red'];
export const themeNames = { light: 'Light', dark: 'Dark', 'tech-green': 'Tech Green', 'tech-red': 'Tech Red' };

export function credentials() {
  const { E2E_USERNAME: username, E2E_PASSWORD: password, E2E_PEER: peer } = process.env;
  if (!username || !password || !peer) throw new Error('Set E2E_USERNAME, E2E_PASSWORD and E2E_PEER from the isolated stack seed.');
  return { username, password, peer };
}

export async function prepare(page, theme) {
  await page.addInitScript((initialTheme) => {
    localStorage.setItem('i18nextLng', 'en');
    if (initialTheme && !sessionStorage.getItem('qa-theme-seeded')) {
      localStorage.setItem('zchat-theme', initialTheme);
      sessionStorage.setItem('qa-theme-seeded', 'true');
    }
  }, theme);
}

export async function login(page) {
  const { username, password } = credentials();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.locator('.conversation-list')).toBeVisible();
  await expect(page.locator('.conversation-item').first()).toBeVisible();
}

export async function openConversation(page, title = credentials().peer) {
  await page.locator('.conversation-item').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click();
  await expect(page.locator('.message-input')).toBeVisible();
}

export async function openSettings(page) {
  await page.locator('.settings-btn:visible').click();
  await expect(page.getByRole('radiogroup', { name: /theme/i })).toBeVisible();
}

export async function selectTheme(page, theme) {
  const choice = page.getByRole('radio', { name: new RegExp(`^${themeNames[theme]}`, 'i') });
  await choice.click();
  await expect(choice).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect.soft(dimensions.html, `${label}: document width ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect.soft(dimensions.body, `${label}: body width`).toBeLessThanOrEqual(dimensions.viewport + 1);
}

export async function assertFits(locator, label) {
  await expect(locator, label).toBeVisible();
  const bounds = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  expect.soft(bounds.x, `${label}: left`).toBeGreaterThanOrEqual(-1);
  expect.soft(bounds.y, `${label}: top`).toBeGreaterThanOrEqual(-1);
  expect.soft(bounds.x + bounds.width, `${label}: right`).toBeLessThanOrEqual(viewport.width + 1);
  expect.soft(bounds.y + bounds.height, `${label}: bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

export async function assertTouchTargets(page, selector, label) {
  if (page.viewportSize().width >= 768) return;
  const targets = page.locator(selector);
  expect.soft(await targets.count(), `${label}: touch controls present`).toBeGreaterThan(0);
  for (const target of await targets.all()) {
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    const name = await target.getAttribute('aria-label') || await target.getAttribute('title') || await target.textContent();
    expect.soft(box.width, `${label}: ${name} width`).toBeGreaterThanOrEqual(44);
    expect.soft(box.height, `${label}: ${name} height`).toBeGreaterThanOrEqual(44);
  }
}

export async function capture(page, testInfo, name, scope) {
  await assertNoOverflow(page, name);
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  await testInfo.attach(`${name}-contrast`, { body: JSON.stringify({ violations: results.violations, incomplete: results.incomplete, passes: results.passes }, null, 2), contentType: 'application/json' });
  expect.soft(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), `${name}: WCAG AA text contrast`).toEqual([]);
  if (scope) await assertFits(scope, name);
  await testInfo.attach(name, { path: await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' }), contentType: 'image/png' });
}

export async function dismiss(page, overlay, mode, closeSelector) {
  if (mode === 'escape') await page.keyboard.press('Escape');
  else if (mode === 'close') await overlay.locator(closeSelector).click();
  else {
    // Hit the scrim itself, outside the dialog, including phone landscape.
    const point = await overlay.evaluate(element => {
      const b = element.getBoundingClientRect();
      for (const [x, y] of [[b.x + 2, b.y + 2], [b.right - 2, b.y + 2], [b.x + 2, b.bottom - 2]]) {
        if (document.elementFromPoint(x, y) === element) return { x, y };
      }
      return null;
    });
    expect(point, 'the overlay exposes a tappable scrim').not.toBeNull();
    await page.mouse.click(point.x, point.y);
  }
  await expect(overlay).toBeHidden();
}

export async function openActions(page, message) {
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    const box = await message.boundingBox();
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      // Keep the real touch held until the application opens its long-press sheet.
      await expect(page.locator('.message-context-menu')).toBeVisible();
    } finally {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    }
  } else await message.click({ button: 'right' });
  await expect(page.locator('.message-context-menu')).toBeVisible();
}

export async function apiSession(request) {
  const { username, password } = credentials();
  const response = await request.post('/api/auth/login', { data: { username, password } });
  expect(response.ok(), 'isolated seed login').toBeTruthy();
  const { access_token: token } = await response.json();
  return { Authorization: `Bearer ${token}` };
}
