# Browser acceptance tests

The dual disposable Compose project `zchat-e2e` serves the full React app at
`http://127.0.0.1:38080` (`E2E_BASE_URL`) and the lite client at
`http://127.0.0.1:38081` (`E2E_LITE_URL`), sharing one backend and PostgreSQL.
The lite config uses `E2E_LITE_URL`; interop uses both URLs. It starts no server.
Both URLs must exactly match `http://127.0.0.1:<exported port>`; ports must be
unprivileged and distinct. Ports 3000/3100 and projects `zchat`/`zchat-lite` are
forbidden because they are reserved for real data. The retired standalone lite
E2E project is also rejected.

The production lite client needs no Node tooling. Test dependencies live in
`frontend-lite/tests/package.json`: Playwright 1.65.0 and axe 4.11.1. From the
repository root:

```sh
cd frontend-lite/tests
npm install --package-lock=false
npx playwright install chromium
# Once per Linux host, if browser system libraries are missing:
# sudo npx playwright install-deps chromium
```

Chromium uses `channel: chromium`. The stack owner must hand off an idle stack
before browser runs; never rebuild, seed or reset it while another suite is
running. To prepare a disposable stack when you own its lifecycle, from the
repository root:

```sh
export E2E_PROJECT=zchat-e2e E2E_PORT=38080 E2E_LITE_PORT=38081
bash e2e/run.sh up
bash e2e/run.sh seed
bash e2e/run.sh verify
eval "$(bash e2e/run.sh env)"
```

`run.sh env` exports `E2E_PROJECT`, `E2E_PORT`, `E2E_LITE_PORT`,
`E2E_BASE_URL` (React), `E2E_LITE_URL` (lite), `E2E_USERNAME`, `E2E_PASSWORD`,
`E2E_PEER` and `E2E_PEER_PASSWORD`. Never assume a fixed password or print
these credentials. Keep both URLs exported; do not replace `E2E_BASE_URL`
with the lite URL. Custom disposable projects can override all three project
and port variables. Their generated state lives under ignored
`e2e/.state/<project>/`; the default `zchat-e2e` uses generated `e2e/.env`
and stores verification reports in `e2e/`. The root `.env` is unused and must
not be read. Set `EXTRA_CA_FILE` before building if a TLS proxy requires a
trusted CA bundle. HTTP verification checks both frontends and shared auth,
including SSE keepalive pings.

After handoff, run the unchanged React suite and then the lite suite serially
with the same exported environment (from the repository root):

```sh
(cd frontend && npm install --package-lock=false && npm run test:e2e)
(cd frontend-lite/tests && npm run test:e2e -- --project=lite --project=slow-network)
(cd frontend-lite/tests && npm run test:e2e -- --project=interop)
```

Fixtures are Alice/Bob/Carol and `<E2E_USERNAME>_qa`, an Alice/Bob direct chat
with at least 60 text messages plus a tiny uploaded PNG, and additional chats for
navigation. Bob uses the exported peer password (defaults to Alice's password
when `E2E_PEER_PASSWORD` is absent). Registration needs spare account capacity;
each complete run creates two unique accounts through the forms (normal registration
and the pending-registration race) and starts a direct chat from the first account.
Reseed/reset only the selected disposable project when its user cap is
reached. Tests use unique message content and never depend on message IDs or order
left by earlier runs.

`setup.js` authenticates Alice once and reuses a validated cached session in
`frontend-lite/playwright/.cache/session.json`. The peer session is cached alongside
it. Each context still establishes a real SSE connection. Only dedicated auth, shared-login interop
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
- A real socket drop through a temporary loopback SSE proxy; a fresh ticket, list/latest refetch and
  recovery of missed sends, edits and deletions, followed by another live message.
  The proxy forwards only the selected stack's SSE endpoint and closes its sockets to
  produce a native EventSource error. Chromium's offline emulation alone does
  not reliably disconnect a stream that is already open.
- Delayed real REST snapshots racing live mutations, a chat switch and logout.
- Delayed successful write acknowledgements racing a later edit or delete-for-me,
  plus registration completing after another account has already signed in.
  Send/edit/delete acknowledgements must still update the UI when SSE is down.
- Axe WCAG A/AA scans of login, list and chat, with full JSON evidence.
- A cold load requesting only HTML and `app.js`, whose individually gzipped
  bodies at level 9 must total at most 8192 bytes.
- An Android-style WebSocket authenticated with a Bearer header exchanging
  messages both ways with the SSE browser client.
- The retained unauthenticated multipart-upload API regression (401).

The `slow-network` project applies CDP to the browser **before cold navigation**:
50,000 bits/s (6,250 bytes/s) upload/download, 500 ms latency, cache disabled.
It completes real form login, opens the seeded chat, sends and receives a live
message. Fixture discovery and the API sender use the unthrottled request context;
the client's own list/messages requests remain throttled.
The test records its exact network profile and elapsed time. The timeout is
180 seconds; this certifies the emulated Chromium link, not a physical device.

The `interop` project opens two isolated contexts: React as Alice on the full
port and lite as Bob on the lite port. It sends, edits and deletes through each
UI and verifies the opposite UI updates live, counting actual WS/SSE frames and
message rows exactly once after later messages fence both streams. A separate
case logs in once through the React form and reuses that exact token in lite,
checking the same account via both ports. Presence starts with Bob offline,
opens only his lite SSE session, checks React's online transition, then closes
it and checks offline. These three cases are separate from the original 17
lite cases (16 `lite` plus one `slow-network`). Interop attachments record
message IDs, transport events, shared-login count and presence transitions.

Run the following from `frontend-lite/tests/`:

```sh
# Collection and JavaScript checks do not contact a stack.
npm run test:e2e -- --list
node --check e2e/lite.spec.js
npm run test:e2e -- --project=lite
npm run test:e2e -- --project=slow-network
npm run test:e2e -- --project=interop
npx playwright show-report ../playwright-report
node e2e/report.mjs ../test-results/results.json
```

HTML reports are under `frontend-lite/playwright-report/`; JSON reports, browser
traces and failure screenshots are under `frontend-lite/test-results/`.
All are ignored and may contain fixture tokens. The
report script summarizes results, axe violations and attached payload/slow-link
evidence. A collected test is not a passing browser test.

When you own the stack lifecycle, `bash e2e/run.sh down` from the repository
root retains volumes. `down --volumes` deletes only the selected disposable
project's fixtures; `reset` rebuilds and reseeds them. Coordinate with anyone
using either port first, since both clients share the database. Keep the
project and both port settings consistent across preparation, testing and
teardown; defaults are `zchat-e2e`, React 38080 and lite 38081.
