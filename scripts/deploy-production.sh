#!/usr/bin/env bash
set -euo pipefail
# Run only on docker.home.cz; explicit service arguments, no whole-stack update.
cd /srv/cop
umask 077
# Pin every Docker operation before build context or inspection can reach a
# different daemon. Do not alter the user's saved Docker context.
case "${DOCKER_HOST:-unix:///var/run/docker.sock}" in
  unix:///var/run/docker.sock|unix:///run/docker.sock) ;;
  *) echo 'COP deployment requires the local Docker daemon' >&2; exit 1 ;;
esac
[[ "${DOCKER_CONTEXT:-default}" == default ]] || { echo 'COP deployment rejects a foreign Docker context' >&2; exit 1; }
unset DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
docker() {
  if command docker --host unix:///var/run/docker.sock "$@" 2>/dev/null; then return 0; fi
  echo 'COP Docker operation failed; private diagnostics were suppressed' >&2
  return 1
}
python3 scripts/cop-storage.py preflight >/dev/null
exec 9>>/srv/cop/.storage.lock
flock -n 9
export COP_STORAGE_LOCK_FD=9
python3 scripts/cop-storage.py preflight >/dev/null
build_only=false
deploy_only=false
edge_deploy_only=false
edge_image=
edge_revision=
api_build_context=
api_source_explicit=false
api_profile_args=()
api_erasure_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) build_only=true; shift ;;
    --api-build-context)
      [[ $# -ge 2 && -z "$api_build_context" && -n "$2" && "$2" != --* ]] || { echo 'API build context requires one value' >&2; exit 1; }
      api_build_context="$2"; shift 2 ;;
    --edge-image|--edge-source)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo 'Edge deployment option requires a value' >&2; exit 1; }
      if [[ "$1" == --edge-image ]]; then edge_image="$2"; edge_deploy_only=true; else edge_revision="$2"; fi
      shift 2 ;;
    --api-image|--api-source|--api-attestation|--api-profile|--api-erasure-config)
      [[ $# -ge 2 ]] || { echo 'API deployment option requires a value' >&2; exit 1; }
      case "$1" in
        --api-image) api_image="$2"; deploy_only=true ;;
        --api-source) api_revision="$2"; api_source_explicit=true ;;
        --api-attestation) COP_API_RUNTIME_ATTESTATION="$2" ;;
        --api-profile) api_profile_args=(--profile "$2") ;;
        --api-erasure-config) api_erasure_args=(--account-erasure-config "$2") ;;
      esac
      shift 2 ;;
    *) break ;;
  esac
done
if [[ -n "$api_build_context" ]]; then
  $api_source_explicit || { echo 'API build context requires an explicit reviewed source pin' >&2; exit 1; }
  context_args=()
  for service in "$@"; do context_args+=(--service "$service"); done
  python3 scripts/cop-api-build-context.py validate --context "$api_build_context" \
    --revision "${api_revision:-}" --build-only "$build_only" --deploy-only "$deploy_only" "${context_args[@]}" >/dev/null
