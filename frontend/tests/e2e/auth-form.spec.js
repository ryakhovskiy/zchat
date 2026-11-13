import { test, expect } from '@playwright/test';
import { credentials, prepare } from './helpers.js';

test('credential form signs in and restores the session on reload', async ({ page }) => {
  const { username, password } = credentials();
  await prepare(page);
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByTestId('current-username')).toHaveText(username);
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  const storage = await page.evaluate(() => ({ local: !!localStorage.getItem('token'), session: !!sessionStorage.getItem('token') }));
  expect(storage).toEqual({ local: false, session: true });
  await page.reload();
  await expect(page.getByTestId('current-username')).toHaveText(username);
  await expect(page.getByTestId('conversation-list')).toBeVisible();
});
