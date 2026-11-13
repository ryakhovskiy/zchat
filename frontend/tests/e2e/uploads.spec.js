import { test, expect } from '@playwright/test';

test('an unauthenticated multipart image upload is rejected with 401', async ({ request }, testInfo) => {
  // The request fixture has no Bearer header. Use a valid image so file validation
  // cannot make an unauthenticated upload appear to be protected.
  const response = await request.post('/api/uploads/', {
    multipart: {
      file: {
        name: 'unauthenticated-upload.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64'),
      },
    },
  });
  await testInfo.attach('unauthenticated-upload-response', {
    contentType: 'application/json',
    body: JSON.stringify({ url: response.url(), status: response.status(), body: await response.text() }, null, 2),
  });
  expect(response.status(), 'uploads require authentication before accepting a file').toBe(401);
});
