# AGENTS.md

## Project: zchat backend
A Go-based scalable REST API and WebSocket server interacting with a PostgreSQL database.

## Setup & Dev Scripts
- **Go Version:** Go 1.26.
- **Run local server directly:** `go run cmd/server/main.go`
- **Helper Scripts:** Use `./start.ps1` (Windows) or `./start.sh` (UNIX/Linux) to setup the environment and launch the backend server.
- **Docker build:** `docker build -t zchat-backend .` from `backend/` (multi-stage: static `CGO_ENABLED=0` binary on `distroless/static:nonroot`; behind Zscaler add `--secret id=extra_ca,src=<root-ca.crt>`), or `docker compose up -d --build` from root. In Compose the backend port is not published; it is reached only via the frontend nginx.
- **Formatting:** Ensure `gofmt` and `golangci-lint` (if installed) are passed on all Go code before committing.
- **Tests:** `go test ./...` — uses testify. Current test files:
  - `internal/config/config_test.go` — `MAX_USERS` parsing
  - `internal/httpserver/auth_handlers_test.go` — register handler when the user limit is reached
  - `internal/httpserver/upload_routes_test.go` — upload POST requires auth (401 for missing/invalid/wrong-key token, unknown or inactive user); download accepts `?token=` and Bearer using a stub `database/sql` driver
  - `internal/security/password_test.go` — argon2id hashing/verification, legacy bcrypt verification, `NeedsUpgrade`
  - `internal/service/auth_service_test.go` — `Register` and user-limit handling, using mock `domain.UserRepository`
  - `internal/store/postgres/user_repo_test.go` — user-limit enforcement in `Create`; needs a real PostgreSQL and is skipped unless `ZCHAT_TEST_DATABASE_URL` is set (each run uses its own schema and drops it afterwards)

## Tech Stack & Libraries
- **Routing:** `github.com/go-chi/chi/v5` handling RESTful API routing, protected by `cors` middleware.
- **Database:** PostgreSQL via `database/sql` with the `github.com/jackc/pgx/v5/stdlib` driver; repositories take a `*sql.DB` and use hand-written parameterized SQL.
- **Real-time Engine:** WebSockets managed using `github.com/gorilla/websocket` (see `internal/ws/`).
- **Security:** JWT (`golang-jwt/jwt/v5`) for auth tokens. Passwords hashed with argon2id and legacy bcrypt hashes verified via `golang.org/x/crypto`. Per-IP rate limiting via `go-chi/httprate`.
- **Encryption:** AES-256-GCM via SHA256-derived key (`internal/security/encrypt.go`). Legacy Fernet decryption for migration support.
- **Other utilities:** `google/uuid` for ID generation, `SherClockHolmes/webpush-go` for Web Push notifications, `swaggo/http-swagger` for API documentation.

## Code Patterns & Architecture
This application strictly follows Domain-Driven Design (DDD) principles split logically across the `internal/` folder:
- **`cmd/`:** Entrypoints (`server/main.go` — wiring, migrations, graceful shutdown).
- **`config/`:** Parsing environment variables mapping to `Config` struct.
- **`domain/`:** Abstract definitions: domain models (`models.go`), repository interfaces (`repository.go`), and sentinel errors (`errors.go`).
- **`httpserver/`:** REST routing and request/response serialization (the API layer). Features: `auth_handlers.go`, `conversation_handlers.go`, `message_handlers.go`, `user_handlers.go`, `push_handlers.go`, `upload_routes.go`, `auth_middleware.go`, `router.go`.
- **`service/`:** Core business logic (`auth_service.go`, `user_service.go`, `conversation_service.go`, `message_service.go`, `push_service.go`). Services receive repository interfaces from domain. Circular dependency between `ConversationService` and `MessageService` resolved via `SetMessageService()` post-construction.
- **`store/postgres/`:** Data Access Layer (DAL). Implementation of domain repository interfaces: `user_repo.go`, `conversation_repo.go`, `message_repo.go`, `participant_repo.go`, `reaction_repo.go`, `push_subscription_repo.go`, `db.go` (connection + migrations).
- **`ws/`:** WebSocket hub-and-client broadcast pattern (`hub.go`, `handler.go`).
- **`security/`:** Utilities for tokens (`token.go`), password hashing (`password.go`), message encryption (`encrypt.go`).
- **`docs/`:** Generated Swagger/OpenAPI files (`docs.go`, `swagger.json`, `swagger.yaml`), imported by the router. `app/` holds static app downloads (e.g. the Android APK) served under `/app/*`.

