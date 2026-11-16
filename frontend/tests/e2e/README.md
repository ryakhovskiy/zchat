# Lite browser acceptance tests

The suite targets only Compose project `zchat-lite-e2e` at
`http://127.0.0.1:38081`. The config requires that exact URL, project and port;
it starts no server. Port 3000 contains real data. The existing `zchat-e2e`
stack on 38080 is also off limits.

The production client needs no Node tooling. Test dependencies live separately
in `frontend/tests/package.json`: Playwright 1.65.0 and axe 4.11.1. From this repo:

```sh
cd frontend/tests
npm install --package-lock=false
npx playwright install chromium
# Once per Linux host, if browser system libraries are missing:
# sudo npx playwright install-deps chromium
```

Chromium uses `channel: chromium`. On the QA host the browser is already cached.
Do not start the stack until the lead confirms the frontend/backend merges landed.
QA owns its lifecycle; coordinate builds, reset and teardown with deployment.
From the repository root:

```sh
export E2E_PROJECT=zchat-lite-e2e E2E_PORT=38081
bash e2e/run.sh up
bash e2e/run.sh seed
eval "$(bash e2e/run.sh env)"
bash e2e/run.sh verify
cd frontend/tests
npm run test:e2e
```

`run.sh env` exports the exact base URL, project, port, `E2E_USERNAME`,
`E2E_PASSWORD`, `E2E_PEER` and `E2E_PEER_PASSWORD`. Never assume a fixed password.
The lite project's generated secrets and results live under ignored
`e2e/.state/zchat-lite-e2e/`; the root `.env` is unused. Set `EXTRA_CA_FILE` before
building if a TLS proxy requires a trusted CA bundle. HTTP verification takes
about 80 seconds to check that SSE survives multiple keepalive pings.

Fixtures are Alice/Bob/Carol and `<E2E_USERNAME>_qa`, an Alice/Bob direct chat
with at least 60 text messages plus a tiny uploaded PNG, and additional chats for
navigation. Bob uses the exported peer password (defaults to Alice's password
when `E2E_PEER_PASSWORD` is absent). Registration needs spare account capacity;
each complete run creates one unique account through the form and starts a direct
chat from that account. Reseed/reset only the lite project when its user cap is
reached. Tests use unique message content and never depend on message IDs or order
left by earlier runs.

`setup.js` authenticates Alice once and reuses a validated cached session in
`frontend/playwright/.cache/session.json`. The peer session is cached alongside
it. Each context still establishes a real SSE connection. Only dedicated auth
and slow-network tests use the login form, keeping auth below the shared
10 requests/minute/IP limit on a fresh run. Rapid repeated full runs may need a
minute between them. Cached sessions contain tokens, stay ignored, and are
revalidated after stack resets.

The `lite` project covers:

- Form login with both storage choices, remember-me request and logout; form
  registration and a new direct chat through the native select.
- Two isolated browser contexts exchanging text over actual SSE frames, including
  sender echo de-duplication, literal HTML/multiline text, edit, delete for me
  across the actor's tabs and delete for everyone across participants.
- Twenty-message pagination with `before_id`, oldest-first order and no duplicate
  IDs, plus REST/SSE field normalization after reload.
- Unread counts, conversation ordering and REST mark-read.
- An actual offline/online stream drop; a fresh ticket, list/latest refetch and
  recovery of missed sends, edits and deletions, followed by another live message.
- Delayed real REST snapshots racing live mutations, a chat switch and logout.
- Axe WCAG A/AA scans of login, list and chat, with full JSON evidence.
- A cold load requesting only HTML and `app.js`, whose individually gzipped
  bodies at level 9 must total at most 8192 bytes.
- An Android-style WebSocket authenticated with a Bearer header exchanging
  messages both ways with the SSE browser client.
- The retained unauthenticated multipart-upload API regression (401).

The `slow-network` project applies CDP to the browser **before cold navigation**:
50,000 bits/s (6,250 bytes/s) upload/download, 500 ms latency, cache disabled.
It completes real form login, opens the seeded chat, sends and receives a live
message. Only the fixture API sender uses the unthrottled request context.
The test records its exact network profile and elapsed time. The timeout is
180 seconds; this certifies the emulated Chromium link, not a physical device.

```sh
# Collection and JavaScript checks do not contact a stack.
npm run test:e2e -- --list
node --check e2e/lite.spec.js
npm run test:e2e -- --project=lite
npm run test:e2e -- --project=slow-network
npx playwright show-report ../playwright-report
node e2e/report.mjs ../test-results/results.json
```

HTML reports are under `frontend/playwright-report/`; JSON reports, browser
traces and failure screenshots are under `frontend/test-results/`.
All are ignored and may contain fixture tokens. The
report script summarizes results, axe violations and attached payload/slow-link
evidence. A collected test is not a passing browser test.

From the repository root with the same exported project/port, `bash e2e/run.sh
down` retains volumes. `down --volumes` deletes this project's fixtures; `reset`
rebuilds and reseeds them. Never unset the project/port and invoke these commands:
the helper retains legacy defaults for the other checkout.
