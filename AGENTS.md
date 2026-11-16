# AGENTS.md

## Project Overview
zchat is a multi-platform chat workspace:
- **frontend**: A text-only browser client, `frontend/index.html` and `frontend/app.js`, using standard HTML controls and vanilla JavaScript. No framework, bundler or application build step. The two files together must stay within 8192 bytes gzipped at level 9.
- **backend**: A Go 1.26 REST API, Server-Sent Events (SSE) and WebSocket server with PostgreSQL (`backend/`). WebSocket support remains available for Android and other clients.

## Monorepo Architecture
Respect the nearest `AGENTS.md` when changing a subproject:
- `frontend/AGENTS.md` describes the browser client and its tests.
- `backend/AGENTS.md` describes the API and real-time contracts.

```text
Browser: index.html + app.js ─ REST (/api) + SSE (/api/events) ─┐
Android / other clients ────── REST (/api) + WS (/ws) ─────────┤
                                                            Go backend ─ PostgreSQL
                                                                       └ uploads/
```

- **Auth**: REST uses HMAC-SHA256 JWTs in the Bearer header. The browser uses sessionStorage, or localStorage when "stay signed in" is selected (`remember_me`). Login and registration are limited to 10 requests per minute per IP.
- **SSE auth**: `POST /api/events/ticket` with Bearer auth returns a single-use ticket with a 30-second TTL. `GET /api/events?ticket=...` streams only `message`, `message_edited` and `message_deleted`, with `retry: 5000` and a ping every 20 seconds. Never put a JWT in the URL. On failure, the client closes EventSource, backs off, obtains a new ticket and refetches the conversation list and latest message page; there is no replay.
- **Messages**: REST writes broadcast through the shared hub to WS/SSE subscribers. Payloads are flat `{ "type": "...", ...fields }` JSON; SSE uses the same payload and names the event with its type. Keep Android compatibility.
- **Encryption**: Messages use AES-256-GCM at rest, decrypted on read. Legacy Fernet decryption remains supported for migration.
- **Browser scope**: Login/register, conversations with unread counts sorted by latest message, direct-chat creation, paginated messages (`limit=20` plus `before_id`), send/edit/delete text. Server text must use `textContent`. Navigation uses hashes such as `#/c/1`.
- **Browser exclusions**: Groups, attachments, reactions, presence, receipts, typing, calls, push, themes, i18n and PWA are absent from this client. Backend features for other clients remain available. There is no offline cache or send queue.

## Network Topology

| Service | Container port | Published access |
|---------|----------------|------------------|
| Static frontend/nginx | 8080 | Only published service: `${FRONTEND_BIND:-127.0.0.1}:${FRONTEND_PORT:-3000}` |
| REST API and SSE | 8000 | Internal `web` network; nginx proxies `/api/`, with an exact unbuffered `/api/events` location |
| WebSocket | 8000 | nginx proxies `/ws` |
| App downloads | 8000 | nginx proxies `/app/` |
| PostgreSQL | 5432 | Internal `db` network, backend only; unpublished |

The static client uses same-origin `/api` URLs. There is no Vite development proxy and no `VITE_*` configuration. Serving the HTML with a plain file server alone does not proxy API requests.

### Workspace and data isolation
- The `zchat` stack on `127.0.0.1:3000` contains real accounts, messages and uploads. Never test against it, rebuild/stop it or touch `postgres-data` without explicit authorization.
- The original disposable `zchat-e2e` stack on `127.0.0.1:38080` belongs to the original-client QA run. Leave it untouched during lite work.
- Lite integration uses **`E2E_PROJECT=zchat-lite-e2e E2E_PORT=38081`**, from `/home/kr/projects/zchat-lite`, on branch **`feature/lite-sse-client`**. Never switch this checkout to `main`, push or open a PR during worker tasks. QA owns this stack's lifecycle; coordinate rebuilds with QA.
- If running separate development servers, reserve frontend worktree web/API 3001/8001, backend worktree 3002/8002, and lite integration 3003/8003. Set backend `HTTP_PORT` and include the frontend origin in `CORS_ORIGINS`; arrange a same-origin reverse proxy for the static client. Each backend needs its own disposable PostgreSQL. Host port 5432 is already occupied; never assume it is a test database.

## Environment Setup
1. Copy root `.env.example` to `.env` for root Compose. Never print or commit `.env` files or real secrets. The E2E helper generates its own credentials and never reads root `.env`.
2. Required backend settings:
   - `JWT_SECRET` — JWT signing secret.
   - `ENCRYPTION_KEY` — hashed to 32 bytes for message encryption.
