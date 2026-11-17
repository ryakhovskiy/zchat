#!/usr/bin/env bash
# Use DUAL_ENV_FILE to select a separate deployment environment.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
action="${1:-help}"
new_database=false
case "$action" in
  up|down|ps) ;;
  *) printf '%s\n' 'Usage: ./dual.sh {up [--new-database]|down|ps}' >&2; exit 2 ;;
esac
if [[ $# -eq 2 && "$action" == up && "$2" == --new-database ]]; then
  new_database=true
elif [[ $# -ne 1 ]]; then
  printf '%s\n' 'Only up accepts --new-database; no other arguments are allowed.' >&2
  exit 2
fi
compose=(docker compose --env-file "${DUAL_ENV_FILE:-$root/.env}"
  -f "$root/docker-compose.yml" -f "$root/docker-compose.dual.yml")
# Let Compose parse dotenv/interpolation; emit only non-secret deployment fields.
fields="$("${compose[@]}" config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)
mounts = c["services"]["postgres"]["volumes"]
assert len(mounts) == 1 and mounts[0]["target"] == "/var/lib/postgresql"
print(c["name"])
print(mounts[0]["source"])
for service in ("frontend", "frontend-lite"):
    p = c["services"][service]["ports"][0]
    print(str(p.get("host_ip", "0.0.0.0")) + ":" + str(p["published"]))
')"
mapfile -t selected <<< "$fields"
project="${selected[0]}"
data_dir="${selected[1]}"
cluster=false
if [[ -d "$data_dir" ]] && find "$data_dir" -maxdepth 3 -type f -name PG_VERSION -print -quit | grep -q .; then
  cluster=true
fi
printf 'Project: %s\nPostgreSQL data: %s\nCluster present: %s\nFull: %s\nLite: %s\n' \
  "$project" "$data_dir" "$cluster" "${selected[2]}" "${selected[3]}"
if [[ "$action" == up && "$cluster" != true ]]; then
  if [[ "$new_database" != true ]]; then
    printf '%s\n' 'Refusing up: no initialized cluster; explicitly pass --new-database for a new empty database.' >&2
    exit 1
  fi
  if [[ -e "$data_dir" && ( ! -d "$data_dir" || -n "$(find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit)" ) ]]; then
    printf '%s\n' 'Refusing to initialize a nonempty path without a PostgreSQL cluster.' >&2
    exit 1
  fi
fi
# Pin the rendered project even if invoked from another checkout directory.
case "$action" in
  up) "${compose[@]}" -p "$project" up -d --build ;;
  down) "${compose[@]}" -p "$project" down ;;
  ps) "${compose[@]}" -p "$project" ps ;;
esac
