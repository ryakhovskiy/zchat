### zChat Go backend (`backend`)

This is a Go rewrite of the existing Python/FastAPI backend. It provides the same core features (auth, users, conversations, messages, uploads, WebSockets) with an idiomatic Go architecture.

---

### Requirements

- Go **1.21+**
- PostgreSQL (driver: `github.com/jackc/pgx/v5/stdlib`)
- Environment variables:
  - **JWT_SECRET**: secret key for signing JWT tokens.
  - **ENCRYPTION_KEY**: secret used for encrypting message content (any string; internally hashed to a 32‑byte key).
  - Optional:
    - **HTTP_HOST** (default `0.0.0.0`)
    - **HTTP_PORT** (default `8000`)
    - **DATABASE_URL** (default `postgres://postgres:postgres@localhost:5432/zchat?sslmode=disable`)
    - **CORS_ORIGINS** (comma‑separated list; default `http://localhost:3000,http://localhost:5173`)
    - **MAX_MESSAGES_PER_CONVERSATION** (default `1000`)

You can reuse values from the existing `.env` used by the Python backend (e.g. `ENCRYPTION_KEY`).

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

The container listens on `0.0.0.0:8000` by default, which matches the Nginx configuration in `deployment.md` that proxies `/api` and `/ws` to port `8000`.

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

- The Go backend now targets PostgreSQL by default. Configure `DATABASE_URL` to your local/dev/prod Postgres instance.
- For production, **always** override the default development secrets and configure CORS appropriately for your domain.

