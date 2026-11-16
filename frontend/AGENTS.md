# AGENTS.md

## Project: zchat frontend (lite client)
A minimal text-only web client for very slow links: two static files, no framework, no build step, no dependencies. Plain HTML, standard controls, a few lines of inline CSS and about 400 lines of vanilla JS. Live updates arrive over Server-Sent Events (SSE).

It replaced the React/Vite app. Not supported (by design): groups (existing groups are listed and readable, but there is no way to create one), files and images (an attachment from another client shows as `[file]`), reactions, presence, read receipts, typing, calls, push, themes, i18n, PWA/offline, emoji picker. Android still uses the WebSocket API and is unaffected.

## Files
| Path | Purpose |
|------|---------|
| `index.html` | Markup for all views, inline `<style>`, `<noscript>` note, `<link rel="icon" href="data:,">`. No inline scripts, no inline event handlers |
| `app.js` | The whole client (state, REST, SSE, rendering) |
| `dev-proxy.mjs` | Dev only, no dependencies, not part of the image. Serves the two files and proxies `/api` to a local backend |
| `Dockerfile`, `docker/nginx.conf`, `nginx.conf` | Owned by deployment (the image only copies `index.html` and `app.js`) |
| `tests/`, `playwright.config.js` | Owned by qa (Playwright + axe against a disposable stack) |

## Hard constraints
- **Budget:** `index.html` + `app.js` must be at most **8192 bytes gzipped combined**, with no other assets. Check: `cd frontend && echo $(( $(gzip -9 < index.html | wc -c) + $(gzip -9 < app.js | wc -c) ))`. Currently about 7.0 KB.
- **Standard controls only:** `form`, `input`, `select`, `button`, `textarea`, `ul`, plus plain `a` for navigation. No CSS file, no web fonts, no images, no icons. `color-scheme: light dark` follows the OS.
- **`textContent` only.** Server text (usernames, messages, titles) is never put into `innerHTML`. The JWT lives in web storage, so XSS would leak it. `Option` objects, `textContent` and `dataset` are the only ways text enters the DOM.
- **CSP-clean:** no inline scripts and no inline handlers (`onclick=` attributes). The nginx CSP allows `script-src 'self'` and inline styles only. Handlers are assigned from `app.js`.
- **No new dependencies, no build step.** Every byte ships to a slow link; justify additions against the budget.
- Do not change backend contracts. If the API does not fit, ask `zchat-backend`.

## Behaviour
- **Views** are `hidden` sections switched by `location.hash`: signed out `#/login` (default) or `#/register`; signed in `#/` (conversation list plus new-chat picker) or `#/c/<id>` (chat). The browser back button works and nginx needs no routing.
- **Auth:** `POST /api/auth/login` (`remember_me` from the checkbox) and `/api/auth/register`, whose 201 response already carries the session (token + user) and is used directly for a session-only sign-in. Each auth submit is an *attempt* (`att`): switching between login and register, a newer submit, sign-out or any session change supersedes it, and a superseded attempt neither signs anyone in nor shows an error (an account it already created stays created). The token is stored under the key `token` and `{id, username}` under `user`, in `sessionStorage` by default or `localStorage` when "Stay signed in" is ticked, never both. Any 401 or logout clears both. Login and register are rate limited to 10 requests per minute per IP, so register uses 2.
- **List:** `GET /api/conversations/`, sorted client-side by last-message time (nothing bumps `updated_at`). Direct chats are titled by the other participant's username even if the row has a name; groups by their name. Unread counts come from `unread_count` and are incremented from live messages only when the message id is newer than the stored last message, which keeps replays idempotent.
- **Messages:** page size 20, always sent with `limit`. Latest page `GET .../messages?limit=20`, older pages with `&before_id=<oldest shown id>` behind a "Load older messages" button, hidden once a page has fewer than 20 rows. Rendered as `[HH:MM] user: text` in local time. Own messages (not deleted) have `edit` (`window.prompt`, the only dialog in the app), `delete` (for me) and `delete for all`.
- **Mark read:** `POST /api/conversations/{id}/read` when a chat is opened or refreshed, and for every live message from someone else in the open chat.
- **New chat:** a `<select>` filled from `GET /api/users/` (refreshed, append-only, whenever the select gets focus). `POST /api/conversations/` is idempotent for an existing direct chat.

