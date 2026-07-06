# 02 Docker Compose

Docker Compose bude sloužit pro lokální MVP prostředí.

## Kandidátní služby

- `cop-api`,
- `cop-web`,
- PostgreSQL/PostGIS,
- Redis/KeyDB,
- NATS JetStream nebo Redpanda,
- Keycloak nebo mock OIDC,
- Prometheus,
- Grafana,
- Loki,
- mock AI provider.

Compose soubor je v rootu repozitáře jako [docker-compose.yml](../../docker-compose.yml). Aktuální pilot spouští:

- `cop-api` jako centrální COP backend,
- `cop-web` jako webovou pracovní plochu; produkční image spouští
  `apps/cop-web/server.mjs`, který servíruje statický build s Brotli/gzip
  kompresí, immutable cache pro hashed assety a bezpečným `404` pro chybějící
  assety,
- `cop-chat` jako samostatnou chatovací plochu pod `/chat/`; runtime používá
  stejné zásady komprese a hashed asset cache jako hlavní web,
- `cop-edge` jako volitelný pilotní lokální edge runtime.

Databáze, SIM, Messaging, SeaweedFS a další sdílené služby běží v pilotním
prostředí jako samostatné stacky mimo tento compose soubor. COP se k nim
připojuje přes `.env`.

## Porty

Výchozí porty:

- `4310` pro `cop-api`,
- `4311` pro `cop-web`,
- `4314` pro `cop-chat`,
- `4312` pro `cop-edge`.

Porty lze změnit přes `.env`:

```bash
COP_API_PORT=4320
COP_WEB_PORT=4321
COP_CHAT_PORT=4324
COP_EDGE_PORT=4322
COP_PUBLIC_API_BASE_URL=http://docker.home.cz:4320
```

## Release Smoke

Před nasazením produkčního buildu spouštět:

```bash
pnpm check:release
```

Kontrola provede build, bundle budgety a lokální smoke statického runtime pro
`cop-web` i `cop-chat`. Smoke ověřuje zejména:

- `content-encoding: br` pro komprimovatelné assety,
- `Cache-Control: public, max-age=31536000, immutable` pro `/assets/*`,
- `404` pro chybějící hashed asset,
- SPA fallback pro aplikační routy,
- dostupnost PWA manifestu a service workeru.
