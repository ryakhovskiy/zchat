// Dev only (not copied into the image): serves index.html + app.js and proxies /api to a local backend.
// Usage: PORT=3001 API_PORT=8001 node dev-proxy.mjs   (no dependencies; the SSE stream is piped through unbuffered)
import http from 'node:http';
import fs from 'node:fs';

const port = +process.env.PORT || 3001, api = +process.env.API_PORT || 8001;
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'application/javascript'] };

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const up = http.request({ host: '127.0.0.1', port: api, path: req.url, method: req.method, headers: req.headers }, r => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    res.on('close', () => up.destroy());
    return req.pipe(up);
  }
  const f = files[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(new URL(f[0], import.meta.url)));
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port} -> /api on :${api}`));
