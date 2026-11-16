import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { apiSession, apiMessage, axe, credentials, fixtureSession, formLogin, login,
  messageByID, messages, observeSSE, openConversation, pairedPages, received, send,
  sseFault, unique, waitLive } from './helpers.js';

test('login form sends remember_me, persists in the selected storage and logs out', async ({ browser }) => {
  for (const remember of [false, true]) {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
    try {
      const page = await context.newPage();
      await formLogin(page, remember);
      const stored = await page.evaluate(() => ({ session: sessionStorage.getItem('token'), local: localStorage.getItem('token') }));
      expect(remember ? stored.local : stored.session).toBeTruthy();
      expect(remember ? stored.session : stored.local).toBeNull();
      await page.reload();
      await expect(page.getByTestId('conversation-list')).toBeVisible();
      await waitLive(page);
      await page.getByTestId('logout').click();
      await expect(page.getByTestId('login-form')).toBeVisible();
      expect(await page.evaluate(() => [sessionStorage.getItem('token'), localStorage.getItem('token'),
        sessionStorage.getItem('user'), localStorage.getItem('user')])).toEqual([null, null, null, null]);
    } finally { await context.close(); }
  }
});

test('register through the form and start a direct chat with a plain select', async ({ page }) => {
  const username = `lite_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/');
  await page.getByTestId('show-register').click();
  await expect(page).toHaveURL(/#\/register$/);
  await page.getByTestId('register-username').fill(username);
  await page.getByTestId('register-email').fill(`${username}@example.test`);
  await page.getByTestId('register-password').fill(credentials().password);
  const registered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/register');
  await page.getByTestId('register-submit').click();
  expect((await registered).ok()).toBeTruthy();
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await waitLive(page);
  expect(await page.evaluate(() => !!sessionStorage.getItem('token') && !localStorage.getItem('token'))).toBe(true);
  await expect(page.getByTestId('new-chat-user')).toHaveJSProperty('tagName', 'SELECT');
  await page.getByTestId('new-chat-user').focus();
  await page.getByTestId('new-chat-user').selectOption({ label: credentials().peer });
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/conversations/' && r.request().method() === 'POST');
  await page.getByTestId('start-chat').click();
  const response = await created;
  expect(response.ok()).toBeTruthy();
  const conversation = await response.json();
  expect(conversation.is_group).toBe(false);
  await expect(page).toHaveURL(new RegExp(`#/c/${conversation.id}$`));
  await expect(page.getByTestId('chat-title')).toHaveText(credentials().peer);
  await send(page, unique('new-direct'));
  await page.getByTestId('back-to-list').click();
  await expect(page.getByTestId(`conversation-${conversation.id}`)).toBeVisible();
});

