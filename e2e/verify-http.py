#!/usr/bin/env python3
"""Read-only production HTTP and container checks for the zchat-e2e stack."""
import json
import re
import struct
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from seed import assert_stack_owner

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROD = 'http://127.0.0.1:38080'


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()


def check():
    assert_stack_owner()
    results = []
    health = subprocess.run(['docker', 'exec', 'zchat-e2e-frontend-1', 'wget', '-qO-',
                             'http://backend:8000/health'], capture_output=True, check=True)
    assert json.loads(health.stdout) == {'status': 'healthy'}, 'Backend health failed'
    results.append({'backend_network_health': 'healthy'})
    for base, path, expected in [
        (PROD, '/api/auth/me', 401),
    ]:
        status, headers, _ = fetch(base + path)
        assert status == expected, (base, path, status)
        results.append({'url': base + path, 'status': status})

    for path in ['/', '/index.html', '/theme-init.js']:
        status, headers, body = fetch(PROD + path)
        assert status == 200, (path, status)
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        if path.endswith('.js'):
            assert headers.get_content_type() == 'application/javascript', dict(headers)
            assert body == (REPO / 'frontend/public/theme-init.js').read_bytes(), 'Init file differs from source'
        results.append({'url': PROD + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'), 'bytes': len(body)})

    _, _, index = fetch(PROD + '/index.html')
    html = index.decode()
    assert re.search(r'<script\s+src="/theme-init\.js"\s*></script>', html), 'Missing blocking external theme init'
    assert html.index('/theme-init.js') < html.index('type="module"'), 'Init must precede app module'
    assets = sorted(set(re.findall(r'(?:src|href)="(/assets/[^\"]+\.(?:js|css))"', html)))
    assert len(assets) >= 2, 'Expected hashed JS and CSS assets'
    for path in assets:
        status, headers, body = fetch(PROD + path)
        assert status == 200, (path, status)
        assert headers.get('Cache-Control') == 'public, max-age=31536000, immutable', (path, dict(headers))
        results.append({'url': PROD + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'), 'bytes': len(body)})

    manifest = REPO / 'frontend/public/manifest.webmanifest'
    assert manifest.is_file(), 'Required manifest source is missing'
    assert re.search(r'<link\s+rel="manifest"\s+href="/manifest\.webmanifest"', html), 'Missing manifest link'
    assert re.search(r'<link\s+rel="apple-touch-icon"\s+href="/icons/icon-192\.png"', html), 'Missing Apple touch icon'
    status, headers, body = fetch(PROD + '/manifest.webmanifest')
    assert status == 200, status
    assert headers.get_content_type() == 'application/manifest+json', dict(headers)
    assert headers.get('Cache-Control') == 'no-cache', dict(headers)
    manifest_data = json.loads(body)
    assert manifest_data == json.loads(manifest.read_text()), 'Manifest differs from source'
    results.append({'url': PROD + '/manifest.webmanifest', 'status': status,
                    'content_type': headers.get('Content-Type'),
                    'cache_control': headers.get('Cache-Control')})
    assert len(manifest_data['icons']) == 3, 'Expected all three PWA icons'
    for icon in manifest_data['icons']:
        path = icon['src']
        assert path.startswith('/icons/'), path
        status, headers, body = fetch(PROD + path)
        assert status == 200, (path, status)
        assert headers.get_content_type() == 'image/png', (path, dict(headers))
        assert headers.get('Cache-Control') == 'no-cache', (path, dict(headers))
        assert body == (REPO / 'frontend/public' / path.lstrip('/')).read_bytes(), 'Icon differs from source'
        assert body[:8] == b'\x89PNG\r\n\x1a\n', 'Icon is not PNG'
        width, height = struct.unpack('>II', body[16:24])
        assert f'{width}x{height}' == icon['sizes'], (path, width, height)
        results.append({'url': PROD + path, 'status': status,
                        'content_type': headers.get('Content-Type'),
                        'cache_control': headers.get('Cache-Control'),
                        'dimensions': f'{width}x{height}', 'bytes': len(body)})
    metadata = {}
    image_tags = {'zchat-e2e-frontend-1': 'zchat-e2e-frontend:local',
                  'zchat-e2e-backend-1': 'zchat-e2e-backend:local'}
    inspected = subprocess.run(['docker', 'container', 'inspect',
                                'zchat-e2e-frontend-1', 'zchat-e2e-backend-1',
                                'zchat-e2e-postgres-1'], capture_output=True, check=True)
    for container in json.loads(inspected.stdout):
        name = container['Name'].lstrip('/')
        metadata[name] = {'container_id': container['Id'], 'image_id': container['Image'],
                          'running': container['State']['Running'],
                          'volumes': [m.get('Name') for m in container['Mounts'] if m['Type'] == 'volume']}
        assert container['State']['Running'], name
        if name in image_tags:
            current = subprocess.run(['docker', 'image', 'inspect', image_tags[name]],
                                     capture_output=True, check=True)
            image = json.loads(current.stdout)[0]
            metadata[name]['matches_built_image'] = container['Image'] == image['Id']
            assert metadata[name]['matches_built_image'], 'Production container is using a stale image'
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True, check=True).stdout.decode().strip()
    report = {'passed': True, 'source_head_at_verification': head, 'containers': metadata,
              'entry_assets': assets, 'checks': results}
    (HERE / 'http-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    check()
