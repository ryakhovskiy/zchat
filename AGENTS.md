# AGENTS.md

## Project Overview
zchat is a multi-platform chat application workspace consisting of:
- **frontend**: A React 18 web application built with Vite (`frontend/`).
- **backend_go**: A Go 1.24 REST API and WebSocket server with PostgreSQL (`backend_go/`).
- **android**: A native Android application built with Jetpack Compose (`android/`).

## Monorepo Architecture
This project utilizes nested `AGENTS.md` files for subproject-specific instructions. Coding agents should respect the nearest `AGENTS.md` file in the directory tree when generating code or executing commands.
- See `frontend/AGENTS.md` for Web UI tasks.
- See `backend_go/AGENTS.md` for API and WebSocket tasks.
- See `android/AGENTS.md` for Android mobile tasks.

## Architecture Overview
```
Frontend (React) ─┐                      ┌─ PostgreSQL
                   ├─ REST (/api) + WS ──► Go Backend ──►│
Android (Compose) ─┘                      └─ File Storage (uploads/)
```
- **Auth**: JWT tokens (HMAC-SHA256) with Bearer header. Frontend stores in localStorage/sessionStorage; Android stores in DataStore.
- **Message encryption**: AES-256-GCM at rest in PostgreSQL, decrypted on read. Legacy Fernet decryption supported for migration.
- **Real-time**: WebSocket hub-broadcast pattern. Clients connect to `/ws` with Bearer token auth.
- **Shared WebSocket event types**: `message`, `message_edited`, `message_deleted`, `messages_read`, `typing`, `user_online`, `user_offline`, `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`.

## Network Topology
| Service     | Dev Port | Production                         |
|-------------|----------|------------------------------------|
| Frontend    | 3000     | Nginx container → `zchat.space`    |
| Backend API | 8000     | Docker container, proxied via `/api` |
| WebSocket   | 8000     | Proxied via `/ws`                  |
| PostgreSQL  | 5432     | Docker container (internal)        |

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
   - `VITE_API_URL`, `VITE_WS_URL` — frontend build-time API base paths (default: `/api`, `/ws`)
   - `DEBUG` — backend debug mode (default: true)

## General Setup & Execution
- **Docker (backend + DB):** `docker-compose -f docker-compose.go.yml up -d` (frontend service is currently commented out; run frontend separately).
- **Frontend local dev:** `cd frontend && npm install && npm run dev` (or `./start.ps1` / `./start.sh`).
- **Backend local dev:** `cd backend_go && go run cmd/server/main.go` (or `./start.ps1` / `./start.sh`).
- **Android:** Open `android/` in Android Studio, or `cd android && gradlew.bat assembleDebug`.
- **Shell Scripts**: `start.ps1` (Windows) and `start.sh` (Bash) are available in both `frontend/` and `backend_go/`.

## Deployment
See `deployment.md` for the full production Ubuntu/Nginx deployment guide (domain: `zchat.space`, SSL via Let's Encrypt/Certbot).

## Testing
- **Backend:** `cd backend_go && go test ./...` — uses testify mocks; currently only `auth_service_test.go` exists.
- **Frontend:** No test framework configured yet.
- **Android:** `cd android && gradlew.bat testDebugUnitTest` and `gradlew.bat connectedAndroidTest`.

## Code Conventions (Global)
- Follow standard formatting and linting rules specific to each language (`gofmt`/`golangci-lint` for Go, ESLint for JS, `ktlint` for Kotlin).
- Ensure cross-platform compatibility where applicable (Windows PowerShell vs Bash).
- All REST endpoints live under the `/api` prefix.
- WebSocket events use a flat `{ "type": "...", ...fields }` JSON structure — keep this consistent across backend, frontend, and Android.

## Known Discrepancies
- **Frontend Docker**: The frontend service in `docker-compose.go.yml` is commented out — enable when deploying frontend via Docker.
- **Android feature parity**: File upload/download UI, message edit/delete actions, i18n, theme persistence, browser proxy, and typing indicators are not yet implemented on Android (see `android/AGENTS.md` for the full gap list).