test('two contexts exchange live SSE messages, deduplicate echoes, and propagate edit and both deletes', async ({ browser, request }) => {
  const pair = await pairedPages(browser, request);
  const { alice, bob, aliceEvents, bobEvents } = pair;
  try {
    const aliceText = `${unique('alice-live')} <b id="qa-server-html">literal & text</b>\nHello 👋 Привет`;
    const fromAlice = await send(alice, aliceText);
    for (const events of [aliceEvents, bobEvents]) await received(events, 'message', fromAlice.id);
    for (const page of [alice, bob]) {
      await expect(messageByID(page, fromAlice.id)).toHaveCount(1);
      await expect(messageByID(page, fromAlice.id).getByTestId('message-content')).toHaveText(aliceText);
      await expect(page.locator('#qa-server-html')).toHaveCount(0);
    }
    const bobText = unique('bob-live');
    const fromBob = await send(bob, bobText);
    for (const events of [aliceEvents, bobEvents]) await received(events, 'message', fromBob.id);
    await expect(messageByID(alice, fromBob.id).getByTestId('message-content')).toHaveText(bobText);
    await expect(messageByID(bob, fromBob.id)).toHaveCount(1);

    const edited = unique('edited');
    alice.once('dialog', dialog => dialog.accept(edited));
    await messageByID(alice, fromAlice.id).getByTestId('edit-message').click();
    for (const events of [aliceEvents, bobEvents]) await received(events, 'message_edited', fromAlice.id);
    for (const page of [alice, bob]) {
      await expect(messageByID(page, fromAlice.id).getByTestId('message-content')).toHaveText(edited);
      await expect(messageByID(page, fromAlice.id).getByTestId('message-edited')).toBeVisible();
    }

    // A second tab belonging to the actor must also receive delete-for-me.
    const aliceTab = await alice.context().newPage();
    const tabEvents = await observeSSE(aliceTab);
    await login(aliceTab);
    await openConversation(aliceTab);
    await messageByID(alice, fromAlice.id).getByTestId('delete-message').click();
    for (const events of [aliceEvents, tabEvents]) await received(events, 'message_deleted', fromAlice.id);
    await expect(messageByID(alice, fromAlice.id)).toHaveCount(0);
    await expect(messageByID(aliceTab, fromAlice.id)).toHaveCount(0);

    await messageByID(bob, fromBob.id).getByTestId('delete-everyone').click();
    for (const events of [aliceEvents, bobEvents, tabEvents]) await received(events, 'message_deleted', fromBob.id);
    for (const page of [alice, bob, aliceTab]) {
      await expect(messageByID(page, fromBob.id)).toHaveAttribute('data-deleted', '1');
      await expect(messageByID(page, fromBob.id).getByTestId('message-content')).toHaveText('[deleted]');
    }
    // A later event fences Bob's stream: the private deletion must never arrive there.
    const fence = await send(alice, unique('after-delete'));
    await received(bobEvents, 'message', fence.id);
    expect(bobEvents.some(e => e.type === 'message_deleted' && e.message_id === fromAlice.id)).toBe(false);
    await expect(messageByID(bob, fromAlice.id).getByTestId('message-content')).toHaveText(edited);
  } finally { await pair.close(); }
});

