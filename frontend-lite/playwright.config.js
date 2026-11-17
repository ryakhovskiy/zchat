// Playwright is installed under tests/ only; production needs no Node packages.
const { E2E_PROJECT: project, E2E_PORT: fullPort, E2E_LITE_PORT: litePort,
  E2E_BASE_URL: fullURL, E2E_LITE_URL: baseURL } = process.env;
const safePort = port => /^[1-9]\d*$/.test(port || '') &&
  Number(port) >= 1024 && Number(port) <= 65535 && !['3000', '3100'].includes(port);
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project || '') ||
    ['zchat', 'zchat-lite', 'zchat-lite-e2e'].includes(project) ||
    !safePort(fullPort) || !safePort(litePort) || fullPort === litePort ||
    fullURL !== `http://127.0.0.1:${fullPort}` || baseURL !== `http://127.0.0.1:${litePort}`) {
  throw new Error('Export the dual disposable stack with e2e/run.sh env: E2E_PROJECT, E2E_PORT, E2E_LITE_PORT, E2E_BASE_URL (full) and E2E_LITE_URL (lite). URLs must match their distinct loopback ports; real-data projects and ports 3000/3100 are forbidden.');
}

export default {
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/setup.js',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    browserName: 'chromium',
    channel: 'chromium',
    locale: 'en-US',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'lite', testMatch: ['lite.spec.js', 'races.spec.js', 'uploads.spec.js'], use: { viewport: { width: 390, height: 844 } } },
    { name: 'slow-network', testMatch: 'slow-network.spec.js', use: { viewport: { width: 390, height: 844 } } },
    { name: 'interop', testMatch: 'interop.spec.js', use: { viewport: { width: 1280, height: 900 } } },
  ],
};
