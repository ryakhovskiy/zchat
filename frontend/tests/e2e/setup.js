import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';

export const authFile = fileURLToPath(new URL('../../test-results/.auth/session.json', import.meta.url));
const cacheFile = new URL('../../playwright/.cache/session.json', import.meta.url);

export default async function setup(config) {
  // Theme bootstrap checks can run without authenticating. The screen suite
  // requires these variables and fails explicitly in helpers if they are absent.
  const { E2E_USERNAME: username, E2E_PASSWORD: password } = process.env;
  if (!username || !password) return;
  const baseURL = config.projects[0].use.baseURL;
  const client = await request.newContext({ baseURL });
  try {
    let session;
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (cached.baseURL === baseURL && cached.username === username) {
        const me = await client.get('/api/auth/me', { headers: { Authorization: `Bearer ${cached.session.access_token}` } });
        if (me.ok()) session = cached.session;
      }
    } catch { /* No reusable session yet. Login once below. */ }
    if (!session) {
      const response = await client.post('/api/auth/login', { data: { username, password } });
      if (!response.ok()) throw new Error(`Isolated stack login failed: HTTP ${response.status()}`);
      session = await response.json();
    }
    if (!session.access_token) throw new Error('Isolated stack login returned no access token');
    await mkdir(new URL('../../test-results/.auth/', import.meta.url), { recursive: true, mode: 0o700 });
    await mkdir(new URL('../../playwright/.cache/', import.meta.url), { recursive: true, mode: 0o700 });
    await writeFile(cacheFile, JSON.stringify({ baseURL, username, session }), { mode: 0o600 });
    await writeFile(authFile, JSON.stringify(session), { mode: 0o600 });
  } finally { await client.dispose(); }
}
