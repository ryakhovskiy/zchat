# AGENTS.md

## Project: zchat backend_go
A Go-based scalable REST API and WebSocket server interacting with a PostgreSQL database.

## Setup & Dev Scripts
- **Go Version:** Go 1.24.
- **Run local server directly:** `go run cmd/server/main.go`
- **Helper Scripts:** Use `./start.ps1` (Windows) or `./start.sh` (UNIX/Linux) to setup the environment and launch the backend server.
- **Docker build:** `docker build -t zchat-backend .` from `backend_go/`, or use `docker-compose -f docker-compose.go.yml up -d` from root.
- **Formatting:** Ensure `gofmt` and `golangci-lint` (if installed) are passed on all Go code before committing.
- **Tests:** `go test ./...` — uses testify with mock implementations of domain interfaces. Currently only `auth_service_test.go` exists (covers `Register`).

## Tech Stack & Libraries
- **Routing:** `github.com/go-chi/chi/v5` handling RESTful API routing, protected by `cors` middleware.
- **Database:** PostgreSQL accessed directly via `github.com/jackc/pgx/v5` for high-performance operations.
- **Real-time Engine:** WebSockets managed using `github.com/gorilla/websocket` (see `internal/ws/`).
- **Security:** JWT (`golang-jwt/jwt/v5`) for auth tokens. Passwords hashed/verified via `golang.org/x/crypto` (bcrypt).
- **Encryption:** AES-256-GCM via SHA256-derived key (`internal/security/encrypt.go`). Legacy Fernet decryption for migration support.
- **Other utilities:** `google/uuid` for ID generation, `playwright-go` for browser proxy, `swaggo/http-swagger` for API documentation.

## Code Patterns & Architecture
This application strictly follows Domain-Driven Design (DDD) principles split logically across the `internal/` folder:
- **`cmd/`:** Entrypoints (`server/main.go` — wiring, migrations, graceful shutdown).
- **`config/`:** Parsing environment variables mapping to `Config` struct.
- **`domain/`:** Abstract definitions: domain models (`models.go`), repository interfaces (`repository.go`), and sentinel errors (`errors.go`).
- **`httpserver/`:** REST routing and request/response serialization (the API layer). Features: `auth_handlers.go`, `conversation_handlers.go`, `message_handlers.go`, `user_handlers.go`, `browser_handlers.go`, `upload_routes.go`, `auth_middleware.go`, `router.go`.
- **`service/`:** Core business logic (`auth_service.go`, `user_service.go`, `conversation_service.go`, `message_service.go`). Services receive repository interfaces from domain. Circular dependency between `ConversationService` and `MessageService` resolved via `SetMessageService()` post-construction.
- **`store/postgres/`:** Data Access Layer (DAL). Implementation of domain repository interfaces: `user_repo.go`, `conversation_repo.go`, `message_repo.go`, `participant_repo.go`, `db.go` (connection + migrations).
- **`ws/`:** WebSocket hub-and-client broadcast pattern (`hub.go`, `handler.go`).
- **`security/`:** Utilities for tokens (`token.go`), password hashing (`password.go`), message encryption (`encrypt.go`).

## Database Schema
Idempotent SQL migrations live in `store/postgres/db.go` (no external migration tool). **6 tables**:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Auth & status | `id`, `username`, `email`, `hashed_password`, `is_active`, `is_online`, `last_seen` |
| `conversations` | Direct or group chats | `id`, `name`, `is_group`, `updated_at` |
| `conversation_participants` | Membership + read tracking | `(user_id, conversation_id)` PK, `last_read_at` |
| `messages` | Chat content (encrypted at rest) | `id`, `content`, `conversation_id`, `sender_id`, `file_path`, `file_type`, `is_deleted`, `is_edited`, `is_read` |
| `user_deleted_messages` | Per-user soft deletes ("delete for me") | `(user_id, message_id)` PK, cascades on message delete |

Indexes on: `username`, `email`, `is_online`, `conversation_id`, `sender_id`, `created_at`, `updated_at`, participant FKs.

## API Routes
All REST routes live under the `/api` prefix. The WebSocket endpoint is at `/ws` (no prefix).

