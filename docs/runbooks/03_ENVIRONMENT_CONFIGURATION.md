# 03 Environment Configuration

Environment configuration musí oddělit vývoj, test, demo a produkční režim.

## Kategorie proměnných

- API porty a base URLs,
- database/cache/event bus connection strings,
- OIDC issuer/client configuration,
- Source Registry bootstrap,
- AI provider enable/disable flags,
- track lifecycle thresholds (`COP_TRACK_STALE_AFTER_MS`, `COP_TRACK_EXPIRE_AFTER_MS`),
- temporal history persistence (`COP_TRACK_HISTORY_STORE`, `COP_DATABASE_URL`, `COP_DATABASE_SSL`),
- user profile persistence (`COP_USER_PROFILE_STORE`, volitelně stejný `COP_DATABASE_URL` jako temporal store),
- stream distribution limits (`COP_STREAM_BACKPRESSURE_CLIENTS`, `COP_STREAM_RETRY_MS`),
- server-side veřejný letový zdroj ze SIM (`COP_FLIGHT_DATA_ENABLED`, `COP_FLIGHT_DATA_BASE_URL`, `COP_FLIGHT_DATA_SOURCE`, `COP_FLIGHT_DATA_POLL_MS`),
- kontextové situační vrstvy ze SIM (`COP_SITUATION_DATA_ENABLED`, `COP_SITUATION_DATA_BASE_URL`, `COP_SITUATION_DATA_CACHE_TTL_MS`),
- classification policy,
- audit retention,
- metrics/exporter nastavení,
- feature flags pro degraded/offline režim.

Citlivé hodnoty nesmí být commitované do repozitáře.

## Flight Data Source

COP čte veřejné nebo licencované letové tracky pouze přes agregovaný SIM kontrakt `cop-flight-source-v1`. Klientská aplikace nevolá ADS-B/OpenSky endpointy přímo.

```env
COP_FLIGHT_DATA_ENABLED=true
COP_FLIGHT_DATA_BASE_URL=https://sim.zeleznalady.cz/flight-data
COP_FLIGHT_DATA_SOURCE=mock
COP_FLIGHT_DATA_LIMIT=500
COP_FLIGHT_DATA_INCLUDE_STALE=true
COP_FLIGHT_DATA_POLL_MS=15000
COP_FLIGHT_DATA_TIMEOUT_MS=6000
```

`COP_FLIGHT_DATA_SOURCE` může zůstat prázdné, pokud má SIM použít vlastní výchozí produkční zdroj. Pro lab a offline ověření je vhodné `mock`.

## Situation Data Source

COP čte situační kontext ze SIM kontraktu `cop-situation-source-v1` přes vlastní API proxy. Tato data jsou mapové vrstvy (`weather`, `ground`, `mobile`, `traffic`), nikoli COP tracky, temporal history ani podklad pro tasking.

```env
COP_SITUATION_DATA_ENABLED=true
COP_SITUATION_DATA_BASE_URL=https://sim.zeleznalady.cz/situation-data/api/v1
COP_SITUATION_DATA_CACHE_TTL_MS=20000
COP_SITUATION_DATA_MAX_LIMIT=250
COP_SITUATION_DATA_TIMEOUT_MS=15000
```

Web klient volá pouze COP API (`/api/v1/situation/layers`, `/api/v1/situation/features`). COP API při volání SIM nepřeposílá bearer token operátora. Při výpadku SIM endpointu vrací prázdný degraded `FeatureCollection`, aby mapa zůstala použitelná. Timeout je vyšší než běžná obnovovací kadence mapy, protože kombinované veřejné vrstvy mohou po studeném startu trvat několik sekund.
