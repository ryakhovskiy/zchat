# Isolated browser acceptance tests

From `frontend/`, install with `npm install`. The pinned Playwright 1.65.0 uses cached Chromium revision
1254 (`channel: chromium`), so no browser download is needed on the QA host. Other
hosts can run `npx playwright install chromium` once. Install system libraries once
with `sudo npx playwright install-deps chromium` (requires administrator access).

Use the included **disposable test stack** in `e2e/`, which needs Docker Compose
and Python 3. Its production nginx frontend listens on `127.0.0.1:38080` and
proxies to an unpublished backend and database in Compose project `zchat-e2e`.
It generates dummy DB/JWT/encryption secrets and a test-user password in ignored
`e2e/.env`; it does not read the repository root `.env`.

Never point the suite at a stack containing real accounts, messages, or files:
regression tests create conversations, upload images, and change messages. The
Playwright config requires an explicit loopback `E2E_BASE_URL` and does not start a
server. From the repository root:

```sh
bash e2e/run.sh up
bash e2e/run.sh seed
eval "$(bash e2e/run.sh env)"
cd frontend
npm run test:e2e
```

The `env` action exports only the client `E2E_*` variables, including the generated
password and `E2E_EXPECT_BUNDLE=1`; do not assume a fixed password. Behind a TLS
intercepting proxy, set `EXTRA_CA_FILE` to your trusted CA bundle before `up` or
`reset`.

The seed supplies `alice_ui`, `bob_ui`, `carol_ui`, and `alice_ui_qa`, a direct chat
with 60 messages and an image among the latest 15, plus group/scratch conversations.
For a custom disposable stack, provide the following fixtures and set the client
variables explicitly (`E2E_EXPECT_BUNDLE=1` for a production image, omitted for an
isolated development server):

- A test account named `E2E_USERNAME` with password `E2E_PASSWORD`; `setup.js` logs
  in to this existing account and does not create it.
- Another test user named `E2E_PEER`, visible through the users API.
- A second peer named `<E2E_USERNAME>_qa` for group regressions. `setup.js` creates
  this fixture-only user with `E2E_PASSWORD` when it is absent, so registration
  must be available unless the user is already seeded.
- An existing direct conversation between `E2E_USERNAME` and `E2E_PEER` containing
  at least one visible text message and one image attachment served by the uploads
  API. The image must be visible to the test account, not deleted or hidden.

Mutable regressions create or reuse a scratch group containing the test account and
both peers (the backend deduplicates groups by participant set), with unique message
contents. Reset/reseed only your disposable stack when needed.

From the repository root, `bash e2e/run.sh down` removes the test containers while
retaining data. `bash e2e/run.sh down --volumes` discards the disposable database and
uploads; `bash e2e/run.sh reset` rebuilds and reseeds them. `bash e2e/run.sh verify`
checks the production HTTP assets and container identities.

Seven projects cover 320×640, 360×740, 390×844, 430×932, 740×360, 768×1024,
1440×900. Each runs Light, Dark, Tech Green and Tech Red. A separate project blocks
the React entry script to check synchronous theme initialization before mount.
Two extra projects decouple pointer type from width (wide touch and narrow mouse).
An unauthenticated valid multipart upload must return 401; each image-upload UI
regression requires a successful request carrying a Bearer token and a served image.
Global setup authenticates when a reusable session is unavailable, and each browser
context reuses that isolated session to stay below the login endpoint's 10
requests/minute/IP limit. One dedicated test also signs in through the actual form.
Subsequent runs validate and reuse the cached session in ignored
`playwright/.cache/session.json`; the cache stores no password. Delete that file to
force a fresh login after a stack reset.

WebBrowser has been deleted from the application and is outside this suite's scope.
Screen captures cover login/register, conversations, chat, settings, the user
picker, image viewer, and call UI in each theme and viewport.

With `E2E_EXPECT_BUNDLE=1`, the production check rejects Vite development HTML,
requires the served nginx page to reference hashed JavaScript/CSS, checks that the
delivered stylesheet defines all four themes, and records SHA-256 fingerprints of
the served assets. Keep deployment's image/container identity with that report so
results can be tied to the rebuilt image. The no-flash checks intercept either the
source entry in an isolated development server or the hashed entry in production.
The CSS source-contract check inspects the checkout; production asset checks and
the browser matrix inspect the served application.

Useful commands:

```sh
npm run test:e2e -- --project=theme-init
npm run test:e2e -- --project=390x844 --grep=tech-green
npm run test:e2e -- --list
npx playwright show-report
node tests/e2e/report.mjs
```

Screenshots and axe color-contrast results are attached to the HTML report.
Artifacts live in ignored `test-results/` and `playwright-report/`. Captures are
evidence for review, not image-diff baselines. Axe reports actual rendered contrast;
`incomplete` results require visual review and are preserved alongside measured
foreground/background ratios. Device emulation tests touch and responsive behavior
in Chromium; it cannot certify a real iOS keyboard, Safari, safe-area hardware, or
an active two-party media call. Those need device checks.
