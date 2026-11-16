import { test, expect } from '@playwright/test';
import { apiMessage, formLogin, messageByID, openConversation, send, unique } from './helpers.js';

test('50 kbps / 500 ms: cold login, open, send and receive live', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const profile = { offline: false, latency: 500, downloadThroughput: 50_000 / 8,
    uploadThroughput: 50_000 / 8, connectionType: 'cellular2g' };
  const cdp = await page.context().newCDPSession(page);
  const started = Date.now();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', profile);
  try {
    await formLogin(page);
    const id = await openConversation(page);
    const sent = await send(page, unique('slow-outbound'));
    const inbound = await apiMessage(request, id, unique('slow-inbound'), true);
    await expect(messageByID(page, inbound.id).getByTestId('message-content')).toHaveText(inbound.content, { timeout: 45_000 });
    await expect(messageByID(page, sent.id)).toHaveCount(1);
    await testInfo.attach('slow-network', { contentType: 'application/json',
      body: JSON.stringify({ ...profile, elapsed_ms: Date.now() - started, sent: sent.id, received: inbound.id }) });
  } finally {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.detach();
  }
});
