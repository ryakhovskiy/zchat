import { test, expect } from '@playwright/test';
import { credentials, fixtureSession, login, messageByID, observeSSE,
  openConversation, received, send, unique } from './helpers.js';

// React selectors follow frontend/tests/e2e/helpers.js and MessageBubble,
// MessageActions, Composer and ConversationList. Keep frontend/ unchanged.
const reactMessage = (page, id) => page.getByTestId('message').and(page.locator(`[data-message-id="${id}"]`));
const reactText = (page, content) => page.getByTestId('message').filter({
  has: page.locator('.message-text', { hasText: content }),
});

function observeWS(page) {
  const received = [], sent = [];
  page.on('websocket', socket => {
    expect(new URL(socket.url()).pathname).toBe('/ws');
    socket.on('framereceived', frame => received.push(JSON.parse(frame.payload.toString())));
    socket.on('framesent', frame => sent.push(JSON.parse(frame.payload.toString())));
  });
  return { received, sent };
}

async function contexts(browser) {
  const full = await browser.newContext({ baseURL: process.env.E2E_BASE_URL,
    viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
  try {
    const lite = await browser.newContext({ baseURL: process.env.E2E_LITE_URL,
      viewport: { width: 390, height: 844 } });
    await full.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
    return { full, lite, close: () => Promise.all([full.close(), lite.close()]) };
  } catch (error) { await full.close(); throw error; }
}

async function loginReact(page, session) {
  await page.goto('/');
  await page.evaluate(token => sessionStorage.setItem('token', token), session.access_token);
  await page.reload();
  await expect(page.getByTestId('conversation-list')).toBeVisible();
}

async function openReact(page, request, wire) {
  const session = await fixtureSession(request);
  const response = await page.request.get('/api/conversations/', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  expect(response.ok()).toBeTruthy();
  const conversation = (await response.json()).find(c => !c.is_group &&
    c.participants.some(p => p.username === credentials().peer));
  expect(conversation, 'seeded Alice/Bob direct chat').toBeTruthy();
  await page.getByTestId('conversation-item').and(page.locator(`[data-conversation-id="${conversation.id}"]`)).click();
  await expect(page.getByTestId('chat-title')).toHaveText(credentials().peer);
  await expect(page.getByTestId('message-input')).toBeVisible();
  // A mark_read from the real UI proves its WS and chat listeners are ready.
  await expect.poll(() => wire.sent.some(e => e.type === 'mark_read' && e.conversation_id === conversation.id)).toBe(true);
  return conversation.id;
}

async function sendReact(page, wire, content) {
  await page.getByTestId('message-input').fill(content);
  await page.getByTestId('send-button').click();
  await expect.poll(() => wire.received.find(e => e.type === 'message' && e.content === content)?.message_id).toBeTruthy();
  const id = wire.received.find(e => e.type === 'message' && e.content === content).message_id;
  await expect(reactMessage(page, id).locator('.message-text')).toHaveText(content);
  await expect(reactText(page, content)).toHaveCount(1);
  expect(wire.sent.filter(e => e.type === 'message' && e.content === content)).toHaveLength(1);
  return id;
}

async function reactAction(page, id, action) {
  const row = reactMessage(page, id);
  await row.hover();
  await row.getByTestId('message-more').click();
  await expect(page.getByTestId('message-context-menu')).toBeVisible();
  await page.getByTestId('message-context-menu').getByTestId(`action-${action}`).click();
}

test('React Alice and lite Bob send, edit and delete live in both directions exactly once', async ({ browser, request }, testInfo) => {
  const pair = await contexts(browser);
  try {
    const alice = await pair.full.newPage(), bob = await pair.lite.newPage();
    const wire = observeWS(alice), events = await observeSSE(bob);
    await loginReact(alice, await fixtureSession(request));
    const id = await openReact(alice, request, wire);
    await login(bob, await fixtureSession(request, true));
    expect(await openConversation(bob, credentials().username)).toBe(id);

    const aliceText = unique('react-to-lite');
    const fromAlice = await sendReact(alice, wire, aliceText);
    await received(events, 'message', fromAlice);
    await expect(messageByID(bob, fromAlice).getByTestId('message-content')).toHaveText(aliceText);
    await expect(messageByID(bob, fromAlice)).toHaveCount(1);

    const bobText = unique('lite-to-react');
    const fromBob = await send(bob, bobText);
    await expect(reactMessage(alice, fromBob.id).locator('.message-text')).toHaveText(bobText);
    await expect(reactText(alice, bobText)).toHaveCount(1);
    await received(wire.received, 'message', fromBob.id);
    await received(events, 'message', fromBob.id);

    const bobEdit = unique('lite-edit');
    bob.once('dialog', dialog => dialog.accept(bobEdit));
    await messageByID(bob, fromBob.id).getByTestId('edit-message').click();
    await received(wire.received, 'message_edited', fromBob.id);
    await received(events, 'message_edited', fromBob.id);
    await expect(reactMessage(alice, fromBob.id).locator('.message-text')).toHaveText(bobEdit);
    await expect(reactMessage(alice, fromBob.id).locator('.message-edited-label')).toBeVisible();

    const aliceEdit = unique('react-edit');
    await reactAction(alice, fromAlice, 'edit');
    await expect(alice.getByTestId('edit-banner')).toBeVisible();
    await alice.getByTestId('message-input').fill(aliceEdit);
    await alice.getByTestId('send-button').click();
    await received(events, 'message_edited', fromAlice);
    await received(wire.received, 'message_edited', fromAlice);
    await expect(messageByID(bob, fromAlice).getByTestId('message-content')).toHaveText(aliceEdit);
    await expect(messageByID(bob, fromAlice).getByTestId('message-edited')).toBeVisible();

    await messageByID(bob, fromBob.id).getByTestId('delete-everyone').click();
    await received(wire.received, 'message_deleted', fromBob.id);
    await received(events, 'message_deleted', fromBob.id);
    await expect(reactMessage(alice, fromBob.id).locator('.message-deleted-text')).toHaveText('Message deleted');

    await reactAction(alice, fromAlice, 'delete-all');
    await received(events, 'message_deleted', fromAlice);
    await received(wire.received, 'message_deleted', fromAlice);
    await expect(messageByID(bob, fromAlice)).toHaveAttribute('data-deleted', '1');
    await expect(messageByID(bob, fromAlice).getByTestId('message-content')).toHaveText('[deleted]');

    // Later messages fence both ordered streams before counting earlier frames.
    const reactFence = await sendReact(alice, wire, unique('react-fence'));
    await received(events, 'message', reactFence);
    const liteFence = await send(bob, unique('lite-fence'));
    await received(wire.received, 'message', liteFence.id);
    await received(events, 'message', liteFence.id);
    for (const messageID of [fromAlice, fromBob.id]) {
      for (const frames of [wire.received, events]) {
        for (const type of ['message', 'message_edited', 'message_deleted']) {
          expect(frames.filter(e => e.type === type && e.message_id === messageID), `${type} ${messageID} exactly once`).toHaveLength(1);
        }
      }
      await expect(reactMessage(alice, messageID)).toHaveCount(1);
      await expect(messageByID(bob, messageID)).toHaveCount(1);
    }
    expect(wire.sent.filter(e => e.type === 'edit_message' && e.message_id === fromAlice)).toHaveLength(1);
    expect(wire.sent.filter(e => e.type === 'delete_message' && e.message_id === fromAlice)).toHaveLength(1);
    await testInfo.attach('interop-delivery', { contentType: 'application/json', body: JSON.stringify({
      full: process.env.E2E_BASE_URL, lite: process.env.E2E_LITE_URL, conversation: id,
      messages: [fromAlice, fromBob.id], fences: [reactFence, liteFence.id],
      ws: wire.received.filter(e => [fromAlice, fromBob.id].includes(e.message_id)),
      sse: events.filter(e => [fromAlice, fromBob.id].includes(e.message_id)),
    }, null, 2) });
  } finally { await pair.close(); }
});

test('one React form login supplies the same account token to both ports', async ({ browser }, testInfo) => {
  const pair = await contexts(browser);
  const logins = [];
  try {
    for (const context of [pair.full, pair.lite]) context.on('request', req => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/auth/login') logins.push(new URL(req.url()).origin);
    });
    const alice = await pair.full.newPage(), liteAlice = await pair.lite.newPage();
    await alice.goto('/');
    await alice.getByLabel('Username', { exact: true }).fill(credentials().username);
    await alice.getByLabel('Password', { exact: true }).fill(credentials().password);
    const loggedIn = alice.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
    await alice.getByRole('button', { name: 'Sign In', exact: true }).click();
    const response = await loggedIn;
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    await expect(alice.getByTestId('conversation-list')).toBeVisible();
    await login(liteAlice, session);
    await openConversation(liteAlice);
    for (const page of [alice, liteAlice]) {
      expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe(session.access_token);
      const me = await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      expect(me.ok()).toBeTruthy();
      expect(await me.json()).toMatchObject({ id: session.user.id, username: credentials().username });
    }
    expect(logins).toEqual([process.env.E2E_BASE_URL]);
    await testInfo.attach('shared-login', { contentType: 'application/json', body: JSON.stringify({
      origins: [process.env.E2E_BASE_URL, process.env.E2E_LITE_URL], user: session.user.id, loginRequests: logins.length,
    }) });
  } finally { await pair.close(); }
});

test('a lite SSE session makes Bob online in React and closing it makes Bob offline', async ({ browser, request }, testInfo) => {
  const pair = await contexts(browser);
  try {
    const alice = await pair.full.newPage(), bob = await pair.lite.newPage();
    const wire = observeWS(alice), liteSockets = [];
    bob.on('websocket', socket => liteSockets.push(socket.url()));
    await loginReact(alice, await fixtureSession(request));
    await openReact(alice, request, wire);
    const status = alice.getByTestId('chat-window').locator('.status-indicator');
    await expect(status).toHaveText('Offline');
    const session = await fixtureSession(request, true);
    await login(bob, session);
    await expect.poll(() => wire.received.some(e => e.type === 'user_online' && e.user_id === session.user.id)).toBe(true);
    await expect(status).toHaveText('Online');
    expect(liteSockets).toEqual([]);
    await pair.lite.close();
    await expect.poll(() => wire.received.some(e => e.type === 'user_offline' && e.user_id === session.user.id)).toBe(true);
    await expect(status).toHaveText('Offline');
    await testInfo.attach('lite-presence', { contentType: 'application/json', body: JSON.stringify({
      user: session.user.id, liteWebSockets: liteSockets.length,
      transitions: wire.received.filter(e => ['user_online', 'user_offline'].includes(e.type) && e.user_id === session.user.id),
    }) });
  } finally { await pair.close(); }
});
