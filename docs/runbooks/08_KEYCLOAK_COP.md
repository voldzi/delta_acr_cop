# 08 Keycloak for COP

Keycloak bezi:

- interni URL: `http://docker.home.cz:8081`
- verejny URL: `https://login.zeleznalady.cz`

COP integrace pouziva samostatny realm `cop`. Nemen ostatni realmy.

## Realm a klient

Doporucene hodnoty:

- realm: `cop`
- public SPA client: `cop-web`
- realm role pro uzivatele: `cop_operator`
- redirect URI:
  - `https://cop.zeleznalady.cz/*`
  - `http://docker.home.cz:4311/*`
  - `http://localhost:4311/*`
- web origins:
  - `https://cop.zeleznalady.cz`
  - `http://docker.home.cz:4311`
  - `http://localhost:4311`

V klientovi zapni standard flow a PKCE `S256`. Client secret pro `cop-web` nepouzivej; jde o public browser client.

## kcadm postup

Spust na hostu/kontejneru, kde je dostupny `kcadm.sh`. Dopln admin ucet Keycloaku:

```bash
/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://docker.home.cz:8081 \
  --realm master \
  --user <keycloak-admin>

/opt/keycloak/bin/kcadm.sh create realms \
  -s realm=cop \
  -s enabled=true \
  -s displayName="COP"

/opt/keycloak/bin/kcadm.sh create roles \
  -r cop \
  -s name=cop_operator \
  -s description="COP operator access"

/opt/keycloak/bin/kcadm.sh create clients \
  -r cop \
  -s clientId=cop-web \
  -s enabled=true \
  -s publicClient=true \
  -s protocol=openid-connect \
  -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=false \
  -s serviceAccountsEnabled=false \
  -s 'redirectUris=["https://cop.zeleznalady.cz/*","http://docker.home.cz:4311/*","http://localhost:4311/*"]' \
  -s 'webOrigins=["https://cop.zeleznalady.cz","http://docker.home.cz:4311","http://localhost:4311"]' \
  -s 'attributes.pkce.code.challenge.method=S256' \
  -s 'attributes."post.logout.redirect.uris"=+'
```

Uzivatele muzes vytvorit v admin UI nebo pres `kcadm.sh` a priradit mu roli `cop_operator`.

## COP .env

Prechodovy rezim, kdy funguje Keycloak i lab token pro SIM/pilot:

```bash
COP_AUTH_MODE=hybrid
COP_WEB_AUTH_MODE=hybrid
COP_ALLOW_LAB_TOKEN=true
COP_LAB_TOKEN=<soucasny-lab-token>
COP_PUBLIC_LAB_VALUE=<soucasny-lab-token>
COP_OIDC_ISSUER=https://login.zeleznalady.cz/realms/cop
COP_OIDC_CLIENT_ID=cop-web
COP_OIDC_ALLOWED_CLIENTS=cop-web
COP_OIDC_REQUIRED_ROLE=cop_operator
COP_OIDC_SCOPE=openid profile email
COP_USER_PROFILE_STORE=auto
```

Striktni rezim bez lab tokenu:

```bash
COP_AUTH_MODE=oidc
COP_WEB_AUTH_MODE=oidc
COP_ALLOW_LAB_TOKEN=false
COP_OIDC_ISSUER=https://login.zeleznalady.cz/realms/cop
COP_OIDC_CLIENT_ID=cop-web
COP_OIDC_ALLOWED_CLIENTS=cop-web
COP_OIDC_REQUIRED_ROLE=cop_operator
COP_USER_PROFILE_STORE=auto
```

Po zmene buildu webu je potreba rebuild:

```bash
cd /srv/cop
docker compose up -d --build
curl -fsS http://docker.home.cz:4310/health/ready
curl -I http://docker.home.cz:4311
```

## Serverove profily operatoru

API uklada uzivatelske nastaveni podle identity z bearer tokenu:

- OIDC rezim pouziva stabilni claim `sub` z Keycloaku.
- Lab rezim pouziva sdileny subject `lab`.
- Endpointy jsou `GET /api/v1/me/preferences` a `PUT /api/v1/me/preferences`.
- Uklada se pouze zobrazeni, workspace, mapa, replay/historie, lokalni radius vystrah a informacni alert preference.
- Potvrzeni serverovych alertu je per-user; potvrzeni jednoho operatora nezmizi ostatnim.

Persistenci ridi `COP_USER_PROFILE_STORE=auto`. Pri `auto` se pouzije PostgreSQL z `COP_DATABASE_URL`; bez databaze se pouzije in-memory fallback. V pilotu s HAProxy/Patroni tedy staci mit nastaveny stejny `COP_DATABASE_URL` jako pro temporal store.

API si vytvari tabulky:

- `cop_user_profiles`
- `cop_user_alert_acknowledgements`

Kontrola:

```bash
cd /srv/cop
set -a; . ./.env; set +a
curl -fsS -H "Authorization: Bearer ${COP_PUBLIC_LAB_VALUE:-$COP_LAB_TOKEN}" \
  http://docker.home.cz:4310/health/dependencies
```

Ocekavany radek: `user-profile-store` se stavem `ok`.

## Poznamky

- API overuje podpis access tokenu pres JWKS z `${COP_OIDC_ISSUER}/protocol/openid-connect/certs`.
- Pokud API nema pristup na verejny issuer, lze nastavit `COP_OIDC_JWKS_URI=http://docker.home.cz:8081/realms/cop/protocol/openid-connect/certs`, ale `iss` v tokenu musi zustat `https://login.zeleznalady.cz/realms/cop`.
- Web uklada OIDC session do `sessionStorage`; uzivatelske preference se synchronizuji do API a `localStorage` slouzi jako lokalni fallback/cache.
