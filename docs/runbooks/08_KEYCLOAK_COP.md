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
```

Po zmene buildu webu je potreba rebuild:

```bash
cd /srv/cop
docker compose up -d --build
curl -fsS http://docker.home.cz:4310/health/ready
curl -I http://docker.home.cz:4311
```

## Poznamky

- API overuje podpis access tokenu pres JWKS z `${COP_OIDC_ISSUER}/protocol/openid-connect/certs`.
- Pokud API nema pristup na verejny issuer, lze nastavit `COP_OIDC_JWKS_URI=http://docker.home.cz:8081/realms/cop/protocol/openid-connect/certs`, ale `iss` v tokenu musi zustat `https://login.zeleznalady.cz/realms/cop`.
- Web uklada OIDC session do `sessionStorage`; uzivatelske mapove preference zustavaji v `localStorage`.
