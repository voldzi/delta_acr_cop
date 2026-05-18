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

Compose soubor je v rootu repozitáře jako [docker-compose.yml](../../docker-compose.yml). Pilot zatím nepoužívá databázi ani event bus; API drží Source Registry a COP state in-memory pro contract-testovatelný skeleton.

## Porty

Výchozí porty:

- `4310` pro `cop-api`,
- `4311` pro `cop-web`.

Porty lze změnit přes `.env`:

```bash
COP_API_PORT=4320
COP_WEB_PORT=4321
COP_PUBLIC_API_BASE_URL=http://docker.home.cz:4320
```
