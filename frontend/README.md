# zChat frontend (lite client)

A minimal chat client for very slow connections: one HTML file and one JavaScript file, about 6.5 KB gzipped together. No framework, no build step, no dependencies. Live updates use Server-Sent Events. Agent and contributor conventions live in [AGENTS.md](AGENTS.md).

## What it does
Sign in or register, see your conversations with unread counts, read and load older messages, send text, edit your own messages, delete a message for yourself or for everyone, and start a direct chat with any user. Messages from other people appear live.

Not included: groups (you can read existing ones), files and images, reactions, presence, read receipts, typing indicators, calls, push notifications, themes, translations and offline support. The Android app keeps using the WebSocket API.

## Files
- `index.html` - all views, a few lines of inline CSS, system fonts, light/dark from the OS
- `app.js` - the client
- `dev-proxy.mjs` - optional dev server (Node, no dependencies)

The size budget is 8 KB gzipped for `index.html` + `app.js` together and nothing else is loaded:
```bash
echo $(( $(gzip -9 < index.html | wc -c) + $(gzip -9 < app.js | wc -c) ))
```

## Run it locally
1. Start the backend on port 8001 (see `backend/AGENTS.md` for the environment it needs).
2. From this folder:
```bash
PORT=3001 API_PORT=8001 node dev-proxy.mjs
```
3. Open http://localhost:3001.

The proxy serves the two files and forwards `/api` (including the event stream) to the backend, so the page and the API share one origin. With Docker, `docker compose up -d --build` from the repository root serves the same files through nginx on port 3000.

## How live updates work
After signing in the client asks `POST /api/events/ticket` for a single-use ticket and opens `EventSource('/api/events?ticket=...')`. The server pushes `message`, `message_edited` and `message_deleted` events. If the stream drops, the client waits (1 s, 2 s, 4 s, up to 30 s), gets a new ticket, reconnects and reloads the conversation list and the open chat, because the server does not replay missed events. The "live" / "offline" indicator in the header shows the state.

## Tests
Playwright and axe tests are in `tests/` (maintained by QA) and run against a disposable stack. See `tests/e2e/README.md`.
