#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
FAILURES=0

fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

require_file() {
  local path="$1"
  if [[ ! -f "$ROOT/$path" ]]; then
    fail "missing required file: $path"
  fi
}

require_dir() {
  local path="$1"
  if [[ ! -d "$ROOT/$path" ]]; then
    fail "missing required directory: $path"
  fi
}

required_files=(
  "README.md"
  "AGENTS.md"
  "CLAUDE.md"
  ".env.example"
  "docs/README.md"
  "docs/architecture.md"
  "docs/api.md"
  "docs/security.md"
  "docs/operations.md"
  "docs/observability.md"
  "docs/runbook.md"
  "openapi/README.md"
  "openapi/openapi.json"
)

for path in "${required_files[@]}"; do
  require_file "$path"
done

require_dir "docs/adr"

if [[ -f "$ROOT/openapi/openapi.json" ]]; then
  python3 -m json.tool "$ROOT/openapi/openapi.json" >/dev/null || fail "openapi/openapi.json is not valid JSON"
fi

if [[ -f "$ROOT/docs/api/openapi-main-cop.yaml" ]]; then
  head -n 2 "$ROOT/docs/api/openapi-main-cop.yaml" | grep -q "generated from openapi/openapi.json" \
    || fail "docs/api/openapi-main-cop.yaml must be marked as generated from openapi/openapi.json"
fi

if [[ -f "$ROOT/docs/api.md" ]]; then
  grep -q "openapi/openapi.json" "$ROOT/docs/api.md" \
    || fail "docs/api.md must reference openapi/openapi.json"
fi

if [[ -f "$ROOT/docs/README.md" ]]; then
  for topic in docs/architecture.md docs/api.md docs/security.md docs/operations.md docs/observability.md docs/runbook.md; do
    grep -q "$topic" "$ROOT/docs/README.md" || fail "docs/README.md missing topic mapping: $topic"
  done
fi

if [[ -f "$ROOT/AGENTS.md" && -f "$ROOT/CLAUDE.md" ]]; then
  tmp_agents="$(mktemp)"
  tmp_claude="$(mktemp)"
  sed '/^## Compact Instructions$/,$d' "$ROOT/AGENTS.md" | sed '${/^$/d;}' > "$tmp_agents"
  sed '/^## Compact Instructions$/,$d' "$ROOT/CLAUDE.md" | sed '${/^$/d;}' > "$tmp_claude"
  if ! diff -q "$tmp_agents" "$tmp_claude" >/dev/null; then
    fail "AGENTS.md and CLAUDE.md differ before Compact Instructions"
  fi
  rm -f "$tmp_agents" "$tmp_claude"
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "Skeleton validation failed with $FAILURES issue(s)." >&2
  exit 1
fi

echo "Skeleton validation passed."
