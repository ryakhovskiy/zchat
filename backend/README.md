### zChat Go backend (`backend`)

The zChat backend is a Go REST API and WebSocket server backed by PostgreSQL. It provides auth, users, conversations, messages (with replies and reactions), file uploads, Web Push notifications and WebRTC call signaling over WebSockets, with an idiomatic Go architecture. See `AGENTS.md` for the package layout, routes and WebSocket protocol.

---

### Requirements

- Go **1.26+**
- PostgreSQL (driver: `github.com/jackc/pgx/v5/stdlib`)
- Environment variables:
  - **JWT_SECRET**: secret key for signing JWT tokens.
  - **ENCRYPTION_KEY**: secret used for encrypting message content (any string; internally hashed to a 32‑byte key).
  - Optional:
    - **HTTP_HOST** (default `0.0.0.0`)
    - **HTTP_PORT** (default `8000`)
    - **POSTGRES_HOST** (default `localhost`), **POSTGRES_PORT** (default `5432`), **POSTGRES_USER** (default `postgres`), **POSTGRES_PASSWORD** (default `postgres`), **POSTGRES_DB** (default `zchat`): the database connection is built from these (there is no `DATABASE_URL`).
    - **CORS_ORIGINS** (comma‑separated list; default `http://localhost:3000,http://localhost:5173`)
    - **MAX_MESSAGES_PER_CONVERSATION** (default `1000`)
    - **MAX_USERS** (default `10`; positive integer): maximum total users, including inactive accounts. Set `MAX_USERS=10` in the root `.env` for Docker Compose, or export it when running locally. Registration at or above the limit returns HTTP 403 with an error displayed by the frontend. Existing users can still log in. Restart the backend after changing this value.
    - **ACCESS_TOKEN_EXPIRE_MINUTES** (default `1440`), **REMEMBER_ME_TOKEN_EXPIRE_DAYS** (default `30`)
    - **UPLOAD_DIR** (default `uploads`)
    - **DEBUG** (default `true`): when `true`, Swagger UI is served at `/docs/`
    - **WS_PING_INTERVAL_SEC** (default `30`), **WS_PONG_TIMEOUT_SEC** (default `60`)
    - **ENCRYPTION_KEY_LEGACY**: comma-separated legacy Fernet keys, for decrypting migrated messages
    - **VAPID_PUBLIC_KEY**, **VAPID_PRIVATE_KEY**: Web Push keys; push notifications are enabled only when both are set

See `AGENTS.md` for the full environment variable reference.

### Tests

```bash
go test ./...
```

`internal/store/postgres` tests need a PostgreSQL instance and are skipped unless `ZCHAT_TEST_DATABASE_URL` is set.

---

### Running locally (Linux/macOS)

From the repo root:

```bash
cd backend
chmod +x start.sh
./start.sh
```

The script:

- Verifies that `go` is installed.
- Sets development defaults for `JWT_SECRET`, `ENCRYPTION_KEY`, and `HTTP_PORT` if they are not already set.
- Runs the server with `go run ./cmd/server`.

A PostgreSQL instance must be reachable using the `POSTGRES_*` settings above.

The server listens on `http://localhost:8000` by default.

---

### Running locally (Windows, PowerShell)

From the repo root in PowerShell:

```powershell
cd backend
.\start.ps1
```

The script behaves similarly to `start.sh`:

- Checks that `go` is available.
- Sets development defaults for `JWT_SECRET`, `ENCRYPTION_KEY`, and `HTTP_PORT` if missing.
- Runs `go run ./cmd/server`.

---

### Docker image

The `Dockerfile` is located in `backend/Dockerfile`.

Build the image from the repo root:

```bash
docker build -t zchat-backend-go ./backend
```

Run the container:

```bash
docker run \
  -e JWT_SECRET="your-production-jwt-secret" \
  -e ENCRYPTION_KEY="your-production-encryption-key" \
  -e CORS_ORIGINS="https://zchat.space,https://www.zchat.space" \
  -p 8000:8000 \
  --name zchat-backend-go \
  zchat-backend-go
```

The container listens on `0.0.0.0:8000` by default, which matches the nginx configuration (`frontend/docker/nginx.conf`) that proxies `/api` and `/ws` to port `8000`. The container also needs a reachable PostgreSQL: pass the `POSTGRES_*` variables (e.g. `-e POSTGRES_HOST=...`). Or run the full stack with `docker compose up -d --build` from the repo root.

---

### Development Commands

Use these commands for common development tasks from the `backend/` directory:

#### Compile
Check if the code compiles without producing a binary:
```bash
go build ./...
```

#### Build
Compile the application into an executable binary named `zchat-server`:
```bash
# General build
go build -o zchat-server ./cmd/server

# Optimized build (smaller binary)
go build -ldflags="-s -w" -o zchat-server ./cmd/server
```

#### Clean
Remove build artifacts, object files, and cached tests:
```bash
# Remove the built binary (Windows: del zchat-server.exe)
rm zchat-server

# Clean Go build cache and test results
go clean -cache -testcache -modcache
```

#### Rebuild
Force a complete rebuild of all packages, including dependencies:
```bash
go build -a -o zchat-server ./cmd/server
```

#### Tidy Dependencies
Sync and clean up `go.mod` and `go.sum`:
```bash
go mod tidy
```

---

### Notes

- The backend uses PostgreSQL only. Configure the `POSTGRES_*` variables for your local/dev/prod instance.
- For production, **always** override the default development secrets and configure CORS appropriately for your domain.

