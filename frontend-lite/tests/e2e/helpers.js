import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { authFile } from './setup.js';

export function credentials() {
  const { E2E_USERNAME: username, E2E_PASSWORD: password, E2E_PEER: peer } = process.env;
  if (!username || !password || !peer) throw new Error('Export credentials using the lite e2e/run.sh env action.');
  return { username, password, peer, peerPassword: process.env.E2E_PEER_PASSWORD || password };
}

export const unique = label => `lite-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const messages = page => page.getByTestId('message-list').locator(':scope > li');
export const messageByID = (page, id) => page.getByTestId(`message-${id}`);

export async function apiSession() {
  const { access_token } = JSON.parse(await readFile(authFile, 'utf8'));
  return { Authorization: `Bearer ${access_token}` };
}

export async function fixtureSession(request, peer = false) {
  if (!peer) return JSON.parse(await readFile(authFile, 'utf8'));
  const { peer: username, peerPassword: password } = credentials();
  const cache = new URL('../../playwright/.cache/peer.json', import.meta.url);
  const baseURL = process.env.E2E_LITE_URL;
  try {
    const saved = JSON.parse(await readFile(cache, 'utf8'));
    if (saved.baseURL === baseURL && saved.username === username) {
      const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${saved.session.access_token}` } });
      if (me.ok()) return saved.session;
    }
  } catch { /* First run or stack reset: authenticate the peer once. */ }
  const response = await request.post('/api/auth/login', { data: { username, password } });
  expect(response.ok(), `peer fixture login HTTP ${response.status()}`).toBeTruthy();
  const session = await response.json();
  await writeFile(cache, JSON.stringify({ baseURL, username, session }), { mode: 0o600 });
  return session;
}

export async function waitLive(page) {
  await expect(page.getByTestId('live-status')).toHaveAttribute('data-live', '1');
}

export async function login(page, session) {
  session ||= JSON.parse(await readFile(authFile, 'utf8'));
  await page.goto('/');
  await page.evaluate(value => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('token', value.access_token);
    sessionStorage.setItem('user', JSON.stringify(value.user));
  }, session);
  await page.reload();
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await waitLive(page);
}

export async function formLogin(page, remember = false) {
  const { username, password } = credentials();
  await page.goto('/');
  await page.getByTestId('login-username').fill(username);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('remember-me').setChecked(remember);
  const sent = page.waitForRequest(req => new URL(req.url()).pathname === '/api/auth/login' && req.method() === 'POST');
  await page.getByTestId('login-submit').click();
  expect((await sent).postDataJSON()).toMatchObject({ username, remember_me: remember });
  await expect(page.getByTestId('conversation-list')).toBeVisible();
  await waitLive(page);
}

export async function openConversation(page, peer = credentials().peer) {
  const token = await page.evaluate(() => sessionStorage.getItem('token') || localStorage.getItem('token'));
  const response = await page.request.get('/api/conversations/', { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  const conversation = (await response.json()).find(c => !c.is_group && c.participants.some(p => p.username === peer));
  expect(conversation, `direct fixture with ${peer}`).toBeTruthy();
  await page.getByTestId(`conversation-${conversation.id}`).getByRole('link').click();
  await expect(page.getByTestId('message-input')).toBeVisible();
  await expect(page).toHaveURL(/#\/c\/\d+$/);
  await waitLive(page);
  return Number(new URL(page.url()).hash.split('/').at(-1));
}

export async function send(page, text) {
  await page.getByTestId('message-input').fill(text);
  const response = page.waitForResponse(r => /\/api\/conversations\/\d+\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
  await page.getByTestId('send-message').click();
  const result = await response;
  expect(result.ok(), `send HTTP ${result.status()}`).toBeTruthy();
  const saved = await result.json();
  await expect(messageByID(page, saved.id).getByTestId('message-content')).toHaveText(text);
  return saved;
}

export async function apiMessage(request, conversationID, content, peer = false) {
  const session = await fixtureSession(request, peer);
  const response = await request.post(`/api/conversations/${conversationID}/messages`, {
    headers: { Authorization: `Bearer ${session.access_token}` }, data: { content },
  });
  expect(response.ok(), `fixture send HTTP ${response.status()}`).toBeTruthy();
  return response.json();
}

export async function pairedPages(browser, request) {
  const aliceContext = await browser.newContext({ baseURL: process.env.E2E_LITE_URL });
  const bobContext = await browser.newContext({ baseURL: process.env.E2E_LITE_URL });
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    const aliceEvents = await observeSSE(alice);
    const bobEvents = await observeSSE(bob);
    await login(alice);
    await login(bob, await fixtureSession(request, true));
    const id = await openConversation(alice);
    expect(await openConversation(bob, credentials().username)).toBe(id);
    return { alice, bob, aliceEvents, bobEvents, id,
      close: () => Promise.all([aliceContext.close(), bobContext.close()]) };
  } catch (error) {
    await Promise.all([aliceContext.close(), bobContext.close()]);
    throw error;
  }
}

export async function observeSSE(page) {
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Network.eventSourceMessageReceived', event => {
    events.push({ type: event.eventName, ...JSON.parse(event.data) });
  });
  await cdp.send('Network.enable');
  return events;
}

export async function received(events, type, id) {
  await expect.poll(() => events.some(event => event.type === type && event.message_id === id),
    { message: `SSE ${type} for message ${id}` }).toBe(true);
}

// Chromium offline emulation leaves existing EventSource sockets alive. Forward
// only the real SSE request through a disposable loopback socket we can sever.
export async function sseFault(page) {
  const origin = process.env.E2E_LITE_URL;
  const sockets = new Set(), upstreams = new Set();
  let paused = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    if (url.origin !== origin || url.pathname !== '/api/events') {
      res.writeHead(404);
      return res.end();
    }
    if (paused) return res.destroy();
    const upstream = http.get(url, {
      headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'identity' },
    }, incoming => {
      res.writeHead(incoming.statusCode, { ...incoming.headers, 'access-control-allow-origin': origin });
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
    });
    upstreams.add(upstream);
    upstream.on('close', () => upstreams.delete(upstream));
    upstream.on('error', () => res.destroy());
    res.on('close', () => upstream.destroy());
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const pattern = '**/api/events?*';
  const forward = route => {
    const url = new URL(route.request().url());
    return route.continue({ url: `http://127.0.0.1:${server.address().port}${url.pathname}${url.search}` });
  };
  await page.route(pattern, forward);
  const sever = () => {
    for (const upstream of upstreams) upstream.destroy();
    for (const socket of sockets) socket.destroy();
  };
  return {
    drop() { paused = true; sever(); },
    resume() { paused = false; },
    async close() {
      await page.unroute(pattern, forward);
      sever();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export async function axe(page, testInfo, view) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await testInfo.attach(`axe-${view}`, { contentType: 'application/json', body: JSON.stringify(result, null, 2) });
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), `${view}: axe violations`).toEqual([]);
}
