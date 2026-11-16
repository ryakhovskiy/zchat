'use strict';
// zchat lite client: plain DOM + fetch + EventSource. All server text goes in via textContent.
const API = '/api', TYPES = ['message', 'message_edited', 'message_deleted'], VIEWS = ['login', 'register', 'list', 'chat'];
const $ = id => document.getElementById(id);

let tok, me, view, cur;          // token, {id,username}, visible view, open conversation id
let gen = 0;                     // session generation: async results from an older session are dropped
let convs = [], msgs = [], more = false, ready = false, synced = false, older = false;
let log = [], seq = 0;           // recent live events, replayed over REST responses that raced them
let es, lg = 0, timer, retry = 0, liveOn = false;

const get = k => { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch { return null; } };
const fail = e => { $('err').textContent = e.message || String(e); };
const hm = t => new Date(t).toTimeString().slice(0, 5);
const body = m => m.del ? '[deleted]' : [m.text, m.file && '[file]'].filter(Boolean).join(' ');

function el(tag, text, id) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (id) e.dataset.testid = id;
  return e;
}

async function api(path, o = {}) {
  const t = tok;
  let r;
  try {
    r = await fetch(API + path, {
      method: o.m || 'GET',
      headers: Object.assign(t ? { Authorization: 'Bearer ' + t } : {}, o.b ? { 'Content-Type': 'application/json' } : {}),
      body: o.b && JSON.stringify(o.b),
    });
  } catch { throw new Error('Network error'); }
  const d = await r.json().catch(() => ({}));
  if (r.status == 401 && t && t == tok) { signOut(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error(d.error || (r.status == 429 ? 'Too many attempts, wait a minute' : 'Error ' + r.status));
  return d;
}

// REST rows use id/created_at, SSE frames use message_id/timestamp: one shape for both.
const norm = m => ({
  id: m.message_id || m.id, cid: m.conversation_id, uid: m.sender_id, user: m.sender_username,
  ts: Date.parse(m.timestamp || m.created_at), text: m.content || '', del: !!m.is_deleted, edited: !!m.is_edited,
  file: !!(m.file_path || (m.attachments && m.attachments.length)),
});
const nc = c => ({
  id: c.id, unread: c.unread_count || 0, last: c.last_message ? norm(c.last_message) : null,
  title: c.name || c.participants.filter(p => p.id != me.id).map(p => p.username).join(', ') || me.username,
  ts: Date.parse((c.last_message || c).created_at),
});

// ---- session ----
function enter(r, remember) {
  const [s, o] = remember ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
  o.removeItem('token'); o.removeItem('user');
  s.setItem('token', r.access_token);
  s.setItem('user', JSON.stringify({ id: r.user.id, username: r.user.username }));
  boot();
}

function signOut() {
  ++gen; ++lg; clearTimeout(timer);
  if (es) es.close();
  es = null; setLive(false);
  for (const s of [localStorage, sessionStorage]) {
    try { s.removeItem('token'); s.removeItem('user'); } catch { /* storage unavailable */ }
  }
  tok = me = view = cur = null;
  convs = []; msgs = []; log = []; ready = synced = more = false; retry = 0;
  $('ml').replaceChildren(); $('cl').replaceChildren();
  location.replace('#/login');
  route();
}

function boot() {
  tok = get('token');
  try { me = JSON.parse(get('user')); } catch { me = null; }
  if (tok && !(me && me.id)) return signOut();
  ++gen;
  if (tok) {
    live();
    if (!/^#\/c\/\d+$/.test(location.hash)) location.replace('#/');
  }
  route();
}

// ---- views ----
function route() {
  const m = /^#\/c\/(\d+)$/.exec(location.hash);
  const v = !tok ? (location.hash == '#/register' ? 'register' : 'login') : m ? 'chat' : 'list';
  const c = tok && m ? +m[1] : null;
  for (const s of VIEWS) $(s).hidden = s != v;
  $('bar').hidden = !tok;
  if (tok) $('me').textContent = me.username;
  const changed = v != view || c != cur;
  view = v;
  if (!changed) return;
  $('err').textContent = '';
  $(v).querySelector('h2').focus();
  if (c != cur) {
    cur = c; msgs = []; more = false;
    $('cf').text.value = '';
    if (c) loadLatest().catch(fail);
  }
  if (v == 'list') loadUsers().catch(fail);
  paint();
}

// Redraw a list without losing keyboard focus on one of its buttons/links.
function keep(ul, draw) {
  const a = document.activeElement, li = a && ul.contains(a) && a.closest('li');
  const k = li && [li.dataset.testid, a.dataset.testid];
  draw();
  const n = k && ul.querySelector(`[data-testid="${k[0]}"] [data-testid="${k[1]}"]`);
  if (n) n.focus();
}

function paint(bottom) {
  const c = convs.find(x => x.id == cur);
  $('ct').textContent = c ? c.title : 'Chat';
  keep($('cl'), drawList);
  if (cur) keep($('ml'), () => drawMsgs(bottom));
}

function drawList() {
  $('none').hidden = !ready || convs.length > 0;
  $('cl').replaceChildren(...convs.slice().sort((a, b) => b.ts - a.ts).map(c => {
    const li = document.createElement('li'), a = el('a', c.title, 'conversation-title');
    li.dataset.testid = 'conversation-' + c.id;
    li.dataset.unread = c.unread;
    a.href = '#/c/' + c.id;
    li.append(a);
    if (c.unread) li.append(' ', el('span', c.unread, 'unread-count'), ' unread');
    if (c.last) li.append(el('div', `${c.last.user}: ${body(c.last)}`.slice(0, 80), 'conversation-preview'));
    return li;
  }));
}

function row(m) {
  const li = document.createElement('li'), own = m.uid == me.id, t = hm(m.ts);
  li.dataset.testid = 'message-' + m.id;
  li.dataset.id = m.id;
  li.dataset.own = own ? 1 : 0;
  if (m.del) li.dataset.deleted = 1;
  li.append(el('span', `[${t}] ${m.user}: `, 'message-meta'), el('span', body(m), 'message-content'));
  if (m.edited && !m.del) li.append(' ', el('span', '(edited)', 'message-edited'));
  if (own && !m.del) {
    for (const [id, text, name] of [['edit-message', 'edit', 'edit message'], ['delete-message', 'delete', 'delete message'], ['delete-everyone', 'delete for all', 'delete for all message']]) {
      const b = el('button', text, id);
      b.type = 'button';
      b.setAttribute('aria-label', `${name} from ${t}`);
      li.append(' ', b);
    }
  }
  return li;
}

function drawMsgs(bottom) {
  const atBottom = innerHeight + scrollY >= document.body.scrollHeight - 80;
  $('ml').replaceChildren(...msgs.map(row));
  $('more').hidden = !more;
  if (bottom || atBottom) scrollTo(0, document.body.scrollHeight);
}

// ---- state changes: every message mutation (live or local) is an event ----
function apply(e) {
  const m = e.m;
  if (m) {
    const c = convs.find(x => x.id == m.cid);
    if (c && (!c.last || m.id > c.last.id)) {
      c.last = m; c.ts = m.ts;
      if (m.cid != cur && m.uid != me.id) c.unread++;
    }
    if (m.cid == cur && !msgs.some(x => x.id == m.id)) {
      msgs.push(m);
      msgs.sort((a, b) => a.id - b.id);
    }
    return;
  }
  if (e.t == 'del' && e.type == 'for_me') msgs = msgs.filter(x => x.id != e.id);
  const patch = e.t == 'edit' ? { text: e.text, edited: true } : { del: true, text: '' };
  for (const x of msgs.concat(convs.map(c => c.last))) if (x && x.id == e.id && !x.del) Object.assign(x, patch);
}

function ev(e) {
  if (!tok) return;
  e.n = ++seq;
  log.push(e);
  if (log.length > 200) log.shift();
  apply(e);
  const m = e.m;
  if (m && !convs.some(c => c.id == m.cid)) loadList().catch(fail);
  if (m && m.cid == cur && m.uid != me.id) markRead();
  paint(m && m.uid == me.id);
}

// Re-apply events that happened while a REST request was in flight (its response may predate them).
const since = n => log.filter(e => e.n > n).forEach(apply);

function ingest(d) {
  if (d.type == 'message') ev({ t: 'message', m: norm(d) });
  else if (d.type == 'message_edited') ev({ t: 'edit', id: d.message_id, text: d.content });
  else if (d.type == 'message_deleted') ev({ t: 'del', id: d.message_id, type: d.delete_type });
}

// ---- loading ----
async function loadList() {
  const g = gen, n = seq, d = await api('/conversations/');
  if (g != gen) return;
  convs = d.map(nc);
  ready = true;
  const k = convs.find(c => c.id == cur);
  if (k) k.unread = 0;
  since(n);
  paint();
}

async function loadUsers() {
  const g = gen, u = await api('/users/');
  if (g != gen) return;
  const s = $('nf').user, v = s.value;
  s.replaceChildren(new Option('Start a chat with...', ''), ...u.filter(x => x.id != me.id).map(x => new Option(x.username, x.id)));
  s.value = v;
}

async function loadLatest() {
  const g = gen, c = cur, n = seq, p = (await api(`/conversations/${c}/messages?limit=20`)).map(norm);
  if (g != gen || c != cur) return;
  const had = msgs.length, f = p.length ? p[0].id : 0;
  const keepOld = p.length < 20 || msgs.some(m => m.id >= f);   // otherwise a gap: start over from this page
  if (!keepOld || !had) more = p.length >= 20;
  msgs = keepOld ? msgs.filter(m => m.id < f).concat(p) : p;
  since(n);
  paint(!had);
  markRead();
}

async function loadOlder() {
  if (older || !msgs.length) return;
  older = true;
  try {
    const g = gen, c = cur, n = seq;
    const p = (await api(`/conversations/${c}/messages?limit=20&before_id=${msgs[0].id}`)).map(norm);
    if (g != gen || c != cur) return;
    const h = document.body.scrollHeight;
    more = p.length >= 20;
    msgs = p.concat(msgs);
    since(n);
    paint();
    scrollBy(0, document.body.scrollHeight - h);
  } finally { older = false; }
}

function markRead() {
  const c = cur, g = gen;
  api(`/conversations/${c}/read`, { m: 'POST' }).then(() => {
    const k = convs.find(x => x.id == c);
    if (g == gen && k && k.unread) { k.unread = 0; paint(); }
  }, () => { /* unread badge just stays until the next resync */ });
}

const sync = () => Promise.all([loadList(), cur && loadLatest()]);

// ---- live updates (SSE) ----
function setLive(on) {
  liveOn = on;
  const s = $('live');
  s.dataset.live = on ? 1 : 0;
  s.textContent = on ? 'live' : 'offline';
}

async function live() {
  const my = ++lg;
  clearTimeout(timer);
  if (es) es.close();
  es = null; setLive(false);
  const again = () => {
    if (my != lg) return;
    if (es) es.close();
    es = null; setLive(false);
    timer = setTimeout(live, Math.min(1000 * 2 ** retry++, 30000));
  };
  try {
    const { ticket } = await api('/events/ticket', { m: 'POST' });
    if (my != lg) return;
    const s = es = new EventSource(API + '/events?ticket=' + encodeURIComponent(ticket));
    s.onerror = again;
    // Resync only once the stream is open, so nothing can fall between the REST load and the stream.
    s.onopen = () => sync().then(() => {
      if (my != lg || es != s) return;
      retry = 0; synced = true; setLive(true);
    }, again);
    for (const t of TYPES) s.addEventListener(t, e => { try { ingest(JSON.parse(e.data)); } catch { /* bad frame */ } });
  } catch {
    if (my != lg) return;
    if (!synced) sync().then(() => { synced = true; }, fail);   // no stream: still show data
    again();
  }
}

function wake() {
  if (tok && !liveOn && !document.hidden) { retry = 0; live(); }
}

// ---- wiring ----
function form(id, fn) {
  const f = $(id);
  f.onsubmit = async e => {
    e.preventDefault();
    if (f.dataset.busy) return;
    f.dataset.busy = 1;
    $('err').textContent = '';
    try { await fn(f); } catch (x) { fail(x); } finally { delete f.dataset.busy; }
  };
}

const cred = f => ({ username: f.username.value.trim(), password: f.password.value });

form('lf', async f => {
  const remember = f.remember.checked;
  const r = await api('/auth/login', { m: 'POST', b: { ...cred(f), remember_me: remember } });
  f.password.value = '';
  enter(r, remember);
});

form('rf', async f => {
  const b = cred(f);
  b.email = f.email.value.trim() || null;
  await api('/auth/register', { m: 'POST', b });
  const r = await api('/auth/login', { m: 'POST', b: { ...cred(f), remember_me: false } });
  f.password.value = '';
  enter(r, false);
});

form('nf', async f => {
  const id = +f.user.value;
  if (!id) return;
  const g = gen, r = await api('/conversations/', { m: 'POST', b: { is_group: false, participant_ids: [id] } });
  if (g != gen) return;
  if (!convs.some(c => c.id == r.id)) convs.push(nc(r));
  f.user.value = '';
  location.hash = '#/c/' + r.id;
});

form('cf', async f => {
  const c = cur, t = f.text.value.trim();
  if (!t) return;
  const g = gen, r = await api(`/conversations/${c}/messages`, { m: 'POST', b: { content: t } });
  if (g != gen) return;
  ev({ t: 'message', m: norm(r) });
  if (cur == c && f.text.value.trim() == t) f.text.value = '';
});

$('cf').text.onkeydown = e => {
  if (e.key == 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) {
    e.preventDefault();
    $('cf').requestSubmit();
  }
};

$('ml').onclick = e => {
  const b = e.target.closest('button'), li = b && b.closest('li');
  const m = li && msgs.find(x => x.id == li.dataset.id);
  if (m) { $('err').textContent = ''; act(b.dataset.testid, m).catch(fail); }
};

async function act(k, m) {
  const g = gen;
  if (k == 'edit-message') {
    const t = prompt('Edit message', m.text);
    if (t == null || !t.trim() || t.trim() == m.text) return;
    const r = await api('/messages/' + m.id, { m: 'PUT', b: { content: t.trim() } });
    if (g == gen) ev({ t: 'edit', id: m.id, text: r.content });
  } else {
    const all = k == 'delete-everyone', type = all ? 'for_everyone' : 'for_me';
    await api(`/messages/${m.id}?delete_type=${type}`, { m: 'DELETE' });
    if (g == gen) ev({ t: 'del', id: m.id, type });
  }
}

$('more').onclick = () => loadOlder().catch(fail);
$('sr').onclick = () => { location.hash = '#/register'; };
$('sl').onclick = () => { location.hash = '#/login'; };
$('out').onclick = () => { api('/auth/logout', { m: 'POST' }).catch(() => {}); signOut(); };
addEventListener('hashchange', route);
addEventListener('online', wake);
document.addEventListener('visibilitychange', wake);
boot();
