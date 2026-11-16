import { test, expect } from '@playwright/test';
import { apiSession, credentials, login, messageByID, observeSSE, openConversation,
  received, send, unique, waitLive } from './helpers.js';

// Commit a real write on the server, but hold its original acknowledgement until
// a later operation has been observed in the browser. Match completion by Request
// identity so another request to the same endpoint cannot release the assertion.
async function holdWrite(page, method, pathname) {
  let arrived, release, intercepted;
  const ready = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delivered = page.waitForEvent('requestfinished', { predicate: req => req === intercepted });
  delivered.catch(() => {}); // Cleanup can run after an earlier assertion fails.
  const pattern = `**${pathname}`;
  const handler = async route => {
    const req = route.request();
    if (intercepted || req.method() !== method || new URL(req.url()).pathname !== pathname) return route.fallback();
    intercepted = req;
    const response = await route.fetch();
    arrived({ status: response.status(), body: await response.json() });
    await gate;
    await route.fulfill({ response });
  };
  await page.route(pattern, handler);
  return { ready, async settle() {
    release();
    await delivered;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }, async close() {
    release();
    await page.unroute(pattern, handler);
  } };
}

test('a delayed edit A acknowledgement cannot overwrite a newer SSE edit B', async ({ page, request }) => {
  const events = await observeSSE(page);
  await login(page);
  await openConversation(page);
  const saved = await send(page, unique('edit-ack-original'));
  const editA = unique('edit-A'), editB = unique('edit-B');
  const held = await holdWrite(page, 'PUT', `/api/messages/${saved.id}`);
  try {
    page.once('dialog', dialog => dialog.accept(editA));
    await messageByID(page, saved.id).getByTestId('edit-message').click();
    const committed = await held.ready;
    expect(committed.status).toBe(200);
    expect(committed.body.content).toBe(editA);

    // An independent REST client belonging to the same author edits it again.
    const newer = await request.put(`/api/messages/${saved.id}`, {
      headers: await apiSession(), data: { content: editB },
    });
    expect(newer.ok()).toBeTruthy();
    await expect.poll(() => events.some(e => e.type === 'message_edited' && e.message_id === saved.id && e.content === editB)).toBe(true);
    await expect(messageByID(page, saved.id).getByTestId('message-content')).toHaveText(editB);
    await held.settle();
    await expect(messageByID(page, saved.id).getByTestId('message-content')).toHaveText(editB);
    await expect(messageByID(page, saved.id)).toHaveCount(1);
  } finally { await held.close(); }
});

test('a delayed send acknowledgement cannot resurrect a newer SSE delete-for-me', async ({ page, request }) => {
  const events = await observeSSE(page);
  await login(page);
  const id = await openConversation(page);
  const content = unique('send-ack-deleted');
  const held = await holdWrite(page, 'POST', `/api/conversations/${id}/messages`);
  try {
    await page.getByTestId('message-input').fill(content);
    await page.getByTestId('send-message').click();
    const committed = await held.ready;
    expect(committed.status).toBe(201);
    const saved = committed.body;
    await received(events, 'message', saved.id);
    await expect(messageByID(page, saved.id).getByTestId('message-content')).toHaveText(content);

    const deleted = await request.delete(`/api/messages/${saved.id}?delete_type=for_me`, { headers: await apiSession() });
    expect(deleted.ok()).toBeTruthy();
    await received(events, 'message_deleted', saved.id);
    await expect(messageByID(page, saved.id)).toHaveCount(0);
    await held.settle();
    await expect(messageByID(page, saved.id)).toHaveCount(0);
  } finally { await held.close(); }
});

test('registration completing after a different-account login cannot replace that account', async ({ page }) => {
  const username = `lite_pending_${Date.now()}`;
  const { username: existing, password } = credentials();
  const loginUsers = [];
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/auth/login') loginUsers.push(req.postDataJSON().username);
  });
  await page.goto('/');
  await page.getByTestId('show-register').click();
  await page.getByTestId('register-username').fill(username);
  await page.getByTestId('register-password').fill(password);
  const held = await holdWrite(page, 'POST', '/api/auth/register');
  try {
    await page.getByTestId('register-submit').click();
    expect((await held.ready).status).toBe(201);
    await page.getByTestId('show-login').click();
    await page.getByTestId('login-username').fill(existing);
    await page.getByTestId('login-password').fill(password);
    const signedIn = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().postDataJSON().username === existing);
    await page.getByTestId('login-submit').click();
    const response = await signedIn;
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await waitLive(page);

    await held.settle();
    // A stale registration must not even launch its old follow-up login. This
    // catches that race before a slower login response could replace the token.
    expect(loginUsers).toEqual([existing]);
    expect(await page.evaluate(() => ({ token: sessionStorage.getItem('token'),
      user: JSON.parse(sessionStorage.getItem('user')), local: localStorage.getItem('token') })))
      .toEqual({ token: session.access_token, user: { id: session.user.id, username: existing }, local: null });
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await waitLive(page);
  } finally { await held.close(); }
});
