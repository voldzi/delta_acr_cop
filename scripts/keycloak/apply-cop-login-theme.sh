#!/usr/bin/env bash
# Safely deploy the COP Keycloak login theme and optionally enable Remember Me.
# The script intentionally does not contain or store credentials.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly THEME_SOURCE="${REPOSITORY_ROOT}/infra/keycloak/themes/cop"
readonly KEYCLOAK_HOST="${COP_KEYCLOAK_HOST:-docker.home.cz}"
readonly KEYCLOAK_CONTAINER="${COP_KEYCLOAK_CONTAINER:-keycloak}"
readonly KEYCLOAK_THEME_ROOT="${COP_KEYCLOAK_THEME_ROOT:-/srv/vcode/apps/masaze/infra/keycloak/themes}"
readonly KEYCLOAK_INTERNAL_URL="${COP_KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"

apply=false
enable_remember_me=false
remember_me_only=false

usage() {
  cat <<'EOF'
Použití:
  bash scripts/keycloak/apply-cop-login-theme.sh [--apply] [--enable-remember-me]
  bash scripts/keycloak/apply-cop-login-theme.sh --remember-me-only

Bez --apply provede pouze bezpečnou kontrolu podmínek.

--apply
  Nahraje šablonu přihlášení COP, předchozí verzi uloží jako zálohu a restartuje
  pouze Keycloak. Nezasahuje do COP API ani databáze.

--enable-remember-me
  Spolu s --apply zapne v realm cop volbu „Zůstat přihlášen na tomto zařízení“
  a nastaví její maximální nečinnost i dobu trvání na 30 dní. Keycloak si
  bezpečně vyžádá aktuální heslo správce přímo v terminálu.

--remember-me-only
  Zapne pouze tuto volbu bez dalšího nahrání šablony nebo restartu Keycloaku.
EOF
}

while (($#)); do
  case "$1" in
    --apply) apply=true ;;
    --enable-remember-me) enable_remember_me=true ;;
    --remember-me-only) enable_remember_me=true; remember_me_only=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Neznámý parametr: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if "$enable_remember_me" && ! "$apply" && ! "$remember_me_only"; then
  echo "--enable-remember-me vyžaduje také --apply." >&2
  exit 64
fi

if "$remember_me_only" && "$apply"; then
  echo "Použijte buď --apply --enable-remember-me, nebo samostatně --remember-me-only." >&2
  exit 64
fi

if [[ ! -f "${THEME_SOURCE}/login/theme.properties" ]]; then
  echo "Nenalezena šablona COP: ${THEME_SOURCE}" >&2
  exit 66
fi

for required in ssh tar; do
  command -v "$required" >/dev/null || {
    echo "Chybí požadovaný program: $required" >&2
    exit 69
  }
done

echo "Kontroluji dostupnost Keycloaku na ${KEYCLOAK_HOST}…"
ssh "$KEYCLOAK_HOST" \
  "test -d '${KEYCLOAK_THEME_ROOT}' && docker ps --format '{{.Names}}' | grep -Fxq '${KEYCLOAK_CONTAINER}'"

if ! "$apply" && ! "$remember_me_only"; then
  cat <<EOF
Kontrola proběhla úspěšně.

Připravená šablona: ${THEME_SOURCE}
Cílový server:       ${KEYCLOAK_HOST}
Cílová složka:       ${KEYCLOAK_THEME_ROOT}/cop

Pro skutečné nasazení spusťte:
  bash scripts/keycloak/apply-cop-login-theme.sh --apply
EOF
  exit 0
fi

