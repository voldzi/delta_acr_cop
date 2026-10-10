#!/usr/bin/env bash
set -euo pipefail
# Run only on docker.home.cz; explicit service arguments, no whole-stack update.
cd /srv/cop
umask 077
python3 scripts/cop-storage.py preflight >/dev/null
exec 9>>/srv/cop/.storage.lock
flock -n 9
export COP_STORAGE_LOCK_FD=9
python3 scripts/cop-storage.py preflight >/dev/null
files=(docker-compose.yml docker-compose.driver-measurements.yml docker-compose.x5.yml)
# Keep the approved Router attachment when present. Never silently drop it.
if [[ -f docker-compose.ai-router.yml ]]; then files+=(docker-compose.ai-router.yml); fi
compose=(); backup=()
for f in "${files[@]}"; do
  [[ -f "$f" ]] || { echo 'Required COP Compose override is missing' >&2; exit 1; }
  compose+=(-f "$f"); backup+=(--compose-file "$f")
done
python3 scripts/cop-storage.py snapshot "${backup[@]}"
if [[ $# -eq 0 ]]; then echo 'Specify the reviewed service(s), for example cop-api' >&2; exit 1; fi
for service in "$@"; do
  case "$service" in cop-api|cop-web|cop-chat|cop-edge|cop-mcp) ;; *) echo 'Unknown COP service' >&2; exit 1;; esac
done
job=$(python3 scripts/cop-storage.py new-job staging | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])')
cachejob=$(python3 scripts/cop-storage.py new-job cache | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])')
export TMPDIR="$job" XDG_CACHE_HOME="$cachejob" PYTHONDONTWRITEBYTECODE=1
exec 8>>"$job/.job.lock"
flock -n 8
exec 7>>"$cachejob/.job.lock"
flock -n 7
python3 scripts/cop-health-gate.py capture > "$job/baseline-health.json"
# COP's dedicated builder is backed by a bind volume on X5. Never use/prune a
# shared builder or reconfigure the daemon. Provisioning is in the runbook.
export BUILDX_BUILDER=cop-x5
python3 scripts/verify-cop-builder.py --allow-stopped >/dev/null
python3 scripts/cop-storage.py preflight >/dev/null
docker buildx inspect cop-x5 --bootstrap >/dev/null
python3 scripts/verify-cop-builder.py
docker compose "${compose[@]}" build --builder cop-x5 "$@"
for service in "$@"; do
  if [[ "$service" == cop-api ]]; then
    # Reject a rollback/release without the runtime guard, even when Compose
    # happens to contain X5 variables. Do not enable an internal tmp fallback.
    docker run --rm --network none --read-only --entrypoint node delta-acr-cop-api:local \
      -e 'const fs=require("fs");const s=fs.readFileSync("/app/apps/cop-api/dist/media-conversion.js","utf8");if(!s.includes("verifyConversionStorage")||!s.includes("expectedStorageUuid")||!s.includes("expectedDeviceId"))process.exit(1)'
  fi
done
python3 scripts/cop-storage.py preflight >/dev/null
docker compose "${compose[@]}" up -d --no-deps "$@"
python3 scripts/cop-health-gate.py verify "$job/baseline-health.json" --allow-added-dependency safety-notification-worker
flock -u 8
exec 8>&-
python3 scripts/cop-storage.py complete-job "$job"
flock -u 7
exec 7>&-
python3 scripts/cop-storage.py complete-job "$cachejob"
python3 scripts/cop-storage.py retention-plan
echo 'Verify COP health/dependencies and the changed feature; deployment acceptance is separate.'
