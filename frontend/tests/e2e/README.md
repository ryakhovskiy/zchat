# Isolated browser acceptance tests

Install with `npm install`. The pinned Playwright 1.65.0 uses cached Chromium revision
1254 (`channel: chromium`), so no browser download is needed on the QA host. Other
hosts can run `npx playwright install chromium` once. Install system libraries once
with `sudo npx playwright install-deps chromium` (requires administrator access).

Use the isolated stack supplied by deployment. Never point the suite at a real
database: regression tests create conversations, upload images, and change messages.
The config requires an explicit loopback URL and never starts a server or reads the
repository root `.env`. Use the rebuilt isolated production frontend on **38080**
after deployment confirms its image is live. **Port 3000 is the default stack with
real data; do not run this suite against it.**

```sh
export E2E_BASE_URL=http://127.0.0.1:38080
export E2E_EXPECT_BUNDLE=1
export E2E_USERNAME='<isolated seeded user>'
export E2E_PASSWORD='<isolated seeded password>'
export E2E_PEER='<isolated seeded direct-chat peer>'
npm run test:e2e
```

The seeded user must have a direct conversation with `E2E_PEER`, at least one text
message and a served image attachment. Setup creates one fixture-only participant
named `<E2E_USERNAME>_qa` if needed. Mutable regressions use a scratch group with that
participant (the backend deduplicates groups by participant set) and unique message
contents; reset/reseed the isolated stack when needed.

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