fi
if $edge_deploy_only; then
  [[ $# -eq 0 && "$build_only" == false && "$deploy_only" == false && -n "$edge_revision" && -z "$api_build_context" ]] || { echo 'Immutable Edge activation must be Edge-only with a source pin' >&2; exit 1; }
  set -- cop-edge
elif [[ -n "$edge_revision" ]]; then echo 'Edge source requires its immutable image' >&2; exit 1
fi
if $deploy_only; then
  [[ $# -eq 0 && "$build_only" == false && -n "${api_revision:-}" ]] || { echo 'Immutable API activation must be API-only with a source pin' >&2; exit 1; }
  set -- cop-api
fi
files=(docker-compose.yml docker-compose.driver-measurements.yml docker-compose.x5.yml)
# Keep the approved Router attachment when present. Never silently drop it.
if [[ -f docker-compose.ai-router.yml ]]; then files+=(docker-compose.ai-router.yml); fi
compose=(); backup=()
for f in "${files[@]}"; do
  [[ -f "$f" ]] || { echo 'Required COP Compose override is missing' >&2; exit 1; }
  compose+=(-f "$f"); backup+=(--compose-file "$f")
done
if [[ $# -eq 0 ]]; then echo 'Specify the reviewed service(s), for example cop-api' >&2; exit 1; fi
for service in "$@"; do
  case "$service" in cop-api|cop-web|cop-chat|cop-edge|cop-mcp) ;; *) echo 'Unknown COP service' >&2; exit 1;; esac
done
api_requested=false
edge_requested=false
other_services=()
for service in "$@"; do
  if [[ "$service" == cop-api ]]; then api_requested=true; else other_services+=("$service"); fi
  if [[ "$service" == cop-edge ]]; then edge_requested=true; fi
done
if $api_requested; then
  # Missing, corrupt or interrupted profiles stop every mixed API deployment.
  if [[ ${#api_erasure_args[@]} -gt 0 ]]; then
    $deploy_only && [[ "$build_only" == false ]] || { echo 'Account erasure configuration requires an immutable API-only release' >&2; exit 1; }
    # Read only a CAS precondition from the Root-owned proof. The runtime gate
    # independently validates the complete proof/configuration before mutation.
    api_generation=$(python3 - "${api_erasure_args[1]}" <<'PYERASURE'
import json,os,re,stat,sys
fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW)
try:
    meta=os.fstat(fd)
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid!=0 or stat.S_IMODE(meta.st_mode)!=0o640 or meta.st_nlink!=1 or meta.st_size>65536:
        raise SystemExit('Invalid Root account erasure proof')
    value=json.loads(os.read(fd,65537))
    generation=value.get('previous',{}).get('generation','')
    if value.get('contractVersion') not in ('cop-api-account-erasure-config-v1', 'cop-api-account-erasure-clean-config-v1') or not isinstance(generation,str) or not re.fullmatch(r'[a-f0-9]{32}',generation):
        raise SystemExit('Invalid Root account erasure CAS generation')
    print(generation)
finally:
    os.close(fd)
PYERASURE
)
  else
    api_state=$(python3 scripts/cop-api-runtime.py validate)
    api_generation=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["generation"])' <<< "$api_state")
  fi
  if ! $build_only; then
    [[ -n "${COP_API_RUNTIME_ATTESTATION:-}" ]] || { echo 'Fresh API owner attestation is required' >&2; exit 1; }
  fi
  if ! $deploy_only && [[ -z "$api_build_context" ]]; then
    # Tracked and untracked build input must match the source label. Only the
    # approved local Compose attachment and operational lock may be untracked.
    api_revision=$(python3 - <<'PYSOURCE'
import subprocess,sys
records = subprocess.check_output(['git', 'status', '--porcelain=v1', '--untracked-files=all', '-z']).split(b'\0')
if any(value and value not in {b'?? .storage.lock', b'?? docker-compose.ai-router.yml'} for value in records):
    sys.exit('API source has uncommitted or untracked build input')
print(subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip())
PYSOURCE
)
  fi
fi
if $edge_requested && ! $edge_deploy_only; then
  edge_revision=$(python3 - <<'PYEDGESOURCE'
import subprocess,sys
records=subprocess.check_output(['git','status','--porcelain=v1','--untracked-files=all','-z']).split(b'\0')
if any(value and value not in {b'?? .storage.lock',b'?? docker-compose.ai-router.yml'} for value in records):sys.exit('Edge source has uncommitted or untracked build input')
print(subprocess.check_output(['git','rev-parse','HEAD']).decode().strip())
PYEDGESOURCE
)
fi
python3 scripts/cop-storage.py snapshot --exclude-env "${backup[@]}"
job=$(python3 scripts/cop-storage.py new-job staging | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])')
cachejob=$(python3 scripts/cop-storage.py new-job cache | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])')
export TMPDIR="$job" XDG_CACHE_HOME="$cachejob" PYTHONDONTWRITEBYTECODE=1
exec 8>>"$job/.job.lock"
flock -n 8
exec 7>>"$cachejob/.job.lock"
flock -n 7
python3 scripts/cop-health-gate.py capture > "$job/baseline-health.json"
if [[ -n "$api_build_context" ]]; then
  python3 scripts/cop-api-build-context.py pin --context "$api_build_context" --revision "$api_revision" \
    --pin-file "$job/api-build-context-pin.json"
fi
if ! $deploy_only && ! $edge_deploy_only; then
# COP's dedicated builder is backed by a bind volume on X5. Never use/prune a
# shared builder or reconfigure the daemon. Provisioning is in the runbook.
export BUILDX_BUILDER=cop-x5
python3 scripts/verify-cop-builder.py --allow-stopped >/dev/null
python3 scripts/cop-storage.py preflight >/dev/null
docker buildx inspect cop-x5 --bootstrap >/dev/null
python3 scripts/verify-cop-builder.py
build_compose=("${compose[@]}")
if $api_requested; then
  python3 - "$job/api-build-label.json" "$api_revision" "$api_build_context" <<'PYLABEL'
import json,sys
build = {'labels': {'org.opencontainers.image.revision': sys.argv[2]}}
if sys.argv[3]: build['context'] = sys.argv[3]
with open(sys.argv[1], 'x') as handle:
    json.dump({'services': {'cop-api': {'build': build}}}, handle)
PYLABEL
  build_compose+=(-f "$job/api-build-label.json")
fi
if $edge_requested; then
  python3 - "$job/edge-build-label.json" "$edge_revision" <<'PYEDGELABEL'
import json,sys
with open(sys.argv[1],'x') as handle:json.dump({'services':{'cop-edge':{'build':{'labels':{'org.opencontainers.image.revision':sys.argv[2]}}}}},handle)
PYEDGELABEL
  build_compose+=(-f "$job/edge-build-label.json")
fi
if [[ -n "$api_build_context" ]]; then
  python3 scripts/cop-api-build-context.py verify --context "$api_build_context" --revision "$api_revision" \
    --pin-file "$job/api-build-context-pin.json"
fi
docker compose --project-name cop "${build_compose[@]}" build --builder cop-x5 "$@" >/dev/null
if [[ -n "$api_build_context" ]]; then
  python3 scripts/cop-api-build-context.py verify --context "$api_build_context" --revision "$api_revision" \
    --pin-file "$job/api-build-context-pin.json"
fi
fi
api_check_image=delta-acr-cop-api:local
if $deploy_only; then api_check_image="$api_image"; fi
for service in "$@"; do
  if [[ "$service" == cop-chat ]]; then
    docker run --rm --pull never -i --network none --read-only --cap-drop ALL --entrypoint node delta-acr-cop-chat:local \
      --input-type=module < scripts/check-chat-image.mjs >/dev/null
  fi
  if [[ "$service" == cop-api ]]; then
    # Reject a rollback/release without the runtime guard, even when Compose
    # happens to contain X5 variables. Do not enable an internal tmp fallback.
    docker run --rm --pull never --network none --read-only --entrypoint node "$api_check_image" \
      -e 'const fs=require("fs");const s=fs.readFileSync("/app/apps/cop-api/dist/media-conversion.js","utf8");if(!s.includes("verifyConversionStorage")||!s.includes("expectedStorageUuid")||!s.includes("expectedDeviceId"))process.exit(1)' >/dev/null
    # Avatar sanitation depends on the Linux-native Sharp binary. Verify an
    # actual conversion in the exact image before replacing the running API.
    docker run --rm --pull never --network none --read-only --cap-drop ALL --entrypoint node "$api_check_image" \
      -e 'const sharp=require("/app/apps/cop-api/node_modules/sharp");sharp({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer().then(b=>{if(!b.length)process.exitCode=1}).catch(()=>{process.exitCode=1})' >/dev/null
  fi
done
python3 scripts/cop-storage.py preflight >/dev/null
if $build_only; then
  # The reviewed image/source metadata is needed to obtain a fresh root proof.
  if $api_requested; then
    docker image inspect --format '{{.Id}}' delta-acr-cop-api:local
    echo "API source revision: $api_revision"
  fi
  if $edge_requested; then
    docker image inspect --format '{{.Id}}' delta-acr-cop-edge:local
    echo "Edge source revision: $edge_revision"
  fi
  python3 scripts/cop-health-gate.py verify "$job/baseline-health.json"
else
if $api_requested; then
  # Resolve the newly built image, never an image saved in the active manifest.
  if ! $deploy_only; then api_image=$(docker image inspect --format '{{.Id}}' delta-acr-cop-api:local); fi
  api_binding=$(python3 scripts/cop-api-runtime.py prepare --image "$api_image" \
    --revision "$api_revision" --attestation "$COP_API_RUNTIME_ATTESTATION" \
    --expect-active "$api_generation" "${api_profile_args[@]}" "${api_erasure_args[@]}")
  api_release=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["releaseId"])' <<< "$api_binding")
fi
# Compatibility preparation finishes before mutating any selected service.
if $edge_deploy_only; then
  python3 scripts/cop-edge-release.py --image "$edge_image" --revision "$edge_revision" --job "$job"
elif [[ ${#other_services[@]} -gt 0 ]]; then
  docker compose --project-name cop "${compose[@]}" up -d --no-build --pull never --no-deps "${other_services[@]}" >/dev/null
fi
if $api_requested; then
  python3 scripts/cop-api-runtime.py activate --release "$api_release" --expect-active "$api_generation"
fi
python3 scripts/cop-health-gate.py verify "$job/baseline-health.json" --allow-added-dependency safety-notification-worker --allow-added-dependency cop-account-erasure-owners
fi
flock -u 8
exec 8>&-
python3 scripts/cop-storage.py complete-job "$job"
flock -u 7
exec 7>&-
python3 scripts/cop-storage.py complete-job "$cachejob"
python3 scripts/cop-storage.py retention-plan
echo 'Verify COP health/dependencies and the changed feature; deployment acceptance is separate.'
