# Security Hardening Plan

Context: nginx runs directly on the host (not containerized) and terminates TLS on 443. The
**frontend runs directly on the host too** — nginx serves the built static files from
`/var/www/zchat.space`. Only the **backend runs in Docker**, publishing port 8000 to the host;
nginx reverse-proxies `/app`, `/api`, and `/ws` to it.

**Last revalidated:** 2026-09-21, against `f006ed3` on branch `fix/sec`, plus the live
`/etc/nginx/nginx.conf` and `/etc/nginx/sites-enabled/` configs supplied for this pass. Every
item below was re-checked against one of those two sources — nothing here is carried forward
unverified.

**Implementation pass:** 2026-09-22, on branch `fix/sec`. The confident, code-side items were
implemented in this repo (backend builds; `go test`, `gofmt`, `staticcheck`, and `gosec` all
clean). Items needing live-server measurement or a product decision were deliberately left for
the operator. Each item's heading is tagged with its status:

- **✅ DONE (code)** — change is in the working tree; still needs deploy + the listed validation.
- **🟨 PARTIAL** — the code-side piece is done; a deploy-side piece remains.
- **⏸️ DEFERRED** — needs live-server validation, a product decision, or is a larger refactor.

| Item | Status | Where |
|------|--------|-------|
| 1. Backend port → loopback | ✅ DONE (code) | `docker-compose.yml` |
| 2. Security response headers | ✅ DONE (code) | `frontend/nginx.conf` |
| 3. Uploaded-HTML stored XSS | ✅ DONE (code) | `upload_routes.go` |
| 4. Auth responses cacheable | ✅ DONE (code) | `router.go` |
| 5. Weak TLS protocols | ⏸️ DEFERRED | untracked `nginx.conf`; needs `openssl` check |
| 6. nginx version disclosure | ⏸️ DEFERRED | untracked `nginx.conf` (see item 13) |
| 7. Content-Security-Policy | ⏸️ DEFERRED | needs Report-Only session |
| 8. Permissions-Policy | ✅ DONE (code) | `frontend/nginx.conf` |
| 9. `CORS_ORIGINS` in prod | ⏸️ DEFERRED | needs on-server check |
| 10. JWT in download URL | ⏸️ DEFERRED | log fix needs untracked `nginx.conf`; app fix is a refactor |
| 11. Swagger + dir listing | ✅ DONE (code) | `router.go` |
| 12. Auth rate limit + argon2 cap | 🟨 PARTIAL | code done; nginx `limit_req` + container `mem_limit` remain |
| 13. Track `nginx.conf` in repo | ⏸️ DEFERRED | structural: operator's deploy-process call |

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Process/low

---

## Already landed since the last revision

- **argon2id password migration** (`f006ed3`) — previously tracked here as "pending on
  `feature/argon`". It is now merged and is the parent of this branch, so that note is dropped.
  `Hash()` emits `$argon2id$` (m=64 MiB, t=1, p=4), and `Verify()` retains a bcrypt path for
  existing hashes. **This introduced a new risk — see item 12.**
- **gosec + staticcheck in CI** (`cc55be8`) — `.github/workflows/ci.yml` now runs `go test`,
  `gosec ./...`, `go fmt`, and `staticcheck ./...`. Note it triggers on `pull_request` into
  `main` only, so pushes straight to `main` are unchecked.
- **Upload path hardening** (`cc55be8`) — `os.OpenRoot`/`root.Create`/`root.Open` replace
  `filepath.Join` + `os.Create`/`http.ServeFile`, `http.MaxBytesReader` bounds the request body
  at 51 MiB, the upload dir is `0o750` instead of `0o755`, and extensions containing `/` or `\`
  are rejected. Path traversal on both upload and download is closed.

## Resolved since the last revision

- **Old item 10 (nginx config drift) — closed.** The previous revision claimed
  [frontend/nginx.conf](frontend/nginx.conf) had two extra `default_server` catch-all blocks not
  present on the server. That was wrong: the live `sites-enabled` config contains all four server
  blocks, and `diff --strip-trailing-cr` against the repo copy is clean — the two are identical
  apart from the repo file's CRLF line endings. There is no drift. The real remaining process gap
  is narrower and is now item 13.
- **Old item 8 (Permissions-Policy) — decided, not deferred.** It needed product input on whether
  calls were planned; the answer is in the code. See item 8.

Items 1, 2, 4, and 7 are unchanged. Item 3 is rewritten — the gosec pass touched that exact
handler without addressing the issue, and changed the mechanics enough that the old write-up
prescribed the wrong fix. Items 5 and 6 are confirmed but re-scoped now that the live
`nginx.conf` is visible.

---

## 🔴 1. Backend port reachable directly from the internet — ✅ DONE (code)

**Implemented 2026-09-22:** [docker-compose.yml](docker-compose.yml) now binds
`127.0.0.1:8000:8000`. Still needs a redeploy (`docker compose up -d backend`) and the
external-curl validation below — the change is inert until the container is recreated.

Was present — the previous binding was:

```yaml
    ports:
      - "8000:8000"
