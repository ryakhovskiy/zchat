# AGENTS.md

## Project Overview
zchat is a multi-platform chat application workspace consisting of:
- **frontend**: A mobile-first React 18 web application built with Vite (`frontend/`).
- **backend**: A Go 1.26 REST API and WebSocket server with PostgreSQL (`backend/`).

## Monorepo Architecture
This project utilizes nested `AGENTS.md` files for subproject-specific instructions. Coding agents should respect the nearest `AGENTS.md` file in the directory tree when generating code or executing commands.
- See `frontend/AGENTS.md` for Web UI tasks.
- See `backend/AGENTS.md` for API and WebSocket tasks.

## Architecture Overview
```
Frontend (React) ─┐                      ┌─ PostgreSQL
                  └─ REST (/api) + WS ──► Go Backend ──►│
                                        └─ File Storage (uploads/)
```
- **Auth**: JWT tokens (HMAC-SHA256) with Bearer header. Frontend stores in localStorage/sessionStorage; Android stores in DataStore.
- **Message encryption**: AES-256-GCM at rest in PostgreSQL, decrypted on read. Legacy Fernet decryption supported for migration.
- **Real-time**: WebSocket hub-broadcast pattern. Clients connect to `/ws` with Bearer token auth.
- **Shared WebSocket event types**: `message`, `message_edited`, `message_deleted`, `messages_read`, `typing`, `user_online`, `user_offline`, `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`, `react_message` (client → server), `reaction_updated` (server → client).
- **Frontend themes**: `light`, `dark`, `tech-green`, `tech-red`, defined as token sets in `frontend/src/styles/themes.css`. The first visit follows the OS color scheme; preferences use localStorage key `zchat-theme`, with legacy `hacker` migrated to `tech-green`.
- **Settings and theme initialization**: The Settings gear opens a desktop popover or phone bottom sheet with a theme radiogroup, EN/DE/RU language control and separate logout action. `frontend/public/theme-init.js` runs synchronously from the HTML head before React mounts and updates `theme-color`.
- **PWA**: `frontend/public/manifest.webmanifest` and `frontend/public/icons/` support standalone installation. `frontend/public/sw.js` handles push notifications; there is no offline cache or offline send queue. The embedded WebBrowser has been removed.

## Network Topology
| Service     | Dev Port | Docker Compose                                              |
|-------------|----------|-------------------------------------------------------------|
| Frontend    | 3000     | nginx container, only published port (`127.0.0.1:${FRONTEND_PORT:-3000}` → 8080); cloudflared tunnels to it |
| Backend API | 8000     | Not published; frontend nginx proxies `/api` and `/app` over the `web` network |
| WebSocket   | 8000     | Not published; proxied via `/ws`                            |
| PostgreSQL  | 5432     | Not published; `db` network (internal, backend only)        |

Dev proxy: frontend Vite config proxies `/api` → `http://localhost:8000` and `/ws` → `ws://localhost:8000`.

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

## Testing
- **Backend:** `cd backend && go test ./...` — tests cover `internal/config`, `httpserver`, `security`, `service` and `store/postgres`. The PostgreSQL integration test skips unless `ZCHAT_TEST_DATABASE_URL` points to a disposable database; it creates and drops its own schema.
- **Frontend:** `cd frontend && npm run test:e2e` — Playwright and axe tests in `frontend/tests/e2e/` cover four themes, seven viewports, theme bootstrap, sign-in, keyboard/focus, pointer input, composer races and message regressions. Provision a separate disposable stack and set `E2E_BASE_URL` to its loopback URL (for example, `http://127.0.0.1:38080`); the checkout does not include a dedicated e2e stack. Seed a user/password (`E2E_USERNAME`/`E2E_PASSWORD`), a direct-chat peer (`E2E_PEER`), direct/group conversations, text messages and a served image attachment. Group regressions use a second, fixture-only peer named `<E2E_USERNAME>_qa`; `setup.js` creates it if absent, so registration capacity must be available. `E2E_EXPECT_BUNDLE=1` adds production bundle checks. Never target a stack containing real data. See `frontend/tests/e2e/README.md` for browser prerequisites and reports. `cd frontend && node scripts/check-contrast.mjs` separately checks semantic token contrast.

## Code Conventions (Global)
- Follow standard formatting and linting rules specific to each language (`gofmt`/`golangci-lint` for Go, ESLint for JS, `ktlint` for Kotlin).
- Ensure cross-platform compatibility where applicable (Windows PowerShell vs Bash).
- All REST endpoints live under the `/api` prefix.
- WebSocket events use a flat `{ "type": "...", ...fields }` JSON structure — keep this consistent across backend, frontend, and Android.

## Known Discrepancies
- **Frontend lockfile**: `frontend/package-lock.json` is gitignored. The Dockerfile uses `npm ci` when a local lockfile is present and `npm install` otherwise, so clean checkouts still lack locked dependency reproducibility.