if "$apply"; then
echo "Nahrávám šablonu COP; původní verze zůstane na serveru jako časovaná záloha…"
# Resource-fork/provenance metadata from macOS are harmless for the Linux
# target. The staging cleanup below is deliberately recursive so that such
# metadata can never interrupt a completed theme swap.
COPYFILE_DISABLE=1 tar -C "$(dirname "${THEME_SOURCE}")" -cf - "$(basename "${THEME_SOURCE}")" | \
  ssh "$KEYCLOAK_HOST" "
    set -eu
    target='${KEYCLOAK_THEME_ROOT}'
    stage=\"\$(mktemp -d \"\${target}/.cop-theme-stage.XXXXXX\")\"
    cleanup() { rm -rf \"\${stage}\"; }
    trap cleanup EXIT
    tar -xf - -C \"\${stage}\"
    test -f \"\${stage}/cop/login/theme.properties\"
    backup=\"\${target}/cop.backup.\$(date -u +%Y%m%dT%H%M%SZ)\"
    if test -d \"\${target}/cop\"; then
      mv \"\${target}/cop\" \"\${backup}\"
      printf 'Záloha předchozí šablony: %s\\n' \"\${backup}\"
    fi
    mv \"\${stage}/cop\" \"\${target}/cop\"
    rm -rf \"\${stage}\"
    trap - EXIT
    docker restart '${KEYCLOAK_CONTAINER}' >/dev/null
    printf 'Keycloak byl restartován.\\n'
  "

echo "Čekám na připravenost Keycloaku…"
ready=false
# Keycloak's management health endpoint is intentionally not published to the
# host. Docker already evaluates it inside the container, so its health status
# is the reliable production readiness signal.
for _ in {1..50}; do
  if ssh "$KEYCLOAK_HOST" \
    "test \"\$(docker inspect -f '{{.State.Health.Status}}' '${KEYCLOAK_CONTAINER}')\" = healthy"; then
    ready=true
    break
  fi
  sleep 2
done

if ! "$ready"; then
  echo "Keycloak po restartu neprošel health checkem. Původní šablona je zachována v záloze na serveru." >&2
  exit 70
fi
echo "Šablona je nasazena a Keycloak je připraven."
fi

if ! "$enable_remember_me"; then
  cat <<'EOF'

Volbu „Zůstat přihlášen“ lze zapnout dodatečně:
  bash scripts/keycloak/apply-cop-login-theme.sh --remember-me-only
EOF
  exit 0
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "Zapnutí „Zůstat přihlášen“ vyžaduje interaktivní terminál kvůli bezpečnému zadání hesla správce." >&2
  exit 64
fi

read -r -p "Uživatelské jméno aktuálního správce Keycloaku: " keycloak_admin
if [[ ! "$keycloak_admin" =~ ^[[:alnum:]_.@-]+$ ]]; then
  echo "Neplatný formát uživatelského jména správce." >&2
  exit 64
fi

readonly KCADM_CONFIG="/tmp/cop-kcadm-$(date +%s)-$$.config"
echo "Keycloak nyní požádá o heslo správce; heslo se neukládá do skriptu ani do souboru."

# kcadm se ptá přímo v terminálu Keycloaku. Dočasná konfigurace uvnitř
# kontejneru se po dokončení vždy odstraní.
ssh -tt "$KEYCLOAK_HOST" \
  "docker exec -it '${KEYCLOAK_CONTAINER}' /opt/keycloak/bin/kcadm.sh config credentials --server '${KEYCLOAK_INTERNAL_URL}' --realm master --user '${keycloak_admin}' --config '${KCADM_CONFIG}'"

ssh "$KEYCLOAK_HOST" "
  set -eu
  cleanup() { docker exec '${KEYCLOAK_CONTAINER}' rm -f '${KCADM_CONFIG}'; }
  trap cleanup EXIT
  docker exec '${KEYCLOAK_CONTAINER}' /opt/keycloak/bin/kcadm.sh update realms/cop --config '${KCADM_CONFIG}' \\
    -s rememberMe=true \\
    -s ssoSessionIdleTimeoutRememberMe=2592000 \\
    -s ssoSessionMaxLifespanRememberMe=2592000
  docker exec '${KEYCLOAK_CONTAINER}' /opt/keycloak/bin/kcadm.sh get realms/cop --config '${KCADM_CONFIG}' | \\
    grep -E '\"rememberMe\"|\"ssoSessionIdleTimeoutRememberMe\"|\"ssoSessionMaxLifespanRememberMe\"'
"

echo "Volba „Zůstat přihlášen“ je zapnuta pro realm cop (30 dní)."
