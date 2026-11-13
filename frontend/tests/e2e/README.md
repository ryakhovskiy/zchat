# Isolated browser acceptance tests

Install with `npm install`. The pinned Playwright 1.65.0 uses cached Chromium revision
1254 (`channel: chromium`), so no browser download is needed on the QA host. Other
hosts can run `npx playwright install chromium` once. Install system libraries once
with `sudo npx playwright install-deps chromium` (requires administrator access).

Use the isolated stack supplied by deployment. Never point the suite at a real
database: regression tests create conversations, upload images, and change messages.
The config requires an explicit loopback URL and never starts a server or reads the
repository root `.env`.

```sh
export E2E_BASE_URL=http://127.0.0.1:3000
export E2E_USERNAME='<isolated seeded user>'
export E2E_PASSWORD='<isolated seeded password>'
export E2E_PEER='<isolated seeded direct-chat peer>'
npm run test:e2e
```

The seeded user must have a direct conversation with `E2E_PEER`, at least one text
message, a served image attachment, and a second peer user. Tests use independent temporary group
conversations for mutable regressions; reset/reseed the isolated stack when needed.

Seven projects cover 320×640, 360×740, 390×844, 430×932, 740×360, 768×1024,
1440×900. Each runs Light, Dark, Tech Green and Tech Red. A separate project blocks
the React entry script to check synchronous theme initialization before mount.

Useful commands:

```sh
npm run test:e2e -- --project=theme-init
npm run test:e2e -- --project=390x844 --grep=tech-green
npm run test:e2e -- --list
npx playwright show-report
```

Screenshots and axe color-contrast results are attached to the HTML report.
Artifacts live in ignored `test-results/` and `playwright-report/`. Captures are
evidence for review, not image-diff baselines. Axe reports actual rendered contrast;
`incomplete` results require visual review and are preserved alongside measured
foreground/background ratios. Device emulation tests touch and responsive behavior
in Chromium; it cannot certify a real iOS keyboard, Safari, safe-area hardware, or
an active two-party media call. Those need device checks.
