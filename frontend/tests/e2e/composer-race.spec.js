import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { authFile } from './setup.js';
import { prepare, login, openConversation } from './helpers.js';

for (const switchChat of [false, true]) {
  test(`pending REST send preserves a newer draft in ${switchChat ? 'another' : 'the same'} conversation`, async ({ page }) => {
    const session = JSON.parse(readFileSync(authFile, 'utf8'));
    const conversations = [1, 2].map(index => ({
      id: 710000 + index, name: `Race ${index}`, is_group: true,
      participants: [session.user], unread_count: 0,
      created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
    }));
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    // Force REST fallback; every write and conversation-history response is mocked.
    await page.routeWebSocket('**/ws', socket => socket.close());
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/conversations/') return route.fulfill({ json: conversations });
      if (request.method() === 'GET' && /\/messages$/.test(path)) return route.fulfill({ json: [] });
      if (request.method() === 'POST' && /\/messages$/.test(path)) {
        const payload = request.postDataJSON();
        await pending;
        return route.fulfill({ json: { id: 990001, conversation_id: 710001, sender_id: session.user.id, content: payload.content, created_at: '2026-11-01T12:01:00Z' } });
      }
      if (request.method() !== 'GET') return route.fulfill({ json: {} });
      return route.continue();
    });
    try {
      await prepare(page, 'dark');
      await page.goto('/');
      await login(page);
      await openConversation(page, 'Race 1');
      await page.locator('.message-input').fill('Pending message from A');
      const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages'));
      await page.locator('.send-button').click();
      await sent;
      if (switchChat) {
        if (page.viewportSize().width < 768) await page.getByTestId('back-button').click();
        await openConversation(page, 'Race 2');
      }
      const draft = switchChat ? 'New draft in B' : 'Newer draft in A';
      await page.locator('.message-input').fill(draft);
      release();
      if (switchChat) {
        // The list stays in the DOM on phones. Its update proves the REST result
        // reached React before inspecting the active composer.
        await expect(page.locator('.conversation-item').filter({ hasText: 'Race 1' })).toContainText('Pending message from A');
      } else await expect(page.locator('.message-text')).toHaveText('Pending message from A');
      await expect(page.locator('.message-input')).toHaveValue(draft);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
