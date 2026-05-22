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
- community report persistence (`COP_COMMUNITY_REPORT_STORE`, vyžaduje PostGIS při PostgreSQL backendu),
- stream distribution limits (`COP_STREAM_BACKPRESSURE_CLIENTS`, `COP_STREAM_RETRY_MS`),
- mapový podklad (`COP_MAP_STYLE_URL`, `COP_TILE_URL`, `COP_TILE_GLYPHS_URL`, `COP_TILE_ATTRIBUTION`),
- server-side veřejný letový zdroj ze SIM (`COP_FLIGHT_DATA_ENABLED`, `COP_FLIGHT_DATA_BASE_URL`, `COP_FLIGHT_DATA_SOURCE`, `COP_FLIGHT_DATA_POLL_MS`),
- kontextové situační vrstvy ze SIM (`COP_SITUATION_DATA_ENABLED`, `COP_SITUATION_DATA_BASE_URL`, `COP_SITUATION_DATA_CACHE_TTL_MS`),
- bezpečnostní veřejné vrstvy ze SIM (`COP_SAFETY_DATA_ENABLED`, `COP_SAFETY_DATA_BASE_URL`, `COP_SAFETY_DATA_CACHE_TTL_MS`),
- partnerský neveřejný TAK/CoT gateway zdroj ze SIM (`COP_TAK_GATEWAY_ENABLED`, `COP_TAK_GATEWAY_BASE_URL`, `COP_TAK_GATEWAY_READ_TOKEN`),
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
COP_SITUATION_DATA_OSM_POSTGIS_CACHE_TTL_MS=21600000
COP_SITUATION_DATA_MOBILE_NETWORK_CACHE_TTL_MS=600000
COP_SITUATION_DATA_MOBILE_NETWORK_MODEL_CACHE_TTL_MS=600000
```

Web klient volá pouze source-neutral COP API (`/api/v1/map/catalog`, `/api/v1/map/query`). COP API při volání SIM nepřeposílá bearer token operátora. Při výpadku SIM endpointu vrací prázdný degraded `FeatureCollection`, aby mapa zůstala použitelná. Timeout je vyšší než běžná obnovovací kadence mapy, protože kombinované veřejné vrstvy mohou po studeném startu trvat několik sekund.

## Safety Data Source

COP čte veřejná bezpečnostní data ze SIM kontraktu `cop-safety-source-v1` přes samostatnou API proxy. Jde o civilní kontextové vrstvy (`warnings`, `flood`), nikoli COP tracky, temporal history ani rozhodovací workflow. V UI jsou vedené jako samostatná skupina „Bezpečnostní data“.

```env
COP_SAFETY_DATA_ENABLED=true
COP_SAFETY_DATA_BASE_URL=https://sim.zeleznalady.cz/safety-data/api/v1
COP_SAFETY_DATA_CACHE_TTL_MS=120000
COP_SAFETY_DATA_WARNINGS_CACHE_TTL_MS=120000
COP_SAFETY_DATA_FLOOD_CACHE_TTL_MS=300000
COP_SAFETY_DATA_MAX_LIMIT=250
COP_SAFETY_DATA_TIMEOUT_MS=15000
```

Web klient volá pouze source-neutral COP API (`/api/v1/map/catalog`, `/api/v1/map/query`). COP API při volání SIM nepřeposílá bearer token operátora, slučuje malé posuny mapy do kanonického bbox cache klíče a při výpadku vrací prázdný degraded `FeatureCollection`.

## TAK Gateway Source

COP čte neveřejná partnerská TAK/CoT data ze SIM kontraktu `cop-tak-source-v1` pouze server-side. Token zůstává v procesu `cop-api`; web klient volá jen `/api/v1/map/catalog` a `/api/v1/map/query` a v prohlížeči nikdy nemá `COP_TAK_GATEWAY_READ_TOKEN`.

```env
COP_TAK_GATEWAY_ENABLED=false
COP_TAK_GATEWAY_BASE_URL=https://sim.zeleznalady.cz/tak-gateway/api/v1
COP_TAK_GATEWAY_READ_TOKEN=<tajny-token-ze-SIM>
COP_TAK_GATEWAY_CACHE_TTL_MS=5000
COP_TAK_GATEWAY_STALE_IF_ERROR_MS=60000
COP_TAK_GATEWAY_MAX_LIMIT=250
COP_TAK_GATEWAY_TIMEOUT_MS=7000
```

TAK Gateway je defaultně vypnutý a jeho COP endpointy vyžadují přihlášenou relaci. Vrstva `traffic` je záměrně zobrazena jako `TAK Gateway > Traffic tracks`, aby se nepletla s veřejnou dopravní vrstvou ze `situation-data`.

## Community Report Store

Komunitní hlášení patří do COP, nikoli do SIM. Produkční režim používá stejný HA PostgreSQL/Patroni endpoint jako track history a user profile store. Databáze musí mít dostupné a vytvořené rozšíření PostGIS.

```env
COP_COMMUNITY_REPORT_STORE=postgres
COP_DATABASE_URL=postgresql://cop_app:<password>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
```

Store při inicializaci vytvoří/aktualizuje tabulky `cop_community_reports` a `cop_community_report_attachments`, doplní `geometry(Point,4326)` sloupce a GiST indexy. Binární média se neukládají do PostgreSQL; metadata příloh odkazují na SeaweedFS/S3 objekt přes `bucket` a `objectKey`.

## Map Tiles

Web i nativní klienti musí mapový podklad číst z konfigurace, ne z pevně zadrátované URL. Produkce má po zřízení `tiles.zeleznalady.cz` používat first-party tile/cache endpoint.

```env
COP_MAP_STYLE_URL=
COP_TILE_URL=https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png
COP_TILE_GLYPHS_URL=https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf
COP_TILE_ATTRIBUTION="&copy; OpenStreetMap contributors"
```

Pokud je vyplněné `COP_MAP_STYLE_URL`, web použije přímo MapLibre style URL a `COP_TILE_URL` slouží jen jako fallback pro klienty bez podpory style endpointu. Pokud je `COP_MAP_STYLE_URL` prázdné, web si vytvoří raster style z `COP_TILE_URL`.

Detailní postup pro `dmz.home.cz`, nginx cache a následný vlastní tile server je v [10 Tile Cache and Map Tiles](10_TILE_CACHE_AND_MAP_TILES.md).
