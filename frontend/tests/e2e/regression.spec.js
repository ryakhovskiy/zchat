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
    const secondPeer = users.find(user => user.username === `${credentials().username}_qa`);
    expect(secondPeer, 'fixture-only scratch participant exists').toBeTruthy();
    const requestedTitle = 'QA regression scratch';
    const created = await request.post('/api/conversations/', { headers, data: { participant_ids: [peer.id, secondPeer.id], is_group: true, name: requestedTitle } });
    expect(created.ok(), 'create independent regression conversation').toBeTruthy();
    const conversation = await created.json();
    const conversationId = conversation.id ?? conversation.ID;
    const title = conversation.name ?? conversation.Name ?? requestedTitle;

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
    const sentId = Number(await sent.getAttribute('data-message-id'));
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
    await expect(page.getByTestId('reaction-sheet-root')).not.toHaveClass(/sheet-root--arming/);
    await assertFits(picker.locator('em-emoji-picker'), 'reaction picker');
    const pickerClose = picker.getByTestId('sheet-close');
    await pickerClose.focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => picker.locator('em-emoji-picker').evaluate(host => !!host.shadowRoot?.activeElement), { message: 'Tab reaches emoji picker shadow controls' }).toBeTruthy();
    await page.keyboard.press('Shift+Tab');
    await expect(pickerClose).toBeFocused();
    // Emoji Mart uses shadow DOM, which Playwright CSS and role locators pierce.
    await picker.locator('input[type="search"]').fill('thumbs up');
    await picker.getByRole('button', { name: '👍', exact: true }).click();
    await expect(sent.locator('.reaction-chip')).toContainText('👍');

    const longText = `https://example.com/${randomUUID()}/${'long-url'.repeat(35)} ${'Unbroken'.repeat(40)}`;
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
    const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/uploads/' && response.request().method() === 'POST');
    await page.locator('.send-button').click();
    const upload = await uploaded;
    expect(upload.ok(), 'authenticated image upload succeeds').toBeTruthy();
    const uploadHeaders = await upload.request().allHeaders();
    expect(/^Bearer \S+$/.test(uploadHeaders.authorization || ''), 'the UI upload carries a Bearer token').toBe(true);
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
    await expect(page.locator(`[data-message-id="${sentId}"] .message-deleted-text`)).toBeVisible();
    await expect(page.locator('.message-text').filter({ hasText: new RegExp(`^${edited}$`) })).toHaveCount(0);
    const persisted = await request.get(`/api/conversations/${conversationId}/messages?limit=100`, { headers });
    expect(persisted.ok()).toBeTruthy();
    const serverMessages = await persisted.json();
    expect(serverMessages.find(m => m.id === sentId)?.is_deleted).toBe(true);
    expect(serverMessages.find(m => m.content === reply)?.reply_to_id).toBe(sentId);
    // Regression: a deleted original used to expose encrypted storage content in
    // reply quotes after a fresh history fetch (backend fix a878ecf).
    await page.reload();
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await openConversation(page, title);
    await expect(replyBubble.locator('.replied-text')).toHaveText('Message deleted');
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

test('call overlay dismisses with Escape', async ({ page }) => {
  await prepare(page, 'dark');
  await page.goto('/');
  await login(page);
  await openConversation(page);
  await page.context().grantPermissions(['microphone']);
  await page.locator('.call-button').click();
  await expect(page.locator('.call-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.call-overlay')).toBeHidden();
});

test('incoming call takes keyboard focus and dismisses with Escape', async ({ page }) => {
  let socket;
  // Exercise the real call event handler without signaling or writes to the server.
  await page.routeWebSocket('**/ws', route => { socket = route; });
  await prepare(page, 'dark');
  await page.goto('/');
  await login(page);
  await openConversation(page);
  await page.locator('.message-input').focus();
  await expect.poll(() => !!socket).toBeTruthy();
  socket.send(JSON.stringify({ type: 'call_offer', sender_id: 2, sender_username: credentials().peer, conversation_id: 1, sdp: { type: 'offer', sdp: 'qa-incoming-offer' } }));
  const dialog = page.getByTestId('call-overlay');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement)), { message: 'incoming call takes focus into its dialog' }).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    // Closing a phone call intentionally leaves the software keyboard closed.
    await expect(page.locator('.message-input')).not.toBeFocused();
  } else await expect(page.locator('.message-input')).toBeFocused();
});
