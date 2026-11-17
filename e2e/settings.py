"""Shared target selection for the disposable E2E tools; never reads root .env."""
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROJECT = os.environ.get('E2E_PROJECT', 'zchat-e2e')
PORT = os.environ.get('E2E_PORT', '38080')
LITE_PORT = os.environ.get('E2E_LITE_PORT', '38081')
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', PROJECT) or PROJECT in ('zchat', 'zchat-lite', 'zchat-lite-e2e'):
    raise ValueError('E2E_PROJECT must be a disposable Compose project, never zchat/zchat-lite or retired zchat-lite-e2e')
for name, value in [('E2E_PORT', PORT), ('E2E_LITE_PORT', LITE_PORT)]:
    if (not value.isascii() or not value.isdigit()
            or not 1024 <= int(value) <= 65535 or int(value) in (3000, 3100)):
        raise ValueError(f'{name} must be an unprivileged port, never real-data ports 3000/3100')
PORT, LITE_PORT = str(int(PORT)), str(int(LITE_PORT))
if PORT == LITE_PORT:
    raise ValueError('E2E_PORT and E2E_LITE_PORT must differ')
BASE = f'http://127.0.0.1:{PORT}'
LITE_BASE = f'http://127.0.0.1:{LITE_PORT}'
# Preserve the original default stack state, while isolating every other project.
STATE = HERE if PROJECT == 'zchat-e2e' else HERE / '.state' / PROJECT
ENV_FILE = STATE / '.env'
FRONTEND = f'{PROJECT}-frontend-1'
LITE_FRONTEND = f'{PROJECT}-frontend-lite-1'
