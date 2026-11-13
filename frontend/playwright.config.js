import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Set E2E_BASE_URL to the isolated loopback test stack; there is no default target.');
}

const viewports = [
  [320, 640], [360, 740], [390, 844], [430, 932],
  [740, 360], [768, 1024], [1440, 900],
];

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/setup.js',
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    browserName: 'chromium',
    channel: 'chromium',
    locale: 'en-US',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [
    { name: 'theme-init', testMatch: ['theme-init.spec.js', 'theme-contract.spec.js', 'auth-form.spec.js', 'production.spec.js'], use: { viewport: { width: 390, height: 844 } } },
    ...viewports.map(([width, height]) => ({
      name: `${width}x${height}`,
      testMatch: ['responsive.spec.js', 'regression.spec.js', 'composer-race.spec.js'],
      use: { viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 },
    })),
    { name: 'wide-touch', testMatch: 'input-types.spec.js', use: { viewport: { width: 1024, height: 900 }, hasTouch: true } },
    { name: 'narrow-mouse', testMatch: 'input-types.spec.js', use: { viewport: { width: 390, height: 844 }, hasTouch: false } },
  ],
});