3. Database: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (direct-backend defaults: localhost/5432/postgres/postgres/zchat). Compose supplies host `postgres`, port 5432, and the root `.env` credentials.
4. Optional settings:
   - `CORS_ORIGINS` — comma-separated browser origins, including the public frontend URL (backend default: `http://localhost:3000,http://localhost:5173`).
   - `ACCESS_TOKEN_EXPIRE_MINUTES` — JWT TTL, default 1440.
   - `REMEMBER_ME_TOKEN_EXPIRE_DAYS` — extended session TTL, default 30.
   - `MAX_MESSAGES_PER_CONVERSATION` — pruning limit, default 1000.
   - `MAX_USERS` — positive registration limit, default 10; registration returns 403 at the limit.
   - `HTTP_HOST`, `HTTP_PORT` — direct backend listener (Compose fixes these to `0.0.0.0:8000`).
   - `WS_PING_INTERVAL_SEC`, `WS_PONG_TIMEOUT_SEC` — defaults 30 and 60.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — optional backend push keys for other clients; the lite browser does not use push.
   - `DEBUG` — direct backend defaults to true, Compose defaults to false; enables Swagger `/docs`.
   - `APP_NAME`, `APP_ENV` — defaults `zChat Go API`, `development`.
   - `UPLOAD_DIR` — default `uploads`, fixed to `/app/uploads` in Compose.
   - `ENCRYPTION_KEY_LEGACY` — comma-separated legacy Fernet keys, default empty.
   - `FRONTEND_PORT`, `FRONTEND_BIND` — root Compose frontend listener, defaults 3000/127.0.0.1.
   - `EXTRA_CA_FILE` — optional build-secret root CA for backend dependency downloads behind a TLS-intercepting proxy. Static frontend images install no dependencies.

`WS_PING_INTERVAL_SEC`, `WS_PONG_TIMEOUT_SEC`, `APP_NAME`, `APP_ENV` and `ENCRYPTION_KEY_LEGACY` are direct backend settings; root Compose does not forward them. The browser needs no `.env` or build arguments.

## General Setup and Deployment
- **Full stack**: Root `docker-compose.yml` is the real-data deployment configuration; its deployment command is `docker compose up -d --build`. Agents must use the isolated E2E stack for verification instead. Backend is a static Go binary on distroless, non-root. Frontend directly copies two files onto pinned `nginx-unprivileged:alpine-slim`, non-root on 8080.
- **Backend local dev**: Export process environment before `cd backend && go run cmd/server/main.go`. Backend does not load root `.env`. `backend/start.sh` and `start.ps1` provide development-only default secrets when unset.
- **Static serving**: `frontend/docker/nginx.conf` serves `/`, `/index.html` and `/app.js` with ETag and `Cache-Control: no-cache`; all other static paths return 404. HTML, JS and JSON use gzip above 256 bytes. SSE is neither gzipped nor buffered, has a one-hour proxy read timeout and disables access logging to protect tickets. Location-level proxy header overrides must repeat all client-IP/scheme headers. Keep security headers at server level so all locations inherit them.
- TLS terminates upstream (for example cloudflared). Set `CORS_ORIGINS` for the public frontend URL. `/api/`, `/ws` and `/app/` remain proxied. `frontend/nginx.conf` is a separate legacy host-nginx configuration, not used by the container.

## Testing
- **Backend**: `cd backend && go test ./...`. PostgreSQL integration skips unless `ZCHAT_TEST_DATABASE_URL` points at a disposable database; tests create/drop their own schema. Run `gofmt -l .` and `go vet ./...` for backend changes.
- **Lite stack**: Docker Compose and Python 3 are required. From the repo root, first `export E2E_PROJECT=zchat-lite-e2e E2E_PORT=38081`, then `bash e2e/run.sh up`, `bash e2e/run.sh seed`, and `bash e2e/run.sh verify`. Do not build until the frontend/backend integration merges are confirmed. `up` rebuilds; coordinate with QA before any lifecycle action. `down` retains volumes; `reset` deletes only the selected project's test volumes and rebuilds/reseeds.
- **Target selection**: E2E tools default to project `zchat-e2e`, port 38080 for compatibility. Lite workers must always set the explicit lite target above. Image tags, network/volume names and container ownership checks follow `E2E_PROJECT`; port bindings and CORS follow `E2E_PORT`. Real-data project `zchat` and port 3000 are rejected.
- **State**: Default E2E state stays in ignored `e2e/.env`; other projects use ignored `e2e/.state/<project>/`. Generated credentials, seed results and verification reports are isolated by project. `eval "$(bash e2e/run.sh env)"` exports the selected project/port, base URL, Alice/Bob usernames and passwords. It never reads root `.env`.
- **Fixtures**: Alice/Bob/Carol plus fixture-only `alice_ui_qa`; Alice/Bob direct chat has at least 60 text messages and a tiny PNG upload among the latest 15 messages. The PNG lives in `e2e/fixtures/`, independent of client assets. The fixture-only peer initially has no direct chat with Alice. Group/scratch and authenticated upload fixtures remain for API regression tests. The E2E user cap is 50.
- **HTTP checks**: `verify` checks source equality for both files, gzip and the 8 KiB budget, ETag/304/no-cache, security headers, 404s, compressed JSON, backend network health, container/image/volume ownership, single-use SSE tickets, immediate uncompressed frames and pings beyond 60 seconds. It requires seeded credentials and takes about 80 seconds.
- **Browser tests**: Follow `frontend/tests/e2e/README.md` for Playwright setup and invocation. Lite coverage includes auth, direct chat, live messages, edit/delete, pagination/reconnect, accessibility, payload budget and a throttled 50 kbps/500 ms run. QA also verifies WS/SSE interoperability. Browser testing dependencies are separate from the static application runtime.

## Code Conventions
- Use `gofmt` and applicable language linting; preserve cross-platform compatibility for scripts.
- REST lives under `/api`; shared real-time payloads stay flat and compatible across browser/backend/Android.
- Stage only your own files in shared checkouts. Never discard other workers' changes.