## Database Schema
Idempotent SQL migrations live in `store/postgres/db.go` (no external migration tool). **8 tables**:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Auth & status | `id`, `username`, `email`, `hashed_password`, `is_active`, `is_online`, `last_seen` |
| `conversations` | Direct or group chats | `id`, `name`, `is_group`, `updated_at` |
| `conversation_participants` | Membership + read tracking | `(user_id, conversation_id)` PK, `last_read_at` |
| `messages` | Chat content (encrypted at rest) | `id`, `content`, `conversation_id`, `sender_id`, `file_path`, `file_type`, `reply_to_id`, `is_deleted`, `is_edited`, `is_read` |
| `user_deleted_messages` | Per-user soft deletes ("delete for me") | `(user_id, message_id)` PK, cascades on message delete |
| `attachments` | Files attached to a message | `id`, `message_id` (cascades), `file_path`, `original_name`, `file_size`, `file_type`, `mime_type`, `read_count` |
| `push_subscriptions` | Web Push subscriptions | `id`, `user_id` (cascades), `endpoint`, `p256dh`, `auth`, `UNIQUE(user_id, endpoint)` |
| `message_reactions` | Emoji reactions | `id`, `message_id` (cascades), `user_id` (cascades), `emoji`, `UNIQUE(message_id, user_id, emoji)` |

Indexes on: `username`, `email`, `is_online`, `is_group`, `conversation_id`, `sender_id`, `created_at`, `updated_at`, participant FKs, `attachments.message_id`, `push_subscriptions.user_id`, `message_reactions.message_id`.

## API Routes
All REST routes live under the `/api` prefix. The WebSocket endpoint is at `/ws` (no prefix).

