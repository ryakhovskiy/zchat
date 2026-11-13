#!/usr/bin/env bash
set -euo pipefail
umask 077

e2e_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
action="${1:-help}"
case "$action" in
  up|seed|down|reset|env|verify) ;;
  help|-h|--help)
    printf '%s\n' 'Usage: bash e2e/run.sh {up|seed|down [--volumes]|reset|env|verify}'
    exit 0
    ;;
  *) printf 'Unknown action: %s\n' "$action" >&2; exit 2 ;;
esac
if [[ "$action" == down ]]; then
  if [[ $# -gt 2 || ( $# -eq 2 && "$2" != --volumes ) ]]; then
    printf '%s\n' 'Usage: bash e2e/run.sh down [--volumes]' >&2
    exit 2
  fi
elif [[ $# -gt 1 ]]; then
  printf '%s\n' 'This action takes no additional arguments.' >&2
  exit 2
fi

# Only this ignored file is generated/read; the repository root .env is unused.
python3 - "$e2e_dir/.env" <<'PY'
import os
from pathlib import Path
import secrets
import sys

path = Path(sys.argv[1])
if not path.exists():
    values = {name: secrets.token_hex(32) for name in
              ['E2E_DB_PASSWORD', 'E2E_JWT_SECRET', 'E2E_ENCRYPTION_KEY']}
    values['E2E_PASSWORD'] = 'E2e1!' + secrets.token_hex(16)
    with path.open('x') as output:
        os.chmod(path, 0o600)
        output.write(''.join(f'{key}={value}\n' for key, value in values.items()))
PY

compose=(docker compose --project-directory "$e2e_dir" --env-file "$e2e_dir/.env" -p zchat-e2e -f "$e2e_dir/compose.yaml")

print_env() {
  python3 - "$e2e_dir/.env" <<'PY'
from pathlib import Path
import shlex
import sys

values = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines() if '=' in line)
client = {'E2E_BASE_URL': 'http://127.0.0.1:38080', 'E2E_USERNAME': 'alice_ui',
          'E2E_PASSWORD': values['E2E_PASSWORD'], 'E2E_PEER': 'bob_ui', 'E2E_EXPECT_BUNDLE': '1'}
for key, value in client.items():
    print(f'export {key}={shlex.quote(value)}')
PY
}

case "$action" in
  up)
    "${compose[@]}" up -d --build --wait --wait-timeout 90
    print_env
    ;;
  seed) python3 "$e2e_dir/seed.py"; print_env ;;
  down) "${compose[@]}" down "${@:2}" ;;
  reset)
    "${compose[@]}" down --volumes
    "${compose[@]}" up -d --build --wait --wait-timeout 90
    python3 "$e2e_dir/seed.py"
    print_env
    ;;
  env) print_env ;;
  verify) python3 "$e2e_dir/verify-http.py" ;;
esac
