#!/usr/bin/env python3
"""HTTP/container checks for the selected disposable static-client stack.

Requires seeded accounts. The live SSE check takes about 80 seconds: it verifies
four 20-second pings through nginx, including survival past the old 60s timeout.
"""
import gzip
from html.parser import HTMLParser
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from seed import assert_stack_owner
from settings import BASE, ENV_FILE, FRONTEND, PROJECT, REPO, STATE


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


def fetch(path, headers=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = dict(headers or {})
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, headers=headers, data=data)
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


def check_stream(token):
    status, _, body = fetch('/api/events/ticket',
                            {'Authorization': 'Bearer ' + token}, {})
    assert status == 200, ('SSE ticket', status)
    ticket = json.loads(body)
    assert ticket['expires_in'] == 30
    path = '/api/events?' + urllib.parse.urlencode({'ticket': ticket['ticket']})
    started = time.monotonic()
    req = urllib.request.Request(BASE + path, headers={'Accept-Encoding': 'gzip'})
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
            with urllib.request.urlopen(BASE + path, timeout=5) as reused:
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


def check():
    assert_stack_owner()
    results = []
    health = subprocess.run(['docker', 'exec', FRONTEND, 'wget', '-qO-',
                             'http://backend:8000/health'], capture_output=True, check=True)
    assert json.loads(health.stdout) == {'status': 'healthy'}, 'Backend network health failed'
    # Check the effective configuration too: live latency alone cannot establish
    # every proxy directive, and nginx consumes the X-Accel-Buffering header.
    config = subprocess.run(['docker', 'exec', FRONTEND, 'nginx', '-T'],
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

    status, headers, _ = fetch('/api/auth/me')
    assert status == 401, ('Unauthenticated API', status)
    security_headers(headers)
    source_gzip = wire_gzip = 0
    for path in ('/index.html', '/app.js'):
        source = (REPO / 'frontend' / path.lstrip('/')).read_bytes()
        status, headers, body = fetch(path)
        assert status == 200 and body == source, ('Static source mismatch', path, status)
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        assert headers.get_content_type() == ('text/html' if path.endswith('.html') else 'application/javascript')
        security_headers(headers)
        etag = headers.get('ETag')
        assert etag, ('Missing ETag', path)
        status, cached, _ = fetch(path, {'If-None-Match': etag})
        assert status == 304 and cached.get('Cache-Control') == 'no-cache', (path, status)
        security_headers(cached)
        status, compressed, body = fetch(path, {'Accept-Encoding': 'gzip'})
        assert status == 200 and compressed.get('Content-Encoding') == 'gzip', (path, dict(compressed))
        assert 'accept-encoding' in compressed.get('Vary', '').lower()
        assert gzip.decompress(body) == source
        source_gzip += len(gzip.compress(source, compresslevel=9, mtime=0))
        wire_gzip += len(body)
        results.append({'path': path, 'bytes': len(source), 'gzip_bytes': len(body),
                        'etag': etag, 'conditional_status': 304})
    assert source_gzip <= 8192, f'Client exceeds 8 KiB gzip budget: {source_gzip}'
    assert wire_gzip <= 8192, f'HTTP client exceeds 8 KiB gzip budget: {wire_gzip}'
    status, headers, root = fetch('/')
    assert status == 200 and root == (REPO / 'frontend/index.html').read_bytes()
    assert headers.get('Cache-Control') == 'no-cache' and headers.get('ETag')
    security_headers(headers)
    assets = Assets()
    assets.feed(root.decode())
    assert assets.paths in (['/app.js'], ['app.js']), ('Unexpected static requests', assets.paths)
    assert not assets.inline_script, 'Inline scripts violate CSP'
    for path in ('/missing', '/c/1', '/manifest.webmanifest', '/sw.js', '/theme-init.js',
                 '/icons/icon-192.png', '/50x.html'):
        status, headers, _ = fetch(path)
        assert status == 404, ('Unexpected static file or SPA fallback', path, status)
        security_headers(headers)

    values = dict(line.split('=', 1) for line in ENV_FILE.read_text().splitlines() if '=' in line)
    status, _, body = fetch('/api/auth/login', payload={
        'username': 'alice_ui', 'password': values['E2E_PASSWORD']})
    assert status == 200, ('Seeded login', status)
    token = json.loads(body)['access_token']
    status, headers, body = fetch('/api/conversations/', {
        'Authorization': 'Bearer ' + token, 'Accept-Encoding': 'gzip'})
    assert status == 200 and headers.get('Content-Encoding') == 'gzip', 'JSON must be gzipped'
    assert isinstance(json.loads(gzip.decompress(body)), list)
    status, _, _ = fetch('/api/events')
    assert status == 401, ('Missing SSE ticket', status)
    results.append(check_stream(token))

    names = [f'{PROJECT}-{service}-1' for service in ('frontend', 'backend', 'postgres')]
    inspected = subprocess.run(['docker', 'container', 'inspect', *names], capture_output=True, check=True)
    metadata = {}
    for container in json.loads(inspected.stdout):
        name = container['Name'].lstrip('/')
        labels = container['Config']['Labels']
        service = labels['com.docker.compose.service']
        assert labels['com.docker.compose.project'] == PROJECT
        assert container['State']['Running'], name
        volumes = [m['Name'] for m in container['Mounts'] if m['Type'] == 'volume']
        assert all(volume.startswith(PROJECT + '_') for volume in volumes), volumes
        metadata[name] = {'container_id': container['Id'], 'image_id': container['Image'], 'volumes': volumes}
        if service in ('frontend', 'backend'):
            image = subprocess.run(['docker', 'image', 'inspect', f'{PROJECT}-{service}:local'],
                                   capture_output=True, check=True)
            assert container['Image'] == json.loads(image.stdout)[0]['Id'], 'Container uses stale image'
            assert container['Config']['User'] not in ('', '0', 'root'), 'Container must run non-root'
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True, check=True).stdout.decode().strip()
    report = {'passed': True, 'project': PROJECT, 'base_url': BASE, 'source_head_at_verification': head,
              'containers': metadata, 'client_gzip_bytes': source_gzip, 'http_gzip_bytes': wire_gzip,
              'checks': results}
    (STATE / 'http-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    check()
