#!/usr/bin/env bash
set -euo pipefail
cd /srv/cop
umask 077
export PYTHONDONTWRITEBYTECODE=1
python3 scripts/cop-storage.py preflight >/dev/null
exec 9>>/srv/cop/.storage.lock
flock -n 9
export COP_STORAGE_LOCK_FD=9
python3 scripts/cop-storage.py preflight >/dev/null
files=(docker-compose.yml docker-compose.driver-measurements.yml docker-compose.x5.yml)
if [[ -f docker-compose.ai-router.yml ]]; then files+=(docker-compose.ai-router.yml); fi
args=(); for f in "${files[@]}"; do args+=(--compose-file "$f"); done
python3 scripts/cop-storage.py snapshot "${args[@]}"
python3 scripts/cop-storage.py cleanup
running=$(python3 scripts/verify-cop-builder.py --allow-stopped | python3 -c 'import json,sys;print("yes" if json.load(sys.stdin)["running"] else "no")')
if [[ "$running" == yes ]]; then
  python3 scripts/cop-storage.py preflight >/dev/null
  # Dedicated COP cache only; the daemon/shared builders/images are untouched.
  docker buildx --builder cop-x5 prune --force --filter until=336h --max-used-space 10gb
fi
# Backup/image deletion remains preview until independent backup is verified.
python3 scripts/cop-storage.py retention-plan
