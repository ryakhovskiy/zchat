# AGENTS.md

## Project Overview
zchat is a multi-platform chat application workspace consisting of:
- **frontend**: A mobile-first React 18 web application built with Vite (`frontend/`).
- **frontend-lite**: A companion text-only HTML/vanilla JavaScript client (`frontend-lite/`), with no application build step. `index.html` + `app.js` must total at most 8192 bytes gzipped at level 9.
- **backend**: A Go 1.26 REST API, WebSocket and Server-Sent Events (SSE) server with PostgreSQL (`backend/`). Both web clients share accounts, conversations and messages.

## Monorepo Architecture
This project utilizes nested `AGENTS.md` files for subproject-specific instructions. Coding agents should respect the nearest `AGENTS.md` file in the directory tree when generating code or executing commands.
- See `frontend/AGENTS.md` for Web UI tasks.
- See `frontend-lite/AGENTS.md` for the lite client and its separate test dependencies.
- See `backend/AGENTS.md` for API and WebSocket tasks.

## Architecture Overview
```
React frontend (frontend/) ───── REST (/api) + WS (/ws) ──┐
Lite frontend (frontend-lite/) ─ REST (/api) + SSE ────────┤
Android / other clients ──────── REST (/api) + WS (/ws) ──┤
                                                        Go backend ─ PostgreSQL
                                                                   └ uploads/
```
- **Auth**: JWT tokens (HMAC-SHA256) with Bearer header. Frontend stores in localStorage/sessionStorage; Android stores in DataStore.
- **Message encryption**: AES-256-GCM at rest in PostgreSQL, decrypted on read. Legacy Fernet decryption supported for migration.
- **Real-time**: WebSocket hub-broadcast pattern. Clients connect to `/ws` with Bearer token auth.
- **Shared WebSocket event types**: `message`, `message_edited`, `message_deleted`, `messages_read`, `typing`, `user_online`, `user_offline`, `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`, `react_message` (client → server), `reaction_updated` (server → client).
- **SSE authentication**: `POST /api/events/ticket` with Bearer auth returns a single-use 30-second ticket. `GET /api/events?ticket=...` streams only `message`, `message_edited` and `message_deleted`, with flat JSON matching WebSocket payloads, `retry: 5000` and a ping every 20 seconds. Never place JWTs in URLs. The lite client closes EventSource on failure, backs off, mints a fresh ticket and refetches conversations and the latest message page; there is no replay.
- **Lite scope**: Login/register, stay signed in (`remember_me`), conversations sorted by latest message with unread counts, direct-chat creation, text send/edit/delete and pagination (`limit=20`, `before_id`), hash navigation (`#/c/1`). Render server text with `textContent`. No groups, attachments, reactions, presence UI, receipts, typing, calls, push, themes, i18n, PWA, offline cache or send queue. Backend features remain available to the full and other clients.
- **Frontend themes**: `light`, `dark`, `tech-green`, `tech-red`, defined as token sets in `frontend/src/styles/themes.css`. The first visit follows the OS color scheme; preferences use localStorage key `zchat-theme`, with legacy `hacker` migrated to `tech-green`.
- **Settings and theme initialization**: The Settings gear opens a desktop popover or phone bottom sheet with a theme radiogroup, EN/DE/RU language control and separate logout action. `frontend/public/theme-init.js` runs synchronously from the HTML head before React mounts and updates `theme-color`.
- **PWA**: `frontend/public/manifest.webmanifest` and `frontend/public/icons/` support standalone installation. `frontend/public/sw.js` handles push notifications; there is no offline cache or offline send queue. The embedded WebBrowser has been removed.

