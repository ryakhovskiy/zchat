#!/usr/bin/env python3
"""HTTP/container checks for the selected disposable dual-client stack.

Requires seeded accounts. The live SSE check takes about 80 seconds: it verifies
four 20-second pings through nginx, including survival past the old 60s timeout.
"""
import gzip
from html.parser import HTMLParser
import json
import re
import subprocess
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from seed import assert_stack_owner
from settings import (BASE, ENV_FILE, LITE_BASE, LITE_FRONTEND,
                      LITE_PORT, PORT, PROJECT, REPO, STATE)


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.inline_script = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and not attrs.get('src'):
            self.inline_script = True
        for name in ('src', 'href'):
            value = attrs.get(name, '')
            if value and not value.startswith(('#', 'data:')):
                self.paths.append(value)


def fetch(base, path, headers=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = dict(headers or {})
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()


def security_headers(headers):
    csp = headers.get('Content-Security-Policy', '')
    for directive in ("default-src 'self'", "script-src 'self'", "connect-src 'self'",
                      "img-src 'self' data:", "object-src 'none'", "frame-ancestors 'none'"):
        assert directive in csp, ('Missing CSP directive', directive)
    assert "'unsafe-inline'" not in csp.split('script-src ', 1)[1].split(';')[0]
    assert headers.get('X-Content-Type-Options') == 'nosniff'
    assert headers.get('X-Frame-Options') == 'DENY'
    policy = headers.get('Permissions-Policy', '')
    assert 'microphone=()' in policy and 'camera=()' in policy


def check_stream(base, token):
    status, _, body = fetch(base, '/api/events/ticket',
                            {'Authorization': 'Bearer ' + token}, {})
    assert status == 200, ('SSE ticket', status)
    ticket = json.loads(body)
    assert ticket['expires_in'] == 30
    path = '/api/events?' + urllib.parse.urlencode({'ticket': ticket['ticket']})
    started = time.monotonic()
    req = urllib.request.Request(base + path, headers={'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=27) as response:
        assert response.headers.get_content_type() == 'text/event-stream'
        assert response.headers.get('Cache-Control') == 'no-cache'
        assert not response.headers.get('Content-Encoding'), 'SSE must not be compressed'
        security_headers(response.headers)
        # nginx consumes X-Accel-Buffering; immediate frames prove it is unbuffered.
        assert response.readline().strip() == b'retry: 5000', 'Missing initial SSE retry'
        initial_delay = time.monotonic() - started
        assert initial_delay < 5, f'SSE initial frame buffered for {initial_delay:.1f}s'
        # Test single-use while the ticket is still within its 30-second TTL.
        # Read only headers: a broken implementation may open another SSE stream.
        try:
            with urllib.request.urlopen(base + path, timeout=5) as reused:
                reused_status = reused.status
        except urllib.error.HTTPError as reused:
            reused_status = reused.code
            reused.close()
        assert reused_status == 401, ('Reused live ticket must be rejected', reused_status)
        pings = []
        previous = started
        while len(pings) < 4:
            line = response.readline()
            assert line, 'SSE closed before four pings (must survive 60 seconds)'
            if line.strip() == b': ping':
                now = time.monotonic()
                interval = now - previous
                assert 15 <= interval <= 27, f'SSE ping interval {interval:.1f}s'
                pings.append(round(now - started, 2))
                previous = now
        assert pings[-1] >= 75, pings
    return {'sse_initial_delay_seconds': round(initial_delay, 3),
            'ping_seconds': pings, 'compressed': False, 'reused_ticket_status': reused_status}


def check_lite(base):
    results = []
    health = subprocess.run(['docker', 'exec', LITE_FRONTEND, 'wget', '-qO-',
                             'http://backend:8000/health'], capture_output=True, check=True)
    assert json.loads(health.stdout) == {'status': 'healthy'}, 'Backend network health failed'
    # Check the effective configuration too: live latency alone cannot establish
    # every proxy directive, and nginx consumes the X-Accel-Buffering header.
    config = subprocess.run(['docker', 'exec', LITE_FRONTEND, 'nginx', '-T'],
                            capture_output=True, text=True, check=True).stdout
    stream_location = re.search(r'location = /api/events\s*\{([^}]+)\}', config)
    assert stream_location, 'Missing exact SSE location'
    for directive in ('proxy_buffering off;', 'gzip off;', 'proxy_read_timeout 1h;',
                      'proxy_set_header Connection "";', 'proxy_set_header Upgrade "";',
                      'proxy_set_header Accept-Encoding "";'):
        assert directive in stream_location[1], ('SSE config missing', directive)
    for name in ('Host', 'True-Client-IP', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Proto'):
        assert f'proxy_set_header {name} ' in stream_location[1], name
    results.append({'backend_network_health': 'healthy', 'nginx_config': 'passed'})

    status, headers, _ = fetch(base, '/api/auth/me')
    assert status == 401, ('Unauthenticated API', status)
    security_headers(headers)
    source_gzip = wire_gzip = 0
    for path in ('/index.html', '/app.js'):
        source = (REPO / 'frontend-lite' / path.lstrip('/')).read_bytes()
        status, headers, body = fetch(base, path)
        assert status == 200 and body == source, ('Static source mismatch', path, status)
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        assert headers.get_content_type() == ('text/html' if path.endswith('.html') else 'application/javascript')
        security_headers(headers)
        etag = headers.get('ETag')
        assert etag, ('Missing ETag', path)
        status, cached, _ = fetch(base, path, {'If-None-Match': etag})
        assert status == 304 and cached.get('Cache-Control') == 'no-cache', (path, status)
        security_headers(cached)
        status, compressed, body = fetch(base, path, {'Accept-Encoding': 'gzip'})
        assert status == 200 and compressed.get('Content-Encoding') == 'gzip', (path, dict(compressed))
        assert 'accept-encoding' in compressed.get('Vary', '').lower()
        assert gzip.decompress(body) == source
        source_gzip += len(gzip.compress(source, compresslevel=9, mtime=0))
        wire_gzip += len(body)
        results.append({'path': path, 'bytes': len(source), 'gzip_bytes': len(body),
                        'etag': etag, 'conditional_status': 304})
    assert source_gzip <= 8192, f'Client exceeds 8 KiB gzip budget: {source_gzip}'
    assert wire_gzip <= 8192, f'HTTP client exceeds 8 KiB gzip budget: {wire_gzip}'
    status, headers, root = fetch(base, '/')
    assert status == 200 and root == (REPO / 'frontend-lite/index.html').read_bytes()
    assert headers.get('Cache-Control') == 'no-cache' and headers.get('ETag')
    security_headers(headers)
    assets = Assets()
    assets.feed(root.decode())
    assert assets.paths in (['/app.js'], ['app.js']), ('Unexpected static requests', assets.paths)
    assert not assets.inline_script, 'Inline scripts violate CSP'
    for path in ('/missing', '/c/1', '/manifest.webmanifest', '/sw.js', '/theme-init.js',
                 '/icons/icon-192.png', '/50x.html'):
        status, headers, _ = fetch(base, path)
        assert status == 404, ('Unexpected static file or SPA fallback', path, status)
        security_headers(headers)

    values = dict(line.split('=', 1) for line in ENV_FILE.read_text().splitlines() if '=' in line)
    status, _, body = fetch(base, '/api/auth/login', payload={
        'username': 'alice_ui', 'password': values['E2E_PASSWORD']})
    assert status == 200, ('Seeded login', status)
    token = json.loads(body)['access_token']
    status, headers, body = fetch(base, '/api/conversations/', {
        'Authorization': 'Bearer ' + token, 'Accept-Encoding': 'gzip'})
    assert status == 200 and headers.get('Content-Encoding') == 'gzip', 'JSON must be gzipped'
    assert isinstance(json.loads(gzip.decompress(body)), list)
    status, _, _ = fetch(base, '/api/events')
    assert status == 401, ('Missing SSE ticket', status)
    results.append(check_stream(base, token))

    return {'client_gzip_bytes': source_gzip, 'http_gzip_bytes': wire_gzip,
            'checks': results}


def check_react(base):
    results = []
    status, _, _ = fetch(base, '/api/auth/me')
    assert status == 401, ('Unauthenticated React API', status)
    results.append({'url': base + '/api/auth/me', 'status': status})

    for path in ['/', '/index.html', '/theme-init.js']:
        status, headers, body = fetch(base, path)
        assert status == 200, (path, status)
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        if path.endswith('.js'):
            assert headers.get_content_type() == 'application/javascript', dict(headers)
            assert body == (REPO / 'frontend/public/theme-init.js').read_bytes(), 'Init file differs from source'
        results.append({'url': base + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'), 'bytes': len(body)})

    _, _, index = fetch(base, '/index.html')
    html = index.decode()
    assert re.search(r'<script\s+src="/theme-init\.js"\s*></script>', html), 'Missing blocking external theme init'
    assert html.index('/theme-init.js') < html.index('type="module"'), 'Init must precede app module'
    assets = sorted(set(re.findall(r'(?:src|href)="(/assets/[^\"]+\.(?:js|css))"', html)))
    assert len(assets) >= 2, 'Expected hashed JS and CSS assets'
    for path in assets:
        status, headers, body = fetch(base, path)
        assert status == 200, (path, status)
        assert headers.get('Cache-Control') == 'public, max-age=31536000, immutable', (path, dict(headers))
        results.append({'url': base + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'), 'bytes': len(body)})

    manifest = REPO / 'frontend/public/manifest.webmanifest'
    assert manifest.is_file(), 'Required manifest source is missing'
    assert re.search(r'<link\s+rel="manifest"\s+href="/manifest\.webmanifest"', html), 'Missing manifest link'
    assert re.search(r'<link\s+rel="apple-touch-icon"\s+href="/icons/icon-192\.png"', html), 'Missing Apple touch icon'
    status, headers, body = fetch(base, '/manifest.webmanifest')
    assert status == 200, status
    assert headers.get_content_type() == 'application/manifest+json', dict(headers)
    assert headers.get('Cache-Control') == 'no-cache', dict(headers)
    manifest_data = json.loads(body)
    assert manifest_data == json.loads(manifest.read_text()), 'Manifest differs from source'
    results.append({'url': base + '/manifest.webmanifest', 'status': status,
                    'content_type': headers.get('Content-Type'),
                    'cache_control': headers.get('Cache-Control')})
    assert len(manifest_data['icons']) == 3, 'Expected all three PWA icons'
    for icon in manifest_data['icons']:
        path = icon['src']
        assert path.startswith('/icons/'), path
        status, headers, body = fetch(base, path)
        assert status == 200, (path, status)
        assert headers.get_content_type() == 'image/png', (path, dict(headers))
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        assert body == (REPO / 'frontend/public' / path.lstrip('/')).read_bytes(), 'Icon differs from source'
        assert body[:8] == b'\x89PNG\r\n\x1a\n', 'Icon is not PNG'
        width, height = struct.unpack('>II', body[16:24])
        assert f'{width}x{height}' == icon['sizes'], (path, width, height)
        results.append({'url': base + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'),
                        'dimensions': f'{width}x{height}', 'bytes': len(body)})
    return {'entry_assets': assets, 'checks': results}


def check_containers():
    # Runtime safety gates must remain active under PYTHONOPTIMIZE.
    def require_owned(condition, detail):
        if not condition:
            raise RuntimeError('Refusing shared-account writes: ' + detail)

    # Verify BOTH published listeners before any shared-account fixture writes.
    names = [f'{PROJECT}-{service}-1' for service in
             ('frontend', 'frontend-lite', 'backend', 'postgres')]
    inspected = subprocess.run(['docker', 'container', 'inspect', *names],
                               capture_output=True, check=True)
    metadata = {}
    for container in json.loads(inspected.stdout):
        name = container['Name'].lstrip('/')
        labels = container['Config']['Labels']
        service = labels['com.docker.compose.service']
        require_owned(labels['com.docker.compose.project'] == PROJECT, 'Unexpected Compose project')
        require_owned(name == f'{PROJECT}-{service}-1' and name in names, 'Unexpected container identity')
        require_owned(container['State']['Running'], name + ' is not running')
        volumes = [m['Name'] for m in container['Mounts'] if m['Type'] == 'volume']
        require_owned(all(volume.startswith(PROJECT + '_') for volume in volumes),
                      'Unowned volume in ' + name)
        require_owned(all(m['Type'] != 'bind' for m in container['Mounts']),
                      'E2E must not bind host data')
        if service in ('frontend', 'frontend-lite'):
            port = PORT if service == 'frontend' else LITE_PORT
            require_owned(container['NetworkSettings']['Ports']['8080/tcp'] == [
                {'HostIp': '127.0.0.1', 'HostPort': port}], 'Unexpected frontend listener')
        if service in ('frontend', 'frontend-lite', 'backend'):
            image = subprocess.run(['docker', 'image', 'inspect', f'{PROJECT}-{service}:local'],
                                   capture_output=True, check=True)
            require_owned(container['Image'] == json.loads(image.stdout)[0]['Id'],
                          'Container uses stale image')
            require_owned(container['Config']['User'] not in ('', '0', 'root'),
                          'Container must run non-root')
        metadata[name] = {'container_id': container['Id'], 'image_id': container['Image'], 'volumes': volumes}
    require_owned(set(metadata) == set(names), 'Missing or duplicate container metadata')
    return metadata


def check_shared_backend():
    values = dict(line.split('=', 1) for line in ENV_FILE.read_text().splitlines() if '=' in line)
    # Fixed fixture username keeps repeated verification below the registration cap.
    credentials = {'username': 'dual_http_check', 'password': values['E2E_PASSWORD']}
    status, _, body = fetch(BASE, '/api/auth/register', payload=credentials)
    assert status in (200, 201, 400), ('Register through React port', status)
    if status == 400:
        status, _, body = fetch(BASE, '/api/auth/login', payload=credentials)
        assert status == 200, ('Existing shared fixture login', status)
    full = json.loads(body)
    status, _, body = fetch(LITE_BASE, '/api/auth/login', payload=credentials)
    assert status == 200, ('Cross-port login', status)
    lite = json.loads(body)
    assert full['user']['id'] == lite['user']['id'], 'Frontends do not share accounts'
    status, _, body = fetch(BASE, '/api/auth/me',
                            {'Authorization': 'Bearer ' + lite['access_token']})
    assert status == 200 and json.loads(body)['id'] == full['user']['id']
    return {'cross_port_registration_login': True, 'cross_port_bearer': True}


def check():
    assert_stack_owner()
    metadata = check_containers()
    react = check_react(BASE)
    shared = check_shared_backend()
    lite = check_lite(LITE_BASE)
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO,
                          capture_output=True, check=True).stdout.decode().strip()
    report = {'passed': True, 'project': PROJECT, 'base_url': BASE, 'lite_url': LITE_BASE,
              'source_head_at_verification': head, 'containers': metadata,
              'react': react, 'lite': lite, 'shared_backend': shared}
    (STATE / 'http-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    check()