### Public Routes
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/` | inline | Health check (JSON version info) |
| GET | `/health` | inline | `{"status":"healthy"}` |
| GET | `/robots.txt` | inline | Disallow all |
| GET | `/docs/*` | swagger UI | OpenAPI documentation (registered only when `DEBUG=true`) |
| GET | `/app/*` | file server | Static app downloads from `app/` (directory listings return 404) |
| POST | `/api/auth/register` | `auth_handlers.go` | User registration (403 once `MAX_USERS` is reached) |
| POST | `/api/auth/login` | `auth_handlers.go` | Login (returns JWT) |
| GET | `/api/push/vapid-key` | `push_handlers.go` | VAPID public key for Web Push |

`/api/auth/register` and `/api/auth/login` are rate limited to 10 requests per minute per client IP and respond with `Cache-Control: no-store`.

### Protected Routes (AuthMiddleware required)
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/auth/logout` | `auth_handlers.go` | Logout |
| GET | `/api/auth/me` | `auth_handlers.go` | Current user info |
| GET | `/api/users/` | `user_handlers.go` | List all users |
| GET | `/api/users/online` | `user_handlers.go` | List online users |
| GET | `/api/users/{userID}` | `user_handlers.go` | Get user by ID |
| POST | `/api/conversations/` | `conversation_handlers.go` | Create conversation |
| GET | `/api/conversations/` | `conversation_handlers.go` | List conversations |
| GET | `/api/conversations/{conversationID}` | `conversation_handlers.go` | Get conversation |
| POST | `/api/conversations/{conversationID}/read` | `conversation_handlers.go` | Mark as read |
| GET | `/api/conversations/{conversationID}/messages` | `message_handlers.go` | List messages (optional `limit`, `before_id` for paging) |
| POST | `/api/conversations/{conversationID}/messages` | `message_handlers.go` | Send message |
| PUT | `/api/messages/{messageID}` | `message_handlers.go` | Edit message |
| DELETE | `/api/messages/{messageID}` | `message_handlers.go` | Delete (`delete_type` query param: `for_me`/`for_everyone`) |
| POST | `/api/push/subscribe` | `push_handlers.go` | Save a Web Push subscription |
| DELETE | `/api/push/unsubscribe` | `push_handlers.go` | Remove a Web Push subscription |

### Upload Routes
`/api/uploads` is mounted outside the shared `AuthMiddleware` group so downloads can use `?token=`; `UploadRoutes` applies `AuthMiddleware` to the upload POST itself.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/uploads/` | `upload_routes.go` | File upload. **Requires a Bearer token** for an existing, active user (same checks as `AuthMiddleware`; missing/invalid token → 401). Request body capped at 51 MiB; the 50 MiB `ParseMultipartForm` value is only the in-memory threshold, and there is no separate per-file size rejection |
| GET | `/api/uploads/{filename}` | `upload_routes.go` | Download. Validates the token itself (`?token=` param or Bearer header); only checks that the JWT parses, not that the user exists or is a participant |

### WebSocket
| Path | Auth | Description |
|------|------|-------------|
| GET | `/ws` | Bearer token via `Authorization` header or `Sec-WebSocket-Protocol: bearer, <token>` |

**Keep-alive & online-status TTL**: The server sends WebSocket **Ping** control frames every `WS_PING_INTERVAL_SEC` seconds. Clients must respond with a Pong (browsers and OkHttp do this automatically). Connections that fail to respond within `WS_PONG_TIMEOUT_SEC` are closed and the user is marked offline. On server startup, all `is_online` flags are reset to `false` to clear stale state from unclean shutdowns. A user is only broadcast as `user_offline` when **all** of their connections close (supports multiple tabs/devices per user).

### Middleware Stack (order)
`RequestID` → `RealIP` → `Logger` → `Recoverer` → `Timeout(60s)` → `CORS` → `AuthMiddleware` (protected routes only). The auth routes additionally use an `httprate` limiter and `no-store` headers.

## WebSocket Protocol
Flat JSON structure: `{ "type": "...", ...fields }`. All event types:

### Client → Server
| Type | Required Fields | Description |
|------|----------------|-------------|
| `message` | `conversation_id`, `content` (or `file_path`); optional `file_type`, `reply_to_id` | Send a message |
| `mark_read` | `conversation_id` | Mark all messages read |
| `typing` | `conversation_id` | Typing indicator (forwarded to other participants) |
| `edit_message` | `message_id`, `content` | Edit own message |
| `delete_message` | `message_id`, `delete_type` (`for_me`/`for_everyone`) | Delete message |
| `react_message` | `message_id`, `emoji` | Toggle an emoji reaction |
| `call_offer` | `target_user_id`, `conversation_id`, `sdp` | WebRTC offer |
| `call_answer` | `target_user_id`, `conversation_id`, `sdp` | WebRTC answer |
| `ice_candidate` | `target_user_id`, `conversation_id`, `candidate` | ICE candidate |
| `call_end` | `target_user_id`, `conversation_id` | End call |
| `call_rejected` | `target_user_id`, `conversation_id` | Reject call |

### Server → Client
| Type | Key Fields | Description |
|------|-----------|-------------|
| `message` | `message_id`, `conversation_id`, `content`, `sender_id`, `sender_username`, `timestamp`, `reply_to_id`, `is_deleted` | New message broadcast |
| `message_edited` | `message_id`, `conversation_id`, `content`, `is_edited` | Edited message broadcast |
| `message_deleted` | `message_id`, `conversation_id`, `delete_type` | Deleted message broadcast |
| `reaction_updated` | `message_id`, `conversation_id`, `reactions` | Updated reaction summary for a message |
| `messages_read` | `conversation_id`, `user_id` | Read receipt broadcast |
| `typing` | `conversation_id`, `user_id`, `username` | Typing indicator |
| `user_online` | `user_id`, `username` | User came online |
| `user_offline` | `user_id`, `username` | User went offline |
| `call_offer/answer/ice_candidate/call_end/call_rejected` | `sender_id`, `sender_username`, `conversation_id` | WebRTC signaling forwarded |
| `error` | `message` | Error response |

## Environment Variables
**Required** (backend fails to start without these):
- `JWT_SECRET` — secret key for JWT HMAC-SHA256 signing
- `ENCRYPTION_KEY` — message encryption key (SHA256-hashed to 32 bytes for AES-256-GCM)

**Optional** (with defaults):
| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_HOST` | `0.0.0.0` | Listen address |
| `HTTP_PORT` | `8000` | Listen port |
| `POSTGRES_HOST` | `localhost` | Database host |
| `POSTGRES_PORT` | `5432` | Database port |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | `postgres` | Database password |
| `POSTGRES_DB` | `zchat` | Database name |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT token TTL |
| `REMEMBER_ME_TOKEN_EXPIRE_DAYS` | `30` | Extended session TTL |
| `MAX_MESSAGES_PER_CONVERSATION` | `1000` | Message pruning limit per conversation |
| `UPLOAD_DIR` | `uploads` | File upload directory |
| `DEBUG` | `true` | Debug mode |
| `WS_PING_INTERVAL_SEC` | `30` | How often (seconds) the server sends WebSocket Ping frames |
| `WS_PONG_TIMEOUT_SEC` | `60` | Seconds to wait for a Pong before closing a stale connection |
| `ENCRYPTION_KEY_LEGACY` | _(empty)_ | Comma-separated legacy Fernet keys for migration |
| `MAX_USERS` | `10` | Maximum total user accounts (including inactive); must be a positive integer or startup fails. Registration beyond it returns 403 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | _(empty)_ | Web Push keys; push notifications are enabled only when both are set |
| `APP_NAME` | `zChat Go API` | Application name |
| `APP_ENV` | `development` | Environment label |

## Error Handling Conventions
- **Domain sentinel errors** (`domain/errors.go`): `ErrNotFound`, `ErrUnauthorized`, `ErrForbidden`, `ErrConflict`, `ErrUserLimitReached`, `ErrInternal`, `ErrInvalidInput`, `ErrDatabaseConnection`.
- **Service-layer errors**: custom errors in service package (e.g., `ErrForbidden`, `ErrMessageDeleted`) mapped to HTTP status codes in handlers.
- **Handler pattern**: check `errors.Is(err, domain.ErrNotFound)` → `404`, `domain.ErrForbidden` → `403`, etc.

## Security Implementation
| Component | Implementation |
|-----------|---------------|
| **JWT** | HMAC-SHA256, configurable TTL (default 24h, remember-me 30d) |
| **Passwords** | argon2id (m=19 MiB, t=2, p=1; at most 2 hashes computed concurrently). Legacy bcrypt hashes still verify and are re-hashed to argon2id on the next successful login |
| **Message encryption** | AES-256-GCM with SHA256-derived 32-byte key, base64-encoded ciphertext. Decrypt falls back to Fernet legacy keys, then raw content. Deleted messages are returned with empty `content` (never the stored ciphertext). |
| **File uploads** | Forbidden extension list (executables/scripts and browser-renderable markup such as `.html`/`.svg`), extension-based categorization, UUID-renamed files, 51 MiB request-body cap, always served with `Content-Disposition: attachment` |
| **Rate limiting** | `/api/auth/register` and `/api/auth/login`: 10 requests/minute per client IP (resolved by `RealIP`; trustworthy only because nginx is the sole ingress) |
| **CORS** | Whitelist by origin, credentials allowed |
| **WebSocket auth** | Bearer token via `Authorization` header or `Sec-WebSocket-Protocol`, origin check against `CORS_ORIGINS` (requests without an `Origin` header are rejected) |

## Coding Rules
- Do NOT use ORMs (like GORM) since the repositories use hand-written SQL on `database/sql` with the `pgx` stdlib driver.
- Ensure Swagger documentation boundaries are updated when HTTP routes are modified in the `httpserver` layer.
- Ensure dependency injection: passing repository interfaces matching the `domain` contracts to ease testing.
- Use sentinel errors from `domain/errors.go` for all error flows. Add new sentinel errors there if needed.
- Validate input at the service layer (username: lowercase `[a-z0-9_-]` 3–50 chars; password: 10+ chars with upper, lower, digit, special; message content: ≤5000 chars; reaction emoji: 1–8 characters; group conversations: ≤20 participants).
- Keep idempotent SQL migrations in `store/postgres/db.go`. No external migration tools.
- Follow the testify mock pattern in `auth_service_test.go` for new tests: create concrete mock structs implementing domain repository interfaces.
