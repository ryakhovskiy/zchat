// Playwright is installed under tests/ only; production needs no Node packages.
const baseURL = process.env.E2E_BASE_URL;
if (baseURL !== 'http://127.0.0.1:38081' ||
    process.env.E2E_PROJECT !== 'zchat-lite-e2e' || process.env.E2E_PORT !== '38081') {
  throw new Error('Export E2E_PROJECT=zchat-lite-e2e E2E_PORT=38081 E2E_BASE_URL=http://127.0.0.1:38081. Every other target is forbidden.');
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
  ],
};
