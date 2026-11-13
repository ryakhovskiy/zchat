#!/usr/bin/env python3
"""API fixtures for the disposable production stack on loopback port 38080."""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BASE = 'http://127.0.0.1:38080'
USERS = ['alice_ui', 'bob_ui', 'carol_ui']


def request(method, path, payload=None, token=None, raw=None, content_type=None):
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if payload is not None:
        raw = json.dumps(payload).encode()
        content_type = 'application/json'
    if content_type:
        headers['Content-Type'] = content_type
    req = urllib.request.Request(BASE + path, data=raw, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read())


def main():
    values = dict(line.split('=', 1) for line in (HERE / '.env').read_text().splitlines() if '=' in line)
    password = values['E2E_PASSWORD']
    for attempt in range(60):
        try:
            request('GET', '/api/push/vapid-key')
            break
        except (OSError, ValueError):
            time.sleep(1)
    else:
        raise RuntimeError('Disposable API did not become ready')

    def authenticate(username, exists):
        payload = {'username': username, 'password': password}
        method = 'login' if exists else 'register'
        try:
            return request('POST', '/api/auth/' + method, payload)
        except urllib.error.HTTPError as exc:
            if method == 'register' and exc.code == 400:
                return request('POST', '/api/auth/login', payload)
            if method == 'login' and exc.code == 401:
                return request('POST', '/api/auth/register', payload)
            raise

    alice = authenticate(USERS[0], (HERE / 'seed-result.json').exists())
    token = alice['access_token']
    users = request('GET', '/api/users/', token=token)
    by_user = {user['username']: user for user in users}
    bob = authenticate(USERS[1], USERS[1] in by_user)
    carol = authenticate(USERS[2], USERS[2] in by_user)
    scratch_name = USERS[0] + '_qa'
    if scratch_name not in by_user:
        scratch = authenticate(scratch_name, False)['user']
    else:
        scratch = by_user[scratch_name]

    existing = request('GET', '/api/conversations/', token=token) or []
    by_name = {conversation.get('name'): conversation for conversation in existing}

    def conversation(name, people, group):
        if name in by_name:
            return by_name[name]
        result = request('POST', '/api/conversations/', {
            'name': name, 'is_group': group,
            'participant_ids': [user['id'] for user in people],
        }, token)
        by_name[name] = result
        return result

    direct = conversation('UI wrap and scroll', [bob['user']], False)
    group = conversation('Weekend plans ✨', [bob['user'], carol['user']], True)
    other = conversation('Quick check-in', [carol['user']], False)
    scratch_group = conversation('QA regression scratch', [bob['user'], scratch], True)
    path = f"/api/conversations/{direct['id']}/messages"
    messages = request('GET', path + '?limit=200', token=token) or []
    fixtures = [
        'Welcome to the UI test chat. Try all four themes and phone sizes.',
        'Long URL: https://example.com/very/long/path/' + 'segment/' * 24 + '?query=' + 'abcdef' * 35,
        'Long word: ' + 'Supercalifragilisticexpialidocious' * 16,
        'Multi-line message:\nFirst line\nSecond line with more text\n\nA new paragraph.\nFinal line.',
        'Emoji: 👋🏽 😀 🥳 🧑‍💻 💬 ❤️ 🌍 🚀 🎉 🐈‍⬛ 🏳️‍🌈',
        'Language check: Hello! Hallo! Привет! こんにちは! مرحبًا!',
        'Code wrapping:\nconst longName = "' + 'a' * 180 + '";\nconsole.log(longName);',
    ]
    for index in range(len(messages), 59):
        sender = alice if (index // 3) % 2 == 0 else bob
        content = fixtures[index] if index < len(fixtures) else f'Message {index + 1:02d}: testing grouped bubbles, scrolling, unread state and timestamps.'
        request('POST', path, {'content': content}, sender['access_token'])

    messages = request('GET', path + '?limit=200', token=token) or []
    latest = sorted(messages, key=lambda message: message['id'])[-15:]
    if not any(message.get('file_type') == 'image' for message in latest):
        picture = REPO / 'frontend/public/icons/icon-192.png'
        boundary = 'zchat-e2e-upload-boundary'
        raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="zchat-e2e.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
               + picture.read_bytes() + f'\r\n--{boundary}--\r\n'.encode())
        upload = request('POST', '/api/uploads/', token=token, raw=raw,
                         content_type='multipart/form-data; boundary=' + boundary)
        request('POST', path, {'content': 'Seed image: zchat logo, uploaded through the authenticated API.',
                              'file_path': upload['file_path'], 'file_type': upload['file_type']}, token)

    for conv, sender, content in [
        (group, alice, 'Welcome to the group. Alice, Bob and Carol are all here.'),
        (group, bob, 'The weekend plan is looking good! 🌤️'),
        (group, carol, 'Count me in.\nCan we meet at 10?'),
        (other, carol, 'A second direct conversation for checking navigation.'),
    ]:
        convpath = f"/api/conversations/{conv['id']}/messages"
        current = request('GET', convpath + '?limit=100', token=token) or []
        if not any(message.get('content') == content for message in current):
            request('POST', convpath, {'content': content}, sender['access_token'])

    final = request('GET', path + '?limit=200', token=token)
    latest = request('GET', path + '?limit=15', token=token)
    images = [message for message in latest if message.get('file_type') == 'image']
    assert len(final) >= 60, f'Expected at least 60 messages, received {len(final)}'
    assert images, 'Missing visible image among the latest 15 messages'
    image_path = '/api/' + images[-1]['file_path'].lstrip('/')
    req = urllib.request.Request(BASE + image_path, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=10) as response:
        assert response.headers.get_content_type() == 'image/png', 'Seed image MIME mismatch'
        assert response.read().startswith(b'\x89PNG\r\n\x1a\n'), 'Seed image download is not PNG'
    result = {'base_url': BASE, 'users': USERS + [scratch_name],
              'direct_conversation_id': direct['id'], 'group_conversation_id': group['id'],
              'other_conversation_id': other['id'], 'scratch_conversation_id': scratch_group['id'],
              'main_message_count': len(final), 'latest_image_messages': [image['id'] for image in images],
              'authenticated_image_download': True}
    (HERE / 'seed-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as exc:
        print(f'Disposable API seed failed: HTTP {exc.code}', file=sys.stderr)
        sys.exit(1)
