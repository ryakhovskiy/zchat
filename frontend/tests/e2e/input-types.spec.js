import { test, expect } from '@playwright/test';
import { prepare, login, openConversation, openActions, actions } from './helpers.js';

test('message actions follow pointer type independently of viewport width', async ({ page }, testInfo) => {
  await prepare(page, 'tech-green');
  await page.goto('/');
  await login(page);
  await openConversation(page);
  const message = page.locator('.message').filter({ has: page.locator('.message-text') }).last();
  await message.scrollIntoViewIfNeeded();
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse).toBe(testInfo.project.name === 'wide-touch');
  if (coarse) {
    // A quick tap must not open the action sheet; the held touch below must.
    await message.tap();
    await expect(actions(page)).toBeHidden();
  }
  await openActions(page, message);
  await expect(actions(page).getByTestId('action-reply')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions(page)).toBeHidden();
});
