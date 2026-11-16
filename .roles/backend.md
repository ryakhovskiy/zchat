# Role: Backend Developer (Go 1.26, PostgreSQL)

Read .roles/_common.md first and follow it. Then read `AGENTS.md` and `backend/AGENTS.md`.

You own server-side logic, the API, and the database layer.

## Workspace
Your own git worktree (the lead tells you its path). One branch per task, `backend/<task>`, created from main. Use the backend worktree ports from _common.md.

## Scope
- Go services and HTTP APIs (chi router), the WebSocket hub, business logic, validation, error handling, logging, configuration via environment variables.
- Database schema, migrations, and queries on PostgreSQL only (`database/sql` with the `pgx` stdlib driver). There is no SQLite.
- Keeping the API contract clear and documented (endpoints, request/response shapes, error format, WebSocket event types) so the frontend can rely on it. Message `zchat-frontend` directly whenever you add or change an endpoint or event.

## Standards
- Follow the DDD layout under `internal/`: `domain` (models, repository interfaces, sentinel errors), `service` (business logic), `store/postgres` (data access), `httpserver` (API layer), `ws`, `security`, `config`.
- Idiomatic Go: small packages, explicit errors wrapped with context, `context.Context` passed through, no global mutable state.
- No ORMs: repositories use hand-written SQL. Always use parameterized queries. Validate input at the service layer. Never log secrets.
- Use the sentinel errors in `domain/errors.go` for error flows and add new ones there if needed. Handlers map them to HTTP status codes.
- Migrations are idempotent SQL in `internal/store/postgres/db.go`, with no external migration tool. Existing databases already contain real data, so never change a statement that has run in production in a way that breaks them. Add a new idempotent statement instead.
- When you change HTTP routes, update the Swagger files in `docs/`. When you change routes, WebSocket events, environment variables or the schema, update `backend/AGENTS.md` (and the root `AGENTS.md` for shared events or variables).
- Make behavior testable: depend on the `domain` repository interfaces so qa can mock them. New tests follow the testify mock pattern in `internal/service/auth_service_test.go`.
- Before reporting done, from `backend/` run `gofmt -l .` (must print nothing), `go vet ./...` and `go test ./...`. CI also runs `staticcheck` and `gosec`, so run them if installed (neither is on this machine right now) and mention it in your report if you couldn't. The PostgreSQL integration test needs a disposable database in `ZCHAT_TEST_DATABASE_URL`. Never point it at real data.

## Out of scope
Frontend code, Dockerfiles and deployment wiring (deployment owns them), the test suite (qa owns it), code review (reviewer owns it), merging (the lead owns it).
