"""Shared target selection for the disposable E2E tools; never reads root .env."""
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROJECT = os.environ.get('E2E_PROJECT', 'zchat-e2e')
PORT = os.environ.get('E2E_PORT', '38080')
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', PROJECT) or PROJECT == 'zchat':
    raise ValueError('E2E_PROJECT must be a disposable Compose project, never zchat')
if not PORT.isascii() or not PORT.isdigit() or not 1024 <= int(PORT) <= 65535 or int(PORT) == 3000:
    raise ValueError('E2E_PORT must be an unprivileged port, never the real-data port 3000')
BASE = f'http://127.0.0.1:{PORT}'
# Preserve the original default stack state, while isolating every other project.
STATE = HERE if PROJECT == 'zchat-e2e' else HERE / '.state' / PROJECT
ENV_FILE = STATE / '.env'
FRONTEND = f'{PROJECT}-frontend-1'