### Public Routes
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/` | inline | Health check (JSON version info) |
| GET | `/health` | inline | `{"status":"healthy"}` |
| GET | `/robots.txt` | inline | Disallow all |
| GET | `/docs/*` | swagger UI | OpenAPI documentation |
| POST | `/api/auth/register` | `auth_handlers.go` | User registration |
| POST | `/api/auth/login` | `auth_handlers.go` | Login (returns JWT) |

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
| GET | `/api/conversations/{conversationID}/messages` | `message_handlers.go` | List messages |
| POST | `/api/conversations/{conversationID}/messages` | `message_handlers.go` | Send message |
| PUT | `/api/messages/{messageID}` | `message_handlers.go` | Edit message |
| DELETE | `/api/messages/{messageID}` | `message_handlers.go` | Delete (for_me/for_everyone) |
| GET | `/api/browser/proxy` | `browser_handlers.go` | Playwright proxy (IP validated) |
| POST | `/api/uploads/` | `upload_routes.go` | File upload (50MB limit) |
| GET | `/api/uploads/{filename}` | `upload_routes.go` | Download (token param or header) |

### WebSocket
| Path | Auth | Description |
|------|------|-------------|
| GET | `/ws` | Bearer token via `Authorization` header or `Sec-WebSocket-Protocol: bearer, <token>` |

**Keep-alive & online-status TTL**: The server sends WebSocket **Ping** control frames every `WS_PING_INTERVAL_SEC` seconds. Clients must respond with a Pong (browsers and OkHttp do this automatically). Connections that fail to respond within `WS_PONG_TIMEOUT_SEC` are closed and the user is marked offline. On server startup, all `is_online` flags are reset to `false` to clear stale state from unclean shutdowns. A user is only broadcast as `user_offline` when **all** of their connections close (supports multiple tabs/devices per user).

### Middleware Stack (order)
`RequestID` → `RealIP` → `Logger` → `Recoverer` → `Timeout(60s)` → `CORS` → `AuthMiddleware` (protected routes only)

## WebSocket Protocol
Flat JSON structure: `{ "type": "...", ...fields }`. All event types:

### Client → Server
| Type | Required Fields | Description |
|------|----------------|-------------|
| `message` | `conversation_id`, `content` (or `file_path`) | Send a message |
| `mark_read` | `conversation_id` | Mark all messages read |
| `typing` | `conversation_id` | Typing indicator (forwarded to other participants) |
| `edit_message` | `message_id`, `content` | Edit own message |
| `delete_message` | `message_id`, `delete_type` (`for_me`/`for_everyone`) | Delete message |
| `call_offer` | `target_user_id`, `conversation_id`, `sdp` | WebRTC offer |
| `call_answer` | `target_user_id`, `conversation_id`, `sdp` | WebRTC answer |
| `ice_candidate` | `target_user_id`, `conversation_id`, `candidate` | ICE candidate |
| `call_end` | `target_user_id`, `conversation_id` | End call |
| `call_rejected` | `target_user_id`, `conversation_id` | Reject call |

### Server → Client
| Type | Key Fields | Description |
|------|-----------|-------------|
| `message` | `message_id`, `conversation_id`, `content`, `sender_id`, `sender_username`, `timestamp` | New message broadcast |
| `message_edited` | `message_id`, `conversation_id`, `content`, `is_edited` | Edited message broadcast |
| `message_deleted` | `message_id`, `conversation_id`, `delete_type` | Deleted message broadcast |
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

## Error Handling Conventions
- **Domain sentinel errors** (`domain/errors.go`): `ErrNotFound`, `ErrUnauthorized`, `ErrForbidden`, `ErrConflict`, `ErrInternal`, `ErrInvalidInput`, `ErrDatabaseConnection`.
- **Service-layer errors**: custom errors in service package (e.g., `ErrForbidden`, `ErrMessageDeleted`) mapped to HTTP status codes in handlers.
- **Handler pattern**: check `errors.Is(err, domain.ErrNotFound)` → `404`, `domain.ErrForbidden` → `403`, etc.

## Security Implementation
| Component | Implementation |
|-----------|---------------|
| **JWT** | HMAC-SHA256, configurable TTL (default 24h, remember-me 30d) |
| **Passwords** | bcrypt (cost 12 in production, cost 10 in tests) |
| **Message encryption** | AES-256-GCM with SHA256-derived 32-byte key, base64-encoded ciphertext. Decrypt falls back to Fernet legacy keys, then raw content. |
| **File uploads** | Forbidden extension list, MIME-based categorization, UUID-renamed files, 50MB limit |
| **Browser proxy** | IP validation blocks private, loopback, link-local, and multicast ranges |
| **CORS** | Whitelist by origin, credentials allowed |
| **WebSocket auth** | Bearer token via `Authorization` header or `Sec-WebSocket-Protocol`, origin check |

## Coding Rules
- Do NOT use ORMs (like GORM) since the architecture relies on `pgx` native connections.
- Ensure Swagger documentation boundaries are updated when HTTP routes are modified in the `httpserver` layer.
- Ensure dependency injection: passing repository interfaces matching the `domain` contracts to ease testing.
- Use sentinel errors from `domain/errors.go` for all error flows. Add new sentinel errors there if needed.
- Validate input at the service layer (username: lowercase `[a-z0-9_-]` 3–50 chars; password: 10+ chars with upper, lower, digit, special; message content: ≤5000 chars).
- Keep idempotent SQL migrations in `store/postgres/db.go`. No external migration tools.
- Follow the testify mock pattern in `auth_service_test.go` for new tests: create concrete mock structs implementing domain repository interfaces.