```

Docker binds `0.0.0.0:8000` by default. nginx reaches the backend over `127.0.0.1:8000`, so
nothing needs the public bind. Today anyone can hit `http://<server-ip>:8000/api/...` directly:
no TLS, no nginx headers, and forgeable `X-Forwarded-For`/`X-Real-IP` (the chi `RealIP`
middleware at [router.go:30](backend/internal/httpserver/router.go#L30) trusts them blindly).

This bypass also exposes routes nginx never proxies. The live config has locations for `/app`,
`/api`, `/ws`, and `/` only — so `/docs/*` (Swagger UI) and `/` (version banner) on the backend
are reachable *solely* because of this bind. See item 11.

**Fix**
```diff
  backend:
    ports:
-     - "8000:8000"
+     - "127.0.0.1:8000:8000"
```

**Validate before and after**
- [ ] Before the change, confirm the exposure from an *external* host (not the server itself):
      `curl -m 5 http://<public-ip>:8000/health` — a response confirms it's open.
- [ ] Apply the docker-compose change, `docker compose up -d backend`.
- [ ] Repeat the external curl — it should now time out / connection refused.
- [ ] Also confirm `curl -m 5 http://<public-ip>:8000/docs/index.html` is gone.
- [ ] Confirm nginx-proxied paths still work: `curl https://zchat.space/api/health` from anywhere.

**Correction to the previous revision:** it suggested `ufw` as defense in depth. That does not
work here. Docker inserts its own rules into the `DOCKER`/`DOCKER-USER` iptables chains, which
are traversed in the `FORWARD` path *before* ufw's rules, so `ufw deny 8000` does **not** block
a published container port. Don't rely on it as a second layer.
- [ ] If you want a real second layer, either add a rule to the `DOCKER-USER` chain, or lock
      port 8000 down in the cloud provider's security group (which sits outside the host and is
      unaffected by Docker's iptables handling). The `127.0.0.1` bind remains the primary fix.

---

## 🟠 2. No security response headers anywhere — ✅ DONE (code)

**Implemented 2026-09-22:** the five headers below (plus the Permissions-Policy from item 8) were
added at server level to the main HTTPS block in [frontend/nginx.conf](frontend/nginx.conf), and
`Strict-Transport-Security` was also added to the 443 `default_server` catch-all's redirect.
**This edits the repo copy only** — it reaches production when `frontend/nginx.conf` is deployed
to `/etc/nginx/sites-enabled/` (see item 13 for the tracking gap). Run `nginx -t` + reload +
the curl checks below after deploying.

Was confirmed absent from the live config: **no `add_header` directive anywhere** — not in
`/etc/nginx/nginx.conf`, not in any of the four server blocks in `sites-enabled`, and nothing in
the Go layer set `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Strict-Transport-Security`, or `Cross-Origin-Opener-Policy`.

**Applied** — added to the `server { listen 443 ssl; server_name zchat.space www.zchat.space; ... }`
block, at server level so it's inherited by `/app`, `/api`, `/ws`, and `/`:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Cross-Origin-Opener-Policy same-origin always;
```

Three nginx details, all verified against the live config:
- The `always` flag is required — without it nginx attaches `add_header` only to 2xx/3xx and
  silently skips 4xx/5xx. That matters here because `location /` is `try_files $uri $uri/ =404`.
- `add_header` inheritance is all-or-nothing per context. I checked all four `location` blocks:
  none currently sets its own `add_header`, so server-level inheritance works today. If you later
  add an `add_header` inside any `location`, that block stops inheriting **all** the server-level
  ones and you must repeat them there.
- Add `Strict-Transport-Security` to the **443 `default_server` catch-all** too. It returns a
  301 to `https://zchat.space`, and HSTS on that redirect is worth having. Don't add it to the
  port-80 blocks — HSTS over plaintext is ignored by browsers.

**Validate**
- [ ] `nginx -t` before reloading.
- [ ] After reload, `curl -sI https://zchat.space/` and `curl -sI https://zchat.space/api/health`
      and confirm all five headers appear on both.
- [ ] Check a 404 (`curl -sI https://zchat.space/nope`) to prove `always` is working.
- [ ] Confirm login, conversation load, and WebSocket connect still work. `X-Frame-Options DENY`
      is the only one with real breakage potential; nothing in this app is framed, but check.

---

## 🔴 3. Uploaded HTML is served inline from the app origin (stored XSS) — ✅ DONE (code)

**Implemented 2026-09-22, all three layers, in [upload_routes.go](backend/internal/httpserver/upload_routes.go):**
1. `forbiddenExtensions` now also rejects `.html`, `.htm`, `.xhtml`, `.shtml`, `.mhtml`, `.svg`,
   `.svgz`, `.xml`, `.xsl`, `.xslt` — uploads with those extensions get a 400.
2. `GET /api/uploads/{filename}` now sets `Content-Disposition: attachment` **unconditionally**
   (defaulting the download name to the stored UUID filename, upgraded to `original_name` only
   when the DB row exists) — a missing/failed lookup can no longer serve a file inline.
3. The filename is passed through `mime.FormatMediaType`, which safely quotes/encodes it.
   Verified by execution: `a".txt` → escaped, CRLF → RFC 2231 percent-encoded, non-ASCII →
   `filename*=utf-8''…`. No raw quote/CR/LF can reach the header value.

Fully closed at the code layer; the item-2 `nosniff` header is now redundant defence for this
(kept anyway). No deploy dependency — this ships with the backend build.

**Severity raised from 🟠, and the previous revision's reasoning was wrong.** The old text said
the `nosniff` header from item 2 "closes most of the gap". It does not. `nosniff` only stops the
browser sniffing *away from* a declared `Content-Type`; it does nothing when the declared type
is genuinely renderable. Item 2 does not mitigate this item at all.

What's actually true at `f006ed3`:

- `.html` / `.htm` / `.svg` / `.xhtml` are **not** in `forbiddenExtensions`
  ([upload_routes.go:20-24](backend/internal/httpserver/upload_routes.go#L20-L24)).
- The gosec pass swapped `http.ServeFile` for `http.ServeContent`
  ([upload_routes.go:211](backend/internal/httpserver/upload_routes.go#L211)). Both derive
  `Content-Type` from the file extension. Verified against the toolchain CI pins (go1.26):
  `mime.TypeByExtension(".html")` → `text/html; charset=utf-8`.
- `Content-Disposition: attachment` is set **only** when the `attachments` row exists with a
  non-empty `original_name`
  ([upload_routes.go:186-191](backend/internal/httpserver/upload_routes.go#L186-L191)).

The concrete exploit path, confirmed end to end:

1. `categoriseFileType(".html")` returns `"document"` (it matches `text/`), so the frontend
   renders the attachment as `<a href={fileUrl} target="_blank">`
   ([ChatWindow.jsx:665-672](frontend/src/components/Chat/ChatWindow.jsx#L665-L672)) — a
   top-level navigation, not an embed. Confirmed by executing the function rather than reading
   it: `.html` and `.htm` → `"document"`, `.xml` → `"document"`, `.svg` → `"image"`.
2. `getAttachments` has a legacy fallback that synthesises an attachment from `messages.file_path`
   when no `attachments` array is present
   ([ChatWindow.jsx:486-501](frontend/src/components/Chat/ChatWindow.jsx#L486-L501)). For those
   messages there is no `attachments` row, so the DB lookup in the download handler misses and
   **no `Content-Disposition` is sent**.
3. The victim clicks the link, the HTML renders on the `zchat.space` origin, and its script can
   read the JWT out of `localStorage`.

`.svg` is *not* exploitable via this path — `categoriseFileType(".svg")` returns `"image"`
(it matches the `image/` prefix), so it renders in an `<img>`, where scripts don't execute.
Block it anyway for defence in depth, since that classification is incidental, not deliberate.

**Fix** — all three, they're independent layers:

1. Always set `Content-Disposition: attachment` on `GET /api/uploads/{filename}`, regardless of
   the DB lookup outcome. Fall back to the stored UUID filename when `original_name` is missing.
2. Sanitise `originalName` before interpolating it. It's currently concatenated straight into a
   quoted header value (`"attachment; filename=\""+originalName+"\""`), so a `"` in the filename
   breaks out of the quoted string. Use `mime.FormatMediaType` or strip `"`, `\`, CR and LF.
3. Add `.html`, `.htm`, `.xhtml`, `.svg`, `.svgz`, `.xml`, `.xsl`, `.mhtml` to
   `forbiddenExtensions`.

**Validate**
- [ ] Upload an `.html` file containing `<script>alert(document.domain)</script>` — after the fix
      the upload itself should be rejected with 400.
- [ ] To test the header independently of the blocklist, upload a `.txt`, delete its `attachments`
      row, fetch it, and confirm `Content-Disposition: attachment` is still present.
- [ ] Upload a file named `a".txt` and confirm the response header is well-formed.
- [ ] Regression-check the normal cases: image attachments still render inline in the chat
      (`<img>` ignores `Content-Disposition`), and `<video src>` still plays — confirm range
      requests still work, since `ServeContent` handles those.

---

## 🟠 4. Auth/session responses cacheable — ✅ DONE (code)

**Implemented 2026-09-22:** a `noCacheHeaders` middleware (sets `Cache-Control: no-store`) is
applied in [router.go](backend/internal/httpserver/router.go) to the public `/api/auth`
sub-router (login, register) and to a nested group wrapping the authenticated `/api/auth/logout`
and `/api/auth/me`. Scoped to auth only — the SPA's hashed static bundles and the immutable
upload bytes are deliberately left cacheable. No deploy dependency.

Was present. Confirmed both sides: `grep -rn "Cache-Control" backend/` returned nothing, and the
live nginx config had no `expires` or `add_header Cache-Control` covering `/api`.
`/api/auth/login` and `/api/auth/me` returned a JWT and user object with no cache directives.

**Validate**
- [ ] `curl -sI` a login and a `/api/auth/me` response and confirm `Cache-Control: no-store`.
- [ ] Confirm static assets under `/` did **not** pick up `no-store`.

---

## 🟡 5. Weak TLS protocol versions in `nginx.conf` — ⏸️ DEFERRED (needs `openssl` check)

Not implemented: this lives in the http block of `/etc/nginx/nginx.conf`, which isn't tracked in
the repo (item 13), and the plan itself says to measure with `openssl` before touching it — it's
likely already overridden by the certbot include. Left for the operator.

Confirmed present in the live `/etc/nginx/nginx.conf`:
```nginx
ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
ssl_prefer_server_ciphers on;
```

**However — this is probably not actually in effect.** Both 443 server blocks
`include /etc/letsencrypt/options-ssl-nginx.conf;`, and certbot's version of that file sets
`ssl_protocols TLSv1.2 TLSv1.3;` (and `ssl_prefer_server_ciphers off;`). A `server`-level
`ssl_protocols` overrides the `http`-level one, so the live listeners are most likely TLS 1.2+
already. **Measure before assuming either way** — certbot's file has changed contents across
versions.

Fixing the `http`-level line is still worth doing: it's the default inherited by any future
server block that doesn't include the certbot file.

**Fix**
```diff
- ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
+ ssl_protocols TLSv1.2 TLSv1.3;
```

**Validate**
- [ ] Measure first: `openssl s_client -connect zchat.space:443 -tls1_1 </dev/null`. If it
      already fails, the certbot include is doing its job and this is defence in depth, not a
      live vulnerability — reprioritise accordingly.
- [ ] `grep -n ssl_protocols /etc/letsencrypt/options-ssl-nginx.conf` to confirm what the include
      actually sets.
- [ ] `nginx -t`, reload, then re-run the `-tls1_1` check (should fail) and `-tls1_2` (should
      succeed).
- [ ] Optionally run the site through Qualys SSL Labs before/after.

---

## 🟡 6. nginx version disclosure — ⏸️ DEFERRED (untracked file)

Not implemented despite being a safe one-liner: it lives in the http block of
`/etc/nginx/nginx.conf`, which isn't in the repo. Rather than make the item-13 structural decision
(where the repo's copy of `nginx.conf` should live) unprompted, this is left for the operator to
apply on the server, or after item 13 brings `nginx.conf` into the repo.

Confirmed in the live `/etc/nginx/nginx.conf` — `# server_tokens off;` is commented out in the
`http` block, so the `Server` header and default error pages leak the exact nginx version.

**Fix**
```diff
-        # server_tokens off;
+        server_tokens off;
```

**Validate**
- [ ] `curl -sI https://zchat.space/` and confirm `Server` no longer includes a version number.
- [ ] Check an error page too (`curl -s https://zchat.space/nope`) — the version appears in the
      default 404 body as well as the header.

---

## 🟡 7. Content-Security-Policy — ⏸️ DEFERRED (needs Report-Only session)

Not implemented: a wrong CSP silently breaks the SPA, so it must ride Report-Only through a full
real session before enforcement. That's a live-validation loop, not a confident one-shot change.
The candidate policy and rollout steps below are ready for whoever runs that session.

The previous revision deferred this entirely. The inputs are now gathered, so here is a candidate
policy — but it still ships in Report-Only first.

What I found:
- [frontend/index.html](frontend/index.html) has **no inline `<script>`** — just
  `<script type="module" src="/src/main.jsx">`. No `eval`, no inline event handlers.
- `style={{...}}` appears in three components. React sets those via CSSOM, which CSP does not
  govern, so they do **not** require `'unsafe-inline'`.
- `emoji-mart` v5 injects a `<style>` element at runtime, which **does** require
  `style-src 'unsafe-inline'` (or a nonce). This is the one concession in the policy below.
- A service worker is served from `/sw.js` (push notifications) → needs `worker-src 'self'`.
- `URL.createObjectURL` is used for image previews
  ([ChatWindow.jsx:373](frontend/src/components/Chat/ChatWindow.jsx#L373)) → needs `blob:` in
  `img-src`.
- `i18next-http-backend` loads translation JSON from the same origin → `connect-src 'self'`.
- WebRTC uses Google and Twilio STUN servers
  ([CallContext.jsx:14-19](frontend/src/contexts/CallContext.jsx#L14-L19)). STUN/TURN is **not**
  governed by `connect-src`, so no entry is needed — don't add `stun:` URLs, they're ignored.

**Candidate policy to test in Report-Only**
```nginx
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
```

**Steps**
- [ ] Build the frontend (`npm run build`) and grep `dist/index.html` for inline `<script>` —
      Vite normally emits only external module scripts, but confirm for this config.
- [ ] Deploy Report-Only, then exercise a full session: login, send/edit/delete a message, upload
      and download a file, add a reaction, open the emoji picker, switch language, switch theme,
      place a call, and force a WebSocket reconnect. Watch the console for violations.
- [ ] Watch specifically for `cdn.jsdelivr.net` — emoji-mart falls back to fetching data/i18n
      from there when it isn't supplied locally. `@emoji-mart/data` is passed via the `data` prop
      so it shouldn't fire, but confirm rather than assume.
- [ ] Only switch `Content-Security-Policy-Report-Only` → `Content-Security-Policy` after a full
      session shows zero violations.
- [ ] `frame-ancestors 'none'` supersedes `X-Frame-Options DENY` from item 2 in modern browsers;
      keep both, they don't conflict.

---

## 🟡 8. Permissions-Policy — ✅ DONE (code)

**Implemented 2026-09-22:** added to the main HTTPS block in
[frontend/nginx.conf](frontend/nginx.conf) alongside the item-2 headers:
`add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" always;`
— `microphone=(self)` kept open for the shipped voice-call feature; `camera` closed until video
lands. Deploys with `frontend/nginx.conf`; test with a real call after deploy.

The previous revision flagged this as needing product input on whether calls were planned.
**Answered from the code: WebRTC voice calling is already implemented and shipped.**
[CallContext.jsx](frontend/src/contexts/CallContext.jsx) calls
`getUserMedia({ audio: true, video: false })` at lines 149 and 178 and constructs an
`RTCPeerConnection` at line 109. The backend already relays `call_offer` / `call_answer` /
`ice_candidate` / `call_end` / `call_rejected` over the WebSocket hub.

So `microphone` must stay open for the app's own origin. `camera` is unused today (audio-only)
but is the obvious next feature — expect to revisit this line if video lands.

**Fix**
```nginx
add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" always;
```

**Validate**
- [ ] `curl -sI https://zchat.space/` and confirm the header is present.
- [ ] Place an actual voice call end to end and confirm the mic permission prompt still appears
      and audio flows — this is the one header in this plan that can break a working feature.

---

## 🟡 9. `CORS_ORIGINS` value in production — ⏸️ DEFERRED (needs on-server check)

Not implemented: the only thing that matters is the deployed `.env`, which can't be read from the
repo. The `.env.example` default is already correct. Left for an on-server check.

Partly resolved. [.env.example](.env.example) now ships
`CORS_ORIGINS=https://zchat.space,https://www.zchat.space`, which is correct. Two gaps remain:

- [docker-compose.yml:34](docker-compose.yml#L34) still falls back to
  `${CORS_ORIGINS:-http://localhost:3000,http://localhost:5173}`, and
  [config.go:83](backend/internal/config/config.go#L83) has the same localhost default. If the
  production `.env` is missing the key, prod silently runs with localhost origins.
- The deployed `.env` is the only thing that matters and can't be read from the repo.

⚠️ **Needs an on-server check.**

**Validate**
- [ ] `docker compose exec backend printenv CORS_ORIGINS` on the server — confirm it's the
      zchat.space value, not the localhost fallback.
- [ ] Confirm it isn't `*`. `AllowCredentials: true` is hardcoded at
      [router.go:40](backend/internal/httpserver/router.go#L40); browsers reject that combination
      anyway, but don't leave it misconfigured.
- [ ] Sanity-check with a forged Origin:
      `curl -sI -H "Origin: https://evil.example" https://zchat.space/api/health` — there should
      be no `Access-Control-Allow-Origin` in the response.

---

## 🟠 10. JWT passed in the URL query string for file downloads — ⏸️ DEFERRED

Not implemented. None of the three fixes is a confident one-shot: the log-redaction fix needs a
`log_format` in the untracked http-level `nginx.conf`; the client-side fix is a real refactor
(`<img>`/`<video>` can't send an `Authorization` header, so every attachment would have to move to
`fetch` + object URLs, with image-rendering breakage risk); and the download-scoped-token fix is a
new backend token type. Left for a dedicated change. **Also purge existing access logs** — they
already contain live tokens.

Not in the previous revision. [api.js:102-105](frontend/src/services/api.js#L102-L105) builds
download URLs as `${API_BASE_URL}/uploads/${filename}?token=${token}`, and the handler accepts
`?token=` as an alternative to the `Authorization` header
([upload_routes.go:160-167](backend/internal/httpserver/upload_routes.go#L160-L167)).

These are full-privilege access tokens with a 24-hour TTL (30 days with remember-me), and query
strings land in places request headers don't. The live nginx config uses the stock
`access_log /var/log/nginx/access.log;` with the default `combined` format, which logs
`$request` — **including the full query string**. So every attachment view writes a valid JWT to
disk in cleartext. Every `<img src>` and `<video src>` in the chat carries one.

**Fix** — pick one, roughly in order of effort:
- Short term: define a `log_format` that omits the query string for `/api/uploads`, or a `map`
  that rewrites `token=[^&]*` out of the logged request.
- Better: fetch attachments via `axios` with the `Authorization` header and render from an object
  URL, so no token ever enters a URL. More work for `<img>`/`<video>`, which can't send headers.
- Best: issue a short-lived (60s), download-scoped token for this route instead of reusing the
  session JWT, and keep the `?token=` mechanism for it.

**Validate**
- [ ] `grep -c 'token=' /var/log/nginx/access.log*` — this tells you both that the exposure is
      real and how far back it goes. Rotate/purge those logs after fixing.
- [ ] After the fix, open an image attachment and confirm no `token=` appears in the access log.

---

## 🟡 11. Unauthenticated Swagger UI and static file server on the backend — ✅ DONE (code)

**Implemented 2026-09-22, in [router.go](backend/internal/httpserver/router.go):**
- `/docs/*` (Swagger) is now registered only when `cfg.Debug` is true — off in production
  (`DEBUG=false` in the compose file), so it can't be re-exposed by a future nginx location or a
  reverted port bind.
- `/app/*` is wrapped so any directory-listing request (path ending in `/`) returns 404, instead
  of relying on an `index.html` placeholder. This covers `app/` and every subdirectory, so the
  contents are no longer enumerable while individual file downloads still work.

No deploy dependency beyond the backend build. Note production must run `DEBUG=false` for the
Swagger gate to take effect — the compose file already defaults it to `false`.

Was present.
[router.go](backend/internal/httpserver/router.go) registered `/docs/*` (Swagger UI, serving the
full API surface) and `/app/*` (`http.FileServer(http.Dir("app"))` for APK downloads), both
unauthenticated and neither gated on `cfg.Debug`.

Scoping this accurately against the live config: nginx has locations for `/app`, `/api`, `/ws`,
and `/` only, so `/docs` falls through to `try_files $uri $uri/ =404` and is **not** reachable
via `https://zchat.space`. It is exposed only through the direct `:8000` bind, which means
**item 1 closes it**. Hence 🟡, not higher.

`/app/*` *is* proxied and *is* public. `http.Dir` blocks traversal, so the exposure is limited to
a directory listing of `backend/app/` when no `index.html` is present.

**Fix**
- [ ] Do item 1 first; recheck whether `/docs` is reachable at all afterwards.
- [ ] Then gate the Swagger route on `cfg.Debug` so it can't be re-exposed by a future nginx
      location or a reverted port bind.
- [ ] `ls backend/app/` and confirm nothing beyond the intended APK is there; add an empty
      `index.html` to suppress the listing.

**Validate**
- [ ] `curl -s https://zchat.space/docs/index.html` → 404.
- [ ] `curl -s https://zchat.space/app/` → no directory listing.

---

## 🟠 12. No rate limiting on auth, now amplified by argon2id — 🟨 PARTIAL

**Implemented 2026-09-22 (code side — the parts that actually cap the DoS):**
- **argon2 concurrency ceiling** in [password.go](backend/internal/security/password.go): a
  `GOMAXPROCS`-sized semaphore (min 2) wraps *both* the `Hash` and `verifyArgon2id` derivations.
  Peak argon2 memory is now `cap × 64 MiB` regardless of request volume; excess requests queue as
  ~KB goroutines instead of each grabbing 64 MiB. Wrapping the verify path matters most — a login
  against an existing user hits verify, not hash. Verified deadlock-free under 50 concurrent
  hash+verify with `-race`.
- **Per-IP rate limit** on `/api/auth/*` in [router.go](backend/internal/httpserver/router.go):
  `httprate.LimitBy(10, time.Minute, keyByResolvedIP)`. Used the non-deprecated `LimitBy` +
  `CanonicalizeIP` API with an explicit key func (chi is v5.1.0, so the newer
  `middleware.ClientIPFrom*` helpers the deprecation recommends aren't available — a chi upgrade
  was out of scope for a confident change). Keys off `r.RemoteAddr` as resolved by the existing
  `middleware.RealIP`; trustworthy once item 1 is deployed.
- **Bounded request body** on login and register
  ([auth_handlers.go](backend/internal/httpserver/auth_handlers.go)): `http.MaxBytesReader` at 4 KB.

**Still remaining (deploy-side, left for the operator):**
- nginx `limit_req_zone` + `limit_req` on `location /api` as an outer shed layer — needs the
  untracked http-level `nginx.conf` (item 13).
- Container `mem_limit` / `deploy.resources.limits.memory` on the backend service — deliberately
  not set, because sizing it needs the "measure with `docker stats`" step the validation calls for;
  too low a limit would OOM the backend under normal load. The argon2 semaphore already provides
  the hard ceiling for the specific DoS vector, so this is belt-and-suspenders.

Was verified absent on both sides: no `httprate` or equivalent in the chi middleware stack, and no
`limit_req` / `limit_conn` / `limit_req_zone` anywhere in the live nginx config.

Two consequences, and the second is new:

1. **Credential brute force.** `POST /api/auth/login` is unauthenticated and unthrottled, with no
   lockout or backoff. Argon2id makes each guess expensive, which helps — but it doesn't cap
   attempt volume.
2. **Memory-exhaustion DoS.** This is the new one. Argon2id is configured at
   `argon2Memory = 64 * 1024` KiB — 64 MiB allocated *per hash operation*
   ([password.go:14-19](backend/internal/security/password.go#L14-L19)), with `p=4`. bcrypt used
   ~4 KiB. An unauthenticated attacker can now drive ~64 MiB of allocation per request against
   `/api/auth/login` and `/api/auth/register`; a few hundred concurrent requests is tens of GB
   and OOM-kills the container. The chi `Timeout(60s)` middleware does not help — it cancels the
   handler's context but doesn't abort the in-flight argon2 computation or free its buffer.

These parameters are a reasonable choice for hash strength; the problem is purely that nothing
bounds concurrency in front of them.

**Fix**
- [ ] Rate-limit the auth routes. `github.com/go-chi/httprate` is the least-friction option given
      the existing chi stack — something like 10 requests/minute per IP on `/api/auth/*`. Apply it
      *after* `RealIP`, and note it only becomes trustworthy once item 1 lands and
      `X-Forwarded-For` can no longer be forged by bypassing nginx entirely.
- [ ] Add a semaphore (buffered channel) bounding concurrent argon2 hash operations to a small
      multiple of `GOMAXPROCS`, so memory use has a hard ceiling independent of request volume.
      This is the part that actually fixes the DoS — rate limiting is per-IP and a distributed
      source walks around it.
- [ ] Add `limit_req_zone` + `limit_req` in nginx for `location /api` (or a dedicated
      `location /api/auth/`) as an outer layer, so traffic is shed before it reaches Go.
- [ ] Set a memory limit on the backend container (`mem_limit` / `deploy.resources.limits.memory`)
      so an OOM is contained to the backend rather than taking the host — and nginx and the
      frontend static files with it, since both run directly on that host.
- [ ] Minor, while you're in the handler: `handleLogin` decodes an unbounded body
      ([auth_handlers.go:87](backend/internal/httpserver/auth_handlers.go#L87)). Wrap it in
      `http.MaxBytesReader` the way the upload route now does.

**Validate**
- [ ] Measure first: loop `curl -s -o /dev/null -X POST -d '{"username":"x","password":"y"}' https://zchat.space/api/auth/login`
      from a single host while watching `docker stats` — confirm the memory growth is real before
      sizing the semaphore.
- [ ] After the fix, confirm the same loop gets 429s and that backend RSS stays flat.
- [ ] Confirm a legitimate login still succeeds and that the limit isn't so tight that a
      shared-NAT office IP trips it.

---

## ⚪ 13. The `http`-level nginx config isn't tracked in the repo — ⏸️ DEFERRED (structural)

Not implemented: deciding where the repo's authoritative `nginx.conf` should live and how it's
deployed is the operator's call about their deploy process, not something to impose unprompted.
This is the blocker for items 5, 6, and 10's log fix — all of which live in the untracked
http-level config. Resolving item 13 unblocks them.

The drift the previous revision described doesn't exist — `frontend/nginx.conf` matches
`/etc/nginx/sites-enabled/` exactly. The narrower real gap: items 5 and 6 both live in
`/etc/nginx/nginx.conf`, which **is not in the repo at all**, so those two fixes can only be made
by editing the server directly and will be silently lost on any host rebuild.

Two smaller things worth fixing while touching these files:
- `location /app` proxies to `http://localhost:8000` while `/api` and `/ws` use
  `http://127.0.0.1:8000`. `localhost` can resolve to `::1` first, which the container's IPv4
  `0.0.0.0` publish doesn't cover. Make all three `127.0.0.1` — this also matters for item 1,
  since the `127.0.0.1:8000:8000` bind is IPv4-only.
- `location /api` sets `proxy_set_header Connection 'upgrade';` unconditionally, so every plain
  REST request advertises an upgrade it never makes. Use the standard
  `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` idiom, or drop the
  Upgrade/Connection headers from `/api` entirely — WebSockets go to `/ws`. Not a security issue,
  but it interacts with `proxy_cache_bypass $http_upgrade` on the same block.

**Steps**
- [ ] Move the nginx files somewhere honest. `frontend/nginx.conf` is a confusing home now that
      the frontend isn't containerized — consider `deploy/nginx/` with both `nginx.conf` and
      `sites-available/zchat.space`, and note the deploy step in `deployment.md`.
- [ ] Apply every nginx change from items 2, 5, 6, 7, and 8 to the repo copies first, then deploy
      them — so the changes are diffable and reviewed instead of drifting for real next time.

---

## Remaining work (after the 2026-09-22 code pass)

The confident, code-side items (1, 2, 3, 4, 8, 11, and the code half of 12) are already in the
working tree. What's left:

**A. Deploy + validate the code that's done.**
1. Redeploy the backend (`docker compose up -d backend`) so item 1's loopback bind, item 3/4/11's
   handler changes, and item 12's rate-limit/semaphore take effect. Confirm `DEBUG=false` in prod
   so item 11's Swagger gate holds. Then run the per-item validation curls.
2. Deploy `frontend/nginx.conf` to `/etc/nginx/sites-enabled/` (items 2 + 8): `nginx -t`, reload,
   curl the headers, and place a real voice call to confirm `microphone=(self)` still works.

**B. Operator decisions / live-server work (deferred items).**
3. **Item 13 first** — decide where the repo's `nginx.conf` lives. It unblocks 5, 6, and 10's log
   fix. While there, fix the `localhost` → `127.0.0.1` mismatch in `location /app` (matters for
   item 1's IPv4-only bind).
4. **Item 5** — run the `openssl -tls1_1` check; it may already be mitigated by the certbot include.
5. **Item 6** (`server_tokens off`) — one line once item 13 gives it a home.
6. **Item 9** — check the deployed `CORS_ORIGINS` on the server.
7. **Item 12 tail** — nginx `limit_req` outer layer; size a container `mem_limit` after measuring.
8. **Item 10** — purge existing access logs now (they hold live tokens); schedule the real fix.
9. **Item 7** (CSP) — Report-Only for a full session, then enforce.