## Network Topology
| Service     | Dev Port | Docker Compose                                              |
|-------------|----------|-------------------------------------------------------------|
| Frontend    | 3000     | nginx container, published port (`127.0.0.1:${FRONTEND_PORT:-3000}` → 8080); cloudflared tunnels to it |
| Lite frontend | 3100 | Optional companion nginx, `${FRONTEND_LITE_BIND:-${FRONTEND_BIND:-127.0.0.1}}:${FRONTEND_LITE_PORT:-3100}` → 8080 |
| E2E React / lite | 38080 / 38081 | Disposable `zchat-e2e`, loopback only; separate named data volumes |
| Backend API | 8000     | Not published; both nginx frontends proxy `/api` and `/app` over the `web` network |
| SSE events | 8000 | Lite nginx exact `/api/events` proxy, unbuffered/uncompressed with one-hour read timeout; ticket access logging disabled |
| WebSocket   | 8000     | Not published; proxied via `/ws`                            |
| PostgreSQL  | 5432     | Not published; `db` network (internal, backend only)        |

Lite uses same-origin `/api` and needs a proxy-capable server; a plain static file server alone cannot proxy API requests.

Dev proxy: React frontend Vite config proxies `/api` → `http://localhost:8000` and `/ws` → `ws://localhost:8000`.

## Environment Setup
1. Copy `.env.example` to `.env` at the project root.
2. **Required variables** (backend will fail to start without these):
   - `JWT_SECRET` — secret key for JWT signing
   - `ENCRYPTION_KEY` — message encryption key (hashed to 32 bytes for AES-256-GCM)
3. **Database variables**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (backend defaults: `postgres`/`postgres`/`zchat`; Compose reads these from `.env`).
4. **Optional** (have sensible defaults):
   - `CORS_ORIGINS` — comma-separated allowed origins (default: `http://localhost:3000,http://localhost:5173`)
   - `ACCESS_TOKEN_EXPIRE_MINUTES` — JWT TTL (default: 1440 = 24h)
   - `REMEMBER_ME_TOKEN_EXPIRE_DAYS` — extended session TTL (default: 30)
   - `MAX_MESSAGES_PER_CONVERSATION` — message pruning limit (default: 1000)
   - `MAX_USERS` — registration limit (default: 10); must be a positive integer, registration returns 403 when reached
   - `WS_PING_INTERVAL_SEC` — WebSocket ping interval in seconds (default: 30)
   - `WS_PONG_TIMEOUT_SEC` — WebSocket pong timeout in seconds (default: 60)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — Web Push is enabled when both are set; `VITE_VAPID_PUBLIC_KEY` is an optional frontend build-time key
   - `DEBUG` — backend debug mode and Swagger `/docs` availability (default: true for direct execution, false in Compose)
   - `APP_NAME`, `APP_ENV` — backend application metadata (defaults: `zChat Go API`, `development`)
   - `UPLOAD_DIR` — backend upload directory (default: `uploads`; fixed to `/app/uploads` in Compose)
   - `ENCRYPTION_KEY_LEGACY` — comma-separated legacy Fernet keys (default: empty)
   - `FRONTEND_PORT`, `FRONTEND_BIND` — published frontend port/bind address in Docker Compose (default: `3000`, `127.0.0.1`)
   - `FRONTEND_LITE_PORT`, `FRONTEND_LITE_BIND` — dual deployment companion port/bind (defaults: `3100`, falling back to `FRONTEND_BIND` then `127.0.0.1`)
   - `POSTGRES_DATA_DIR` — required database bind source for the dual overlay; use an absolute path from a worktree
   - `EXTRA_CA_FILE` — root CA passed as a build secret for Docker builds behind TLS-intercepting proxies (e.g. Zscaler)
5. **Local frontend variables**: Copy `frontend/.env.example` to `frontend/.env` for direct backend URLs (`VITE_API_URL=http://localhost:8000/api`, `VITE_WS_URL=ws://localhost:8000/ws`), or set `VITE_API_URL=/api` and `VITE_WS_URL=/ws` in that file or the process environment to use the Vite dev proxy. Local Vite loads environment files from `frontend/`, not the root `.env`; the frontend helper scripts do not create this file. The `/api` and `/ws` defaults are provided only by Dockerfile/Compose image builds.

`WS_PING_INTERVAL_SEC`, `WS_PONG_TIMEOUT_SEC`, `APP_NAME`, `APP_ENV` and `ENCRYPTION_KEY_LEGACY` are direct backend environment settings; the root Compose file does not forward them.

