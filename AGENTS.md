# AGENTS.md

## Project Overview
zchat is a multi-platform chat application workspace consisting of:
- **frontend**: A React 18 web application built with Vite (`frontend/`).
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
- **Shared WebSocket event types**: `message`, `message_edited`, `message_deleted`, `messages_read`, `typing`, `user_online`, `user_offline`, `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`.

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
3. **Database variables**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (defaults: `postgres`/`postgres`/`zchat`).
4. **Optional** (have sensible defaults):
   - `CORS_ORIGINS` — comma-separated allowed origins (default: `http://localhost:3000,http://localhost:5173`)
   - `ACCESS_TOKEN_EXPIRE_MINUTES` — JWT TTL (default: 1440 = 24h)
   - `REMEMBER_ME_TOKEN_EXPIRE_DAYS` — extended session TTL (default: 30)
   - `MAX_MESSAGES_PER_CONVERSATION` — message pruning limit (default: 1000)
   - `WS_PING_INTERVAL_SEC` — WebSocket ping interval in seconds (default: 30)
   - `WS_PONG_TIMEOUT_SEC` — WebSocket pong timeout in seconds (default: 60)
   - `VITE_API_URL`, `VITE_WS_URL` — frontend build-time API base paths (default: `/api`, `/ws`)
   - `DEBUG` — backend debug mode (default: true)
   - `FRONTEND_PORT`, `FRONTEND_BIND` — published frontend port/bind address in Docker Compose (default: `3000`, `127.0.0.1`)
   - `EXTRA_CA_FILE` — root CA passed as a build secret for Docker builds behind TLS-intercepting proxies (e.g. Zscaler)

## General Setup & Execution
- **Docker (full stack):** `docker compose up -d --build`. Images are multi-stage and minimal: backend = static Go binary on distroless (non-root), frontend = built SPA on `nginx-unprivileged:alpine-slim` (container config: `frontend/docker/nginx.conf`; `frontend/nginx.conf` is the host-nginx config for `deployment.md`).
- **Frontend local dev:** `cd frontend && npm install && npm run dev` (or `./start.ps1` / `./start.sh`).
- **Backend local dev:** `cd backend && go run cmd/server/main.go` (or `./start.ps1` / `./start.sh`).
- **Shell Scripts**: `start.ps1` (Windows) and `start.sh` (Bash) are available in both `frontend/` and `backend/`.

## Deployment
See `deployment.md` for the full production Ubuntu/Nginx deployment guide (domain: `zchat.space`, SSL via Let's Encrypt/Certbot).

## Testing
- **Backend:** `cd backend && go test ./...` — uses testify mocks; currently only `auth_service_test.go` exists.
- **Frontend:** No test framework configured yet.

## Code Conventions (Global)
- Follow standard formatting and linting rules specific to each language (`gofmt`/`golangci-lint` for Go, ESLint for JS, `ktlint` for Kotlin).
- Ensure cross-platform compatibility where applicable (Windows PowerShell vs Bash).
- All REST endpoints live under the `/api` prefix.
- WebSocket events use a flat `{ "type": "...", ...fields }` JSON structure — keep this consistent across backend, frontend, and Android.

## Known Discrepancies
- **Frontend lockfile**: `frontend/package-lock.json` is gitignored, so Docker builds use `npm install` (not reproducible) instead of `npm ci`.
