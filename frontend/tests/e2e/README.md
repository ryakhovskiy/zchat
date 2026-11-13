# Isolated browser acceptance tests

Install with `npm install`. The pinned Playwright 1.65.0 uses cached Chromium revision
1254 (`channel: chromium`), so no browser download is needed on the QA host. Other
hosts can run `npx playwright install chromium` once. Install system libraries once
with `sudo npx playwright install-deps chromium` (requires administrator access).

Provide a **disposable test stack** with its own database, uploads, and seeded test
users. This checkout does not provision that stack or its seed data. Never point
the suite at a stack containing real accounts, messages, or files: regression tests
create conversations, upload images, and change messages. The config requires an
explicit loopback `E2E_BASE_URL` and never starts a server or reads the repository
root `.env`.

Set the URL of the disposable frontend you prepared. Port 38080 below is only an
example, not a service supplied by this repository. Set `E2E_EXPECT_BUNDLE=1` when
validating a rebuilt production image; omit it for an isolated development server.

```sh
export E2E_BASE_URL=http://127.0.0.1:38080
export E2E_EXPECT_BUNDLE=1
export E2E_USERNAME='<isolated seeded user>'
export E2E_PASSWORD='<isolated seeded password>'
export E2E_PEER='<isolated seeded direct-chat peer>'
npm run test:e2e
```

Prepare these fixtures before running:

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

Seven projects cover 320×640, 360×740, 390×844, 430×932, 740×360, 768×1024,
1440×900. Each runs Light, Dark, Tech Green and Tech Red. A separate project blocks
the React entry script to check synchronous theme initialization before mount.
Two extra projects decouple pointer type from width (wide touch and narrow mouse).
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