## General Setup & Execution
- **Docker (full stack):** `docker compose up -d --build`. Images are multi-stage and minimal: backend = static Go binary on distroless (non-root), frontend = built SPA on `nginx-unprivileged:alpine-slim` (container config: `frontend/docker/nginx.conf`; `frontend/nginx.conf` is a separate host-nginx config).
- **Frontend local dev:** Prepare `frontend/.env` or export the two `VITE_*` variables above, then `cd frontend && npm install && npm run dev` (or use `./start.ps1` / `bash ./start.sh` from `frontend/` with the same environment).
- **Backend local dev:** Export the backend environment variables before `cd backend && go run cmd/server/main.go`; the backend does not load the root `.env` itself. Alternatively use `./start.ps1` / `bash ./start.sh` from `backend/`, which supply development-only default secrets when unset.
- **Shell Scripts**: `start.ps1` (Windows) and `start.sh` (Bash) are available in both `frontend/` and `backend/`.

## Deployment
Container deployment uses `docker-compose.yml` and `frontend/docker/nginx.conf`, with TLS terminated upstream. Set `CORS_ORIGINS` to include the public frontend URL.

## Dual deployment
`docker-compose.yml` keeps the full React deployment. Add `docker-compose.dual.yml` to run lite alongside it, with exactly one backend and PostgreSQL service:

```bash
export POSTGRES_DATA_DIR=/absolute/path/to/existing/postgres-data
docker compose -p zchat --env-file .env -f docker-compose.yml -f docker-compose.dual.yml config --quiet
./dual.sh ps
./dual.sh up
./dual.sh down
```

The overlay pins project `zchat`, which selects the existing `zchat_go_uploads` volume. It requires `POSTGRES_DATA_DIR` and replaces the base PostgreSQL bind mount by container target. Compose normally derives the project name from the directory and resolves relative bind paths from the compose file: running from another checkout can silently select a fresh database and uploads volume. Always use the existing database's absolute path. `dual.sh` explicitly forces project `zchat`, even if `COMPOSE_PROJECT_NAME` is inherited, and prints the selected project, data directory, cluster status and ports before acting. It parses the local PostgreSQL image's effective `PGDATA` and requires a nonempty `PG_VERSION` at that exact location for `up`. If the image is not cached, pull the configured PostgreSQL image first. `ps`/`down` report cluster status as unknown without reading image metadata. An empty or missing data directory requires the deliberate `./dual.sh up --new-database` opt-in; a nonempty path without the expected cluster is refused. `up` always rebuilds; `down` retains volumes. `DUAL_ENV_FILE` selects another env file.

Keep the existing PostgreSQL image/major compatible with the data directory; the base image remains unpinned. The default full/lite ports are 3000/3100, with TLS terminated upstream. A public lite hostname requires its own manual tunnel mapping to port 3100. Include public WebSocket origins in `CORS_ORIGINS`; lite HTTP/SSE requests use their same-origin nginx proxy.

Cutover is an operator action: stop writers, take a cold backup of the existing database and preserve its uploads volume; stop any deployment occupying the chosen ports without deleting its volumes; then start the overlay with the existing project's database path and verify one real account and cross-client messages on both ports. Data created under another Compose project remains separate and must be deliberately retained/exported. For rollback, stop the dual deployment with the same project and two compose files (no `-v`), then rebuild the previous full-only checkout with its original project, env file and data bind. There are no schema changes in the dual deployment. Remote image publication and server cutover are separate operations.

Known gaps: lite sends over REST and does not trigger web-push. An open SSE session counts as online and suppresses push to that user. Login/register share a 10-requests/minute per-IP limit across both frontends. Lite's intentionally limited feature scope is listed above.

Production data is outside the test lifecycle. Projects `zchat` and `zchat-lite` can hold independent real accounts, uploads and PostgreSQL directories. Never target either project, ports 3000/3100 or a real database directory for verification. Keep env files and secrets out of logs and version control.

