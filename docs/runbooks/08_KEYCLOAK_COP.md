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
COP_PUBLIC_READ_ENABLED=true
COP_WEB_PUBLIC_READ_ENABLED=true
COP_LAB_TOKEN=<soucasny-lab-token>
COP_PUBLIC_LAB_VALUE=
COP_OIDC_ISSUER=https://login.zeleznalady.cz/realms/cop
COP_OIDC_CLIENT_ID=cop-web
COP_OIDC_ALLOWED_CLIENTS=cop-web
COP_OIDC_REQUIRED_ROLE=
COP_OIDC_SCOPE="openid profile email"
COP_USER_PROFILE_STORE=auto
```

`COP_PUBLIC_READ_ENABLED=true` povoli anonymni cteni verejne mapy a verejnych vrstev. Bez prihlaseni jsou dostupne pouze GET endpointy pro situacni obraz, zdroje, stream, historii tracku a odeslana komunitni hlaseni. Zapisove operace, uzivatelsky profil, potvrzovani vystrah, AI asistent, registrace mobilniho zarizeni a upload priloh stale vyzaduji platny bearer token.

`COP_PUBLIC_LAB_VALUE` nech v internetovem buildu prazdne. Serverovy `COP_LAB_TOKEN` muze zustat pro interni pilotni zdroje, ale nesmi byt zabudovany do verejneho web bundle.

Striktni rezim bez lab tokenu:

```bash
COP_AUTH_MODE=oidc
COP_WEB_AUTH_MODE=oidc
COP_ALLOW_LAB_TOKEN=false
COP_PUBLIC_READ_ENABLED=true
COP_WEB_PUBLIC_READ_ENABLED=true
COP_OIDC_ISSUER=https://login.zeleznalady.cz/realms/cop
COP_OIDC_CLIENT_ID=cop-web
COP_OIDC_ALLOWED_CLIENTS=cop-web
COP_OIDC_REQUIRED_ROLE=
COP_USER_PROFILE_STORE=auto
```

Pro komunitni provoz s registraci pres overeny e-mail je vhodne mit vlastni realm `cop`, zapnutou registraci uzivatelu a overeni e-mailu. Pokud ma byt zapis do COP dostupny vsem overenym uzivatelum tohoto realmu, nech `COP_OIDC_REQUIRED_ROLE` prazdne. Pokud chces role vynucovat, nastav treba `COP_OIDC_REQUIRED_ROLE=cop_user` a pridej `cop_user` jako default realm roli pro nove uzivatele.

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

Anonymni kontrola verejne mapy:

```bash
curl -fsS http://docker.home.cz:4310/api/v1/cop/tracks >/dev/null
curl -fsS http://docker.home.cz:4310/api/v1/map/catalog >/dev/null
curl -i -X POST http://docker.home.cz:4310/api/v1/community/reports \
  -H 'Content-Type: application/json' \
  -d '{"category":"fire"}'
```

Prvni dva prikazy maji vratit HTTP 200. Posledni prikaz ma bez bearer tokenu vratit HTTP 401.

## Registrace a e-mail

V Keycloaku pro realm `cop`:

```bash
/opt/keycloak/bin/kcadm.sh update realms/cop \
  -s registrationAllowed=true \
  -s verifyEmail=true \
  -s loginWithEmailAllowed=true \
  -s duplicateEmailsAllowed=false
```

SMTP nastav v admin UI realmu `cop` podle pouziteho mail serveru. Bez SMTP se uzivatel sice muze zalozit, ale overeni e-mailu nebude provozne dokoncene.

Ocekavany radek: `user-profile-store` se stavem `ok`.

## Poznamky

- API overuje podpis access tokenu pres JWKS z `${COP_OIDC_ISSUER}/protocol/openid-connect/certs`.
- Pokud API nema pristup na verejny issuer, lze nastavit `COP_OIDC_JWKS_URI=http://docker.home.cz:8081/realms/cop/protocol/openid-connect/certs`, ale `iss` v tokenu musi zustat `https://login.zeleznalady.cz/realms/cop`.
- Web uklada OIDC session do `sessionStorage`; uzivatelske preference se synchronizuji do API a `localStorage` slouzi jako lokalni fallback/cache.