test('load older uses limit=20 and before_id, preserving oldest-first unique message IDs', async ({ page }) => {
  await login(page);
  const latestResponse = page.waitForResponse(r => /\/api\/conversations\/\d+\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET');
  await openConversation(page);
  const latest = await latestResponse;
  const latestURL = new URL(latest.url());
  expect(latestURL.searchParams.get('limit')).toBe('20');
  const firstPage = await latest.json();
  expect(firstPage).toHaveLength(20);
  await expect(messages(page)).toHaveCount(20);
  const olderResponse = page.waitForResponse(r => new URL(r.url()).searchParams.has('before_id'));
  await page.getByTestId('load-older').click();
  const older = await olderResponse;
  const olderURL = new URL(older.url());
  expect(olderURL.searchParams.get('limit')).toBe('20');
  expect(olderURL.searchParams.get('before_id')).toBe(String(firstPage[0].id));
  const secondPage = await older.json();
  expect(secondPage).toHaveLength(20);
  const ids = [...secondPage, ...firstPage].map(m => `message-${m.id}`);
  await expect(messages(page)).toHaveCount(ids.length);
  expect(await messages(page).evaluateAll(nodes => nodes.map(n => n.dataset.testid))).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
  // REST reload normalizes id/created_at the same way as live message_id/timestamp.
  const text = unique('normalization');
  const saved = await send(page, text);
  await page.reload();
  await expect(messageByID(page, saved.id).getByTestId('message-content')).toHaveText(text);
  await expect(messageByID(page, saved.id).getByTestId('message-meta')).toContainText(credentials().username);
});

test('list updates unread count and ordering, then marks an opened chat read', async ({ page, request }) => {
  await login(page);
  const id = await openConversation(page);
  await page.getByTestId('back-to-list').click();
  const saved = await apiMessage(request, id, unique('unread'), true);
  const row = page.getByTestId(`conversation-${id}`);
  await expect.poll(async () => Number(await row.getAttribute('data-unread'))).toBeGreaterThan(0);
  await expect(page.getByTestId('conversation-list').locator(':scope > li').first()).toHaveAttribute('data-testid', `conversation-${id}`);
  const read = page.waitForResponse(r => new URL(r.url()).pathname === `/api/conversations/${id}/read` && r.request().method() === 'POST');
  await openConversation(page);
  expect((await read).ok()).toBeTruthy();
  await expect(messageByID(page, saved.id)).toBeVisible();
  await expect.poll(async () => {
    const response = await request.get('/api/conversations/', { headers: await apiSession() });
    return (await response.json()).find(c => c.id === id).unread_count;
  }).toBe(0);
});

test('an interrupted SSE stream mints a fresh ticket and resyncs missed messages, edits and deletes', async ({ page, request }) => {
  const urls = [];
  const fault = await sseFault(page);
  try {
    page.on('request', req => urls.push(new URL(req.url())));
    await login(page);
    const id = await openConversation(page);
    const editable = await apiMessage(request, id, unique('edit-before-drop'));
    const deletable = await apiMessage(request, id, unique('delete-before-drop'));
    await expect(messageByID(page, deletable.id)).toBeVisible();
    const before = urls.length;
    fault.drop();
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-live', '0');
    const editedText = unique('edited-while-offline');
    const headers = await apiSession();
    expect((await request.put(`/api/messages/${editable.id}`, { headers, data: { content: editedText } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/messages/${deletable.id}?delete_type=for_everyone`, { headers })).ok()).toBeTruthy();
    const missed = await apiMessage(request, id, unique('missed-while-offline'), true);
    await expect(messageByID(page, missed.id)).toHaveCount(0);
    fault.resume();
    await waitLive(page);
    await expect(messageByID(page, missed.id).getByTestId('message-content')).toHaveText(missed.content);
    await expect(messageByID(page, missed.id)).toHaveCount(1);
    await expect(messageByID(page, editable.id).getByTestId('message-content')).toHaveText(editedText);
    await expect(messageByID(page, deletable.id)).toHaveAttribute('data-deleted', '1');
    const recovered = urls.slice(before);
    expect(recovered.some(u => u.pathname === '/api/events/ticket')).toBe(true);
    expect(recovered.some(u => u.pathname === '/api/conversations/')).toBe(true);
    expect(recovered.some(u => u.pathname === `/api/conversations/${id}/messages` && u.searchParams.get('limit') === '20')).toBe(true);
    const tickets = urls.filter(u => u.pathname === '/api/events').map(u => u.searchParams.get('ticket'));
    expect(tickets.length).toBeGreaterThanOrEqual(2);
    expect(tickets.every(Boolean)).toBe(true);
    expect(new Set(tickets).size).toBe(tickets.length);
    const live = await apiMessage(request, id, unique('after-resync'), true);
    await expect(messageByID(page, live.id).getByTestId('message-content')).toHaveText(live.content);
  } finally { await fault.close(); }
});

// Delay an actual REST snapshot, rather than inventing a mock message shape.
async function holdLatest(page, id) {
  let arrived, release, intercepted;
  const ready = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delivered = page.waitForEvent('requestfinished', {
    predicate: req => req === intercepted,
  });
  const pattern = `**/api/conversations/${id}/messages?*`;
  await page.route(pattern, async route => {
    intercepted = route.request();
    const snapshot = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response: snapshot });
  }, { times: 1 });
  return { ready, release, settle: async () => {
    release();
    await delivered;
    // Let the fetch body handler and its DOM update reach a painted frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } };
}

test('a delayed latest page cannot overwrite newer SSE create, edit or delete', async ({ page, request }) => {
  const events = await observeSSE(page);
  await login(page);
  const id = await openConversation(page);
  const editable = await apiMessage(request, id, unique('snapshot-edit'));
  const deletable = await apiMessage(request, id, unique('snapshot-delete'));
  await expect(messageByID(page, deletable.id)).toBeVisible();
  await page.getByTestId('back-to-list').click();
  const held = await holdLatest(page, id);
  try {
    await openConversation(page);
    await held.ready;
    const headers = await apiSession();
    const edited = unique('edit-after-snapshot');
    expect((await request.put(`/api/messages/${editable.id}`, { headers, data: { content: edited } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/messages/${deletable.id}?delete_type=for_everyone`, { headers })).ok()).toBeTruthy();
    const created = await apiMessage(request, id, unique('create-after-snapshot'), true);
    await received(events, 'message_edited', editable.id);
    await received(events, 'message_deleted', deletable.id);
    await received(events, 'message', created.id);
    await held.settle();
    await expect(messageByID(page, editable.id).getByTestId('message-content')).toHaveText(edited);
    await expect(messageByID(page, deletable.id)).toHaveAttribute('data-deleted', '1');
    await expect(messageByID(page, created.id).getByTestId('message-content')).toHaveText(created.content);
    await expect(messageByID(page, created.id)).toHaveCount(1);
  } finally { held.release(); }
});

test('a delayed previous chat response cannot replace the current chat or reopen it after logout', async ({ page, request }) => {
  await login(page);
  const firstID = await openConversation(page);
  const marker = await apiMessage(request, firstID, unique('previous-chat'));
  await expect(messageByID(page, marker.id)).toBeVisible();
  await page.getByTestId('back-to-list').click();
  const other = page.getByTestId('conversation-list').locator(`a:not([href="#/c/${firstID}"])`).first();
  const otherHref = await other.getAttribute('href');
  const held = await holdLatest(page, firstID);
  try {
    await openConversation(page);
    await held.ready;
    await page.getByTestId('back-to-list').click();
    await other.click();
    await expect(page).toHaveURL(new RegExp(`${otherHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.getByTestId('message-input')).toBeVisible();
    await held.settle();
    await expect(messageByID(page, marker.id)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${otherHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  } finally { held.release(); }

  await page.getByTestId('back-to-list').click();
  const logoutHold = await holdLatest(page, firstID);
  try {
    await openConversation(page);
    await logoutHold.ready;
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('login-form')).toBeVisible();
    await logoutHold.settle();
    await expect(page.getByTestId('message-list')).toBeHidden();
    await expect(page.getByTestId('login-form')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('token') || localStorage.getItem('token'))).toBeNull();
  } finally { logoutHold.release(); }
});

test('login, list and chat have no axe WCAG A/AA violations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await axe(page, testInfo, 'login');
  await login(page);
  await axe(page, testInfo, 'list');
  await openConversation(page);
  await axe(page, testInfo, 'chat');
});

test('cold page loads only index.html and app.js within the 8 KB gzip budget', async ({ page, request }, testInfo) => {
  const assets = [];
  page.on('request', req => assets.push({ url: req.url(), type: req.resourceType() }));
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
  const sizes = {};
  for (const path of ['/', '/app.js']) {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toMatch(path === '/' ? /text\/html/ : /(?:application|text)\/javascript/);
    sizes[path] = gzipSync(await response.body(), { level: 9 }).length;
  }
  await testInfo.attach('payload-budget', { contentType: 'application/json', body: JSON.stringify(sizes) });
  expect(sizes['/'] + sizes['/app.js'], 'individually gzipped HTML + JS <=8192 bytes').toBeLessThanOrEqual(8192);
  expect(assets.map(a => new URL(a.url).pathname).sort()).toEqual(['/', '/app.js']);
  await expect(page.locator('link[rel="stylesheet"], script[src]:not([src="app.js"]):not([src="/app.js"])')).toHaveCount(0);
});

test('Android-style bearer WebSocket and browser SSE exchange messages in both directions', async ({ page, request }) => {
  const bob = await fixtureSession(request, true);
  const events = await observeSSE(page);
  await login(page);
  const id = await openConversation(page);
  const wsContext = await page.context().browser().newContext({ baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${bob.access_token}` } });
  try {
    const android = await wsContext.newPage();
    await android.goto('/');
    await android.evaluate(async () => {
      window.qaWSMessages = [];
      window.qaWS = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
      window.qaWS.onmessage = event => window.qaWSMessages.push(JSON.parse(event.data));
      await new Promise((resolve, reject) => {
        window.qaWS.onopen = resolve;
        window.qaWS.onerror = () => reject(new Error('Android-style Bearer WS failed'));
      });
    });
    const fromWS = unique('ws-to-sse');
    await android.evaluate(({ id, content }) => window.qaWS.send(JSON.stringify({ type: 'message', conversation_id: id, content })), { id, content: fromWS });
    await expect.poll(() => events.find(e => e.type === 'message' && e.content === fromWS)?.message_id).toBeTruthy();
    const wsMessage = events.find(e => e.content === fromWS);
    await expect(messageByID(page, wsMessage.message_id).getByTestId('message-content')).toHaveText(fromWS);
    const fromSSE = await send(page, unique('sse-to-ws'));
    await expect.poll(() => android.evaluate(id => window.qaWSMessages.some(e => e.type === 'message' && e.message_id === id), fromSSE.id)).toBe(true);
  } finally { await wsContext.close(); }
});