## Live updates (SSE contract, shared with backend)
1. `POST /api/events/ticket` with `Authorization: Bearer <jwt>` returns `{"ticket","expires_in":30}` (single use).
2. `new EventSource('/api/events?ticket=<t>')`. Only the opaque ticket goes in the URL, never the JWT. Frames are `event: <type>` + one-line JSON that includes `type`, the same payload the WebSocket sends. Handled types: `message`, `message_edited`, `message_deleted`. Pings are comments and invisible to JS.
3. **Reconnect:** EventSource's own reconnect is never used. On `error` the client closes the stream, waits 1 s, 2 s, 4 s ... capped at 30 s, mints a new ticket and reopens. `visibilitychange` and `online` retry immediately if the stream is down. There is no replay, so after **every** open (including the first) the client refetches the conversation list and the open chat's latest page. `live-status` only turns to `data-live="1"` after that resync. If the stream cannot be opened at all, the client still loads the data once over REST and shows `offline`.
4. **Normalisation:** SSE frames use `message_id`/`timestamp`, REST rows use `id`/`created_at`. Both go through `norm()` into `{id, cid, uid, user, ts, text, del, edited, file}`. Edit and delete frames are partial updates. Messages are de-duplicated by id, so the sender's REST response and SSE echo can arrive in either order.
5. **Races:** every message change (SSE frame or local REST result) is an event applied by `apply()` and kept in a short log. A REST response may predate events that arrived while it was in flight, so each load re-applies the events logged since it started (`since(n)`). Loads also drop their result if the session (`gen`) or the open chat (`cur`) changed meanwhile. Preserve both guards when touching `load*` functions.
6. **Acknowledgements are not events:** the REST result of my own send, edit or delete goes through `ack(e, n)`, which drops it if any event about the same message id arrived after the request started (`n = seq` taken just before the call). Otherwise a late acknowledgement could revert a newer edit or resurrect a message deleted in the meantime. Never call `ev()` directly with a REST result.

## Testing selectors (contract with qa)
All are `data-testid` values unless noted. Do not rename; add new ones instead.
- Auth: `login-form`, `login-username`, `login-password`, `remember-me`, `login-submit`, `show-register`; `register-form`, `register-username`, `register-email`, `register-password`, `register-submit`, `show-login`. `error` (role `alert`) shows any failure; `live-status` (role `status`) has `data-live` `0|1`; `logout`.
- List: `conversation-list`, rows `conversation-<id>` (with `data-unread`) containing `conversation-title` (an `<a href="#/c/<id>">`), `unread-count` (only when above 0) and `conversation-preview`; `new-chat-form`, `new-chat-user`, `start-chat`.
- Chat: `chat-title`, `back-to-list`, `load-older`, `message-list`, rows `message-<id>` (`data-id`, `data-own` `0|1`, `data-deleted` on tombstones) containing `message-meta`, `message-content`, `message-edited`, and for own messages `edit-message`, `delete-message`, `delete-everyone`; `composer`, `message-input`, `send-message`.
- Enter sends on fine-pointer devices (Shift+Enter inserts a newline). On touch devices use the Send button.

## Local development
No install step. Run a backend (see `backend/AGENTS.md`; frontend worktree ports are web 3001, api 8001) and then, from `frontend/`:
```
PORT=3001 API_PORT=8001 node dev-proxy.mjs
```
Open http://localhost:3001. The backend's `CORS_ORIGINS` is irrelevant because the page and `/api` share one origin through the proxy. Docker: `docker compose up -d --build` serves the same two files through nginx (see root `AGENTS.md`).

## Testing
Browser tests live in `tests/` (qa) and run against the disposable stack, never the real-data one: see `tests/e2e/README.md`. Quick manual checklist after a change: sign in as two users in two browsers, send/edit/delete both ways, kill the connection (offline in devtools) and confirm `live-status` returns to `live` and missed messages appear, check the gzip budget above.