## Testing
- **Backend:** `cd backend && go test ./...` — tests cover `internal/config`, `httpserver`, `security`, `service` and `store/postgres`. The PostgreSQL integration test skips unless `ZCHAT_TEST_DATABASE_URL` points to a disposable database; it creates and drops its own schema.
- **Disposable dual stack:** Docker Compose and Python 3 are required. Run `bash e2e/run.sh up`, `bash e2e/run.sh seed`, then `bash e2e/run.sh verify`. Default project `zchat-e2e` publishes React at `127.0.0.1:38080` and lite at `127.0.0.1:38081`, with one shared test backend/database and its own named volumes. The helper always supplies `-p` and its generated env file; it never loads root `.env`. `up` rebuilds; `down` retains data; `reset` deletes only the selected project's test volumes, rebuilds and reseeds. Coordinate lifecycle changes with active test runs.
- **Target selection:** Override `E2E_PROJECT`, `E2E_PORT` and `E2E_LITE_PORT` together for another disposable dual stack. Both ports must be unprivileged, distinct and neither 3000 nor 3100. Projects `zchat`, `zchat-lite` and retired `zchat-lite-e2e` are rejected. Never test against real accounts or data. Default ignored state lives in `e2e/.env`; other projects use `e2e/.state/<project>/`. The helper generates credentials without reading root `.env`.
- **Fixtures and environment:** `eval "$(bash e2e/run.sh env)"` exports the chosen project/ports, full `E2E_BASE_URL`, `E2E_LITE_URL`, generated Alice/Bob credentials, peer and `E2E_EXPECT_BUNDLE=1`. Fixtures include Alice/Bob/Carol, the fixture-only `alice_ui_qa` peer, direct/group/scratch conversations, at least 60 text messages and an authenticated PNG among the latest 15. The E2E user cap is 50. `EXTRA_CA_FILE` supports proxy CA builds.
- **HTTP verification:** Checks React entry points, theme initialization, hashed assets and PWA files; lite source equality, ETag/304/no-cache, security headers, 404s, gzip and the 8 KiB budget; single-use SSE tickets, immediate uncompressed frames and four pings beyond 60 seconds. It verifies both published listeners' container/image/volume ownership before testing cross-port registration/login and bearer reuse. Requires seeded accounts; takes about 80 seconds. Reports go to the selected ignored state directory.
- **React browser tests:** `cd frontend && npm run test:e2e`; see `frontend/tests/e2e/README.md` for browser prerequisites and reports. Coverage includes four themes, seven viewports, theme bootstrap, sign-in, accessibility, input/composer races and message regressions. `node scripts/check-contrast.mjs` separately checks semantic token contrast.
- **Lite browser tests:** Follow `frontend-lite/tests/e2e/README.md`. Test dependencies are separate from application runtime. Coverage includes auth, direct chats, edit/delete, pagination/reconnect, accessibility, payload budget, a throttled 50 kbps/500 ms run and React WS/lite SSE interoperability. CI checks `node --check frontend-lite/app.js`, gzip budget and dual Compose topology with dummy settings.
- **Overlay smoke test:** Use only explicit `DUAL_TEST_PROJECT=zchat-dualtest`, a separate `DUAL_ENV_FILE`, `POSTGRES_DATA_DIR` under `/tmp`, and loopback ports 38090/38091. This opt-in rejects other test project names, data locations and ports. Test an empty-data refusal, deliberately initialize a new disposable database, verify both frontends share an account, then tear down only project `zchat-dualtest` with its explicit env/compose files. Remove only that project's test volumes and temporary data.

## Code Conventions (Global)
- Follow standard formatting and linting rules specific to each language (`gofmt`/`golangci-lint` for Go, ESLint for JS, `ktlint` for Kotlin).
- Ensure cross-platform compatibility where applicable (Windows PowerShell vs Bash).
- All REST endpoints live under the `/api` prefix.
- WebSocket events use a flat `{ "type": "...", ...fields }` JSON structure — keep this consistent across backend, frontend, and Android.

## Known Discrepancies
- **Frontend lockfile**: `frontend/package-lock.json` is gitignored. The Dockerfile uses `npm ci` when a local lockfile is present and `npm install` otherwise, so clean checkouts still lack locked dependency reproducibility.
