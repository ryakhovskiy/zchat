import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  themes, credentials, prepare, login, openConversation, apiSession,
  openActions, actions, assertNoOverflow, assertFits, dismiss, capture,
} from './helpers.js';

for (const theme of themes) {
  test(`${theme}: send, edit, reply, react, delete and image view`, async ({ page, request }, testInfo) => {
    const headers = await apiSession(request);
    const usersResponse = await request.get('/api/users/', { headers });
    expect(usersResponse.ok()).toBeTruthy();
    const users = await usersResponse.json();
    const peer = users.find(user => user.username === credentials().peer);
    expect(peer, 'seeded peer exists').toBeTruthy();
    const secondPeer = users.find(user => ![credentials().username, credentials().peer].includes(user.username));
    expect(secondPeer, 'seed includes a second peer for group regression isolation').toBeTruthy();
    const title = `QA ${randomUUID().slice(0, 8)}`;
    const created = await request.post('/api/conversations/', { headers, data: { participant_ids: [peer.id, secondPeer.id], is_group: true, name: title } });
    expect(created.ok(), 'create independent regression conversation').toBeTruthy();
    const conversation = await created.json();
    const conversationId = conversation.id ?? conversation.ID;

    await prepare(page, theme);
    await page.goto('/');
    await login(page);
    await openConversation(page, title);
    const input = page.locator('.message-input');
    const content = `Regression ${randomUUID()}`;
    await input.fill(content);
    await page.locator('.send-button').click();
    const sent = page.locator('.message-sent').filter({ has: page.locator('.message-text', { hasText: content }) });
    await expect(sent).toHaveCount(1);
    await openActions(page, sent);
    await actions(page).getByTestId('action-edit').click();
    const edited = `${content} edited`;
    await input.fill(edited);
    await page.locator('.send-button').click();
    await expect(sent.locator('.message-text')).toHaveText(edited);
    await expect(sent.locator('.message-edited-label')).toBeVisible();
    await openActions(page, sent);
    await actions(page).getByTestId('action-reply').click();
    await expect(page.locator('.reply-mode-banner')).toContainText(edited);
    const reply = `Reply ${randomUUID()}`;
    await input.fill(reply);
    await page.locator('.send-button').click();
    const replyBubble = page.locator('.message-sent').filter({ has: page.locator('.message-text', { hasText: reply }) });
    await expect(replyBubble.locator('.message-replied-to')).toContainText(edited);
    await openActions(page, sent);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (coarse) await actions(page).getByRole('button', { name: /more reactions/i }).click();
    else await actions(page).getByTestId('action-react').click();
    const picker = page.getByTestId('reaction-sheet');
    await expect(picker).toBeVisible();
    await assertFits(picker.locator('em-emoji-picker'), 'reaction picker');
    // Emoji Mart uses shadow DOM, which Playwright CSS and role locators pierce.
    await picker.getByRole('button', { name: /thumbs up/i }).first().click();
    await expect(sent.locator('.reaction-chip')).toContainText('👍');

    const longText = `https://example.com/${'long-url'.repeat(35)} ${'Unbroken'.repeat(40)}`;
    await input.fill(longText);
    await page.locator('.send-button').click();
    await expect(page.locator('.message-text').filter({ hasText: longText })).toBeVisible();
    await assertNoOverflow(page, 'long words and URL');
    const messageOverflow = await page.locator('.messages-container').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    expect(messageOverflow.scroll).toBeLessThanOrEqual(messageOverflow.client + 1);

    // Upload a real image fixture through the UI, then verify the served attachment.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'qa-image.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64'),
    });
    await page.locator('.send-button').click();
    const image = page.locator('.attachment-image').last();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(e => e.complete && e.naturalWidth > 0)).toBeTruthy();
    await image.click();
    await expect(page.locator('.image-modal-image')).toBeVisible();
    await capture(page, testInfo, 'image-modal');
    await page.keyboard.press('Escape');
    await expect(page.locator('.image-modal-backdrop')).toBeHidden();

    // Reload to check durable server state, not only optimistic DOM updates.
    await page.reload();
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await openConversation(page, title);
    await expect(sent.locator('.message-text')).toHaveText(edited);
    await expect(sent.locator('.reaction-chip')).toContainText('👍');
    await expect(replyBubble.locator('.message-replied-to')).toContainText(edited);
    await openActions(page, sent);
    await actions(page).getByTestId('action-delete-all').click();
    await expect(page.locator('.message-deleted-text')).toBeVisible();
    await expect(page.locator('.message-text').filter({ hasText: new RegExp(`^${edited}$`) })).toHaveCount(0);
    const persisted = await request.get(`/api/conversations/${conversationId}/messages?limit=100`, { headers });
    expect(persisted.ok()).toBeTruthy();
    const serverMessages = await persisted.json();
    expect(serverMessages.some(m => m.is_deleted)).toBeTruthy();
    expect(serverMessages.some(m => m.content === reply && m.reply_to_id)).toBeTruthy();
  });
}

for (const mode of ['close', 'scrim', 'escape']) {
  test(`image modal and emoji picker dismiss with ${mode}`, async ({ page }) => {
    await prepare(page, 'dark');
    await page.goto('/');
    await login(page);
    await openConversation(page);
    await page.locator('.attachment-image').first().click();
    await dismiss(page, page.locator('.image-modal-backdrop'), mode, 'button[title="Close"], button[aria-label="Close"]');
    await page.locator('.emoji-button').click();
    if (page.viewportSize().width < 768) {
      await expect(page.getByTestId('emoji-sheet')).toBeVisible();
      await dismiss(page, page.getByTestId('emoji-sheet-root'), mode, '[data-testid="sheet-close"]');
    } else {
      const popover = page.locator('.emoji-popover');
      await expect(popover).toBeVisible();
      if (mode === 'close') await popover.getByRole('button', { name: /close/i }).click();
      else if (mode === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.chat-header').click({ position: { x: 2, y: 2 } });
      await expect(popover).toBeHidden();
    }
    const message = page.locator('.message').filter({ has: page.locator('.message-text') }).last();
    await openActions(page, message);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      await dismiss(page, page.getByTestId('message-action-sheet-root'), mode, '[data-testid="sheet-close"]');
      await openActions(page, message);
      await actions(page).getByRole('button', { name: /more reactions/i }).click();
    } else await actions(page).getByTestId('action-react').click();
    await dismiss(page, page.getByTestId('reaction-sheet-root'), mode, '[data-testid="sheet-close"]');
  });
}

for (const theme of themes) {
  test(`${theme}: call surface`, async ({ page }, testInfo) => {
    await prepare(page, theme);
    await page.goto('/');
    await login(page);
    await openConversation(page);
    await page.context().grantPermissions(['microphone']);
    await page.locator('.call-button').click();
    await expect(page.locator('.call-overlay')).toBeVisible();
    await capture(page, testInfo, 'call', page.locator('.call-card'));
    await page.getByRole('button', { name: /end call|cancel call|close/i }).click();
    await expect(page.locator('.call-overlay')).toBeHidden();
  });
}
