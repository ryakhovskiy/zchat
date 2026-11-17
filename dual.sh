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
project=zchat
if [[ -n "${DUAL_TEST_PROJECT:-}" ]]; then
  if [[ "$DUAL_TEST_PROJECT" != zchat-dualtest ]]; then
    printf '%s\n' 'DUAL_TEST_PROJECT only permits the isolated zchat-dualtest smoke test.' >&2
    exit 2
  fi
  project="$DUAL_TEST_PROJECT"
fi
compose=(docker compose -p "$project" --env-file "${DUAL_ENV_FILE:-$root/.env}"
  -f "$root/docker-compose.yml" -f "$root/docker-compose.dual.yml")
# Let Compose parse dotenv/interpolation; emit only non-secret deployment fields.
fields="$("${compose[@]}" config --format json | python3 -c '
import json, pathlib, subprocess, sys
c = json.load(sys.stdin)
mounts = c["services"]["postgres"]["volumes"]
if len(mounts) != 1 or mounts[0]["target"] != "/var/lib/postgresql":
    raise SystemExit("Expected exactly one PostgreSQL data mount")
if c["name"] == "zchat-dualtest":
    if not pathlib.Path(mounts[0]["source"]).resolve().is_relative_to("/tmp"):
        raise SystemExit("Test data must be under /tmp")
    for service, port in (("frontend", "38090"), ("frontend-lite", "38091")):
        p = c["services"][service]["ports"][0]
        if str(p["published"]) != port or p["host_ip"] != "127.0.0.1":
            raise SystemExit("Unexpected smoke-test listener")
print(c["name"])
print(mounts[0]["source"])
for service in ("frontend", "frontend-lite"):
    p = c["services"][service]["ports"][0]
    print(str(p.get("host_ip", "0.0.0.0")) + ":" + str(p["published"]))
if sys.argv[1] != "up":
    print("-")
    raise SystemExit(0)
image = c["services"]["postgres"]["image"]
inspected = subprocess.run(["docker", "image", "inspect", image], capture_output=True, text=True)
if inspected.returncode:
    raise SystemExit("Cannot inspect PostgreSQL image " + image + "; run docker pull " + image + " and retry up")
image_env = json.loads(inspected.stdout)[0]["Config"]["Env"]
effective = dict(item.split("=", 1) for item in image_env if "=" in item)
effective.update(c["services"]["postgres"].get("environment", {}))
pgdata = pathlib.PurePosixPath(effective["PGDATA"])
relative = pgdata.relative_to(mounts[0]["target"])
if not relative.parts or ".." in relative.parts:
    raise SystemExit("PGDATA must be inside the PostgreSQL mount")
print(pathlib.Path(mounts[0]["source"]) / str(relative))
' "$action")"
{ IFS= read -r project; IFS= read -r data_dir; IFS= read -r full_port;
  IFS= read -r lite_port; IFS= read -r cluster_dir; } <<< "$fields"
cluster=unknown
if [[ "$cluster_dir" != - ]]; then
  cluster=false
fi
if [[ "$cluster_dir" != - && -s "$cluster_dir/PG_VERSION" ]]; then
  cluster=true
fi
printf 'Project: %s\nPostgreSQL data: %s\nCluster present: %s\nFull: %s\nLite: %s\n' \
  "$project" "$data_dir" "$cluster" "$full_port" "$lite_port"
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
  up) "${compose[@]}" up -d --build ;;
  down) "${compose[@]}" down ;;
  ps) "${compose[@]}" ps ;;
esac
