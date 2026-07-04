# 03 Environment Configuration

Environment configuration musí oddělit vývoj, test, demo a produkční režim.

## Kategorie proměnných

- API porty a base URLs,
- webové runtime porty a public base paths,
- database/cache/event bus connection strings,
- OIDC issuer/client configuration,
- Source Registry bootstrap,
- AI provider enable/disable flags (`COP_EXTERNAL_AI_ENABLED`,
  `COP_AI_DEFAULT_PROVIDER`, `COP_AI_OLLAMA_*`, volitelně `COP_AI_LOCAL_*`),
- track lifecycle thresholds (`COP_TRACK_STALE_AFTER_MS`, `COP_TRACK_EXPIRE_AFTER_MS`),
- federation runtime persistence (`COP_FEDERATION_STORE`, volitelně stejný `COP_DATABASE_URL`),
- temporal history persistence (`COP_TRACK_HISTORY_STORE`, `COP_DATABASE_URL`, `COP_DATABASE_SSL`),
- user profile persistence (`COP_USER_PROFILE_STORE`, volitelně stejný `COP_DATABASE_URL` jako temporal store),
- community report persistence (`COP_COMMUNITY_REPORT_STORE`, vyžaduje PostGIS při PostgreSQL backendu),
- stream distribution limits (`COP_STREAM_BACKPRESSURE_CLIENTS`, `COP_STREAM_RETRY_MS`),
- mapový podklad (`COP_MAP_STYLE_URL`, `COP_TILE_URL`, `COP_TILE_GLYPHS_URL`, `COP_TILE_ATTRIBUTION`),
- server-side veřejný letový zdroj ze SIM (`COP_FLIGHT_DATA_ENABLED`, `COP_FLIGHT_DATA_BASE_URL`, `COP_FLIGHT_DATA_SOURCE`, `COP_FLIGHT_DATA_POLL_MS`),
- kontextové situační vrstvy ze SIM (`COP_SITUATION_DATA_ENABLED`, `COP_SITUATION_DATA_BASE_URL`, `COP_SITUATION_DATA_CACHE_TTL_MS`),
- bezpečnostní veřejné vrstvy ze SIM (`COP_SAFETY_DATA_ENABLED`, `COP_SAFETY_DATA_BASE_URL`, `COP_SAFETY_DATA_CACHE_TTL_MS`),
- partnerský neveřejný TAK/CoT gateway zdroj ze SIM (`COP_TAK_GATEWAY_ENABLED`, `COP_TAK_GATEWAY_BASE_URL`, `COP_TAK_GATEWAY_READ_TOKEN`),
- prezentační Mission Arena vrstva (`COP_MISSION_ARENA_ENABLED`, `COP_MISSION_ARENA_BASE_URL`),
- classification policy,
- audit retention,
- metrics/exporter nastavení,
- feature flags pro degraded/offline režim.

Citlivé hodnoty nesmí být commitované do repozitáře.

## Web Runtime Ports

Lokální a pilotní compose používá oddělené runtime služby pro mapový shell a
samostatný chat:

```env
COP_API_PORT=4310
COP_WEB_PORT=4311
COP_CHAT_PORT=4314
COP_CHAT_PROXY_TARGET=http://localhost:4314
COP_PUBLIC_API_BASE_URL=
COP_DEPLOY_DOMAIN=cop.zeleznalady.cz
COP_WEB_ALLOWED_HOSTS=docker.home.cz,cop.zeleznalady.cz
COP_CHAT_ALLOWED_HOSTS=docker.home.cz,cop.zeleznalady.cz
COP_CHAT_BASE_PATH=/chat/
COP_CHAT_OIDC_TOKEN_ENDPOINT=/chat/oidc/token
COP_API_ALLOWED_ORIGINS=https://cop.zeleznalady.cz,http://docker.home.cz:4311,http://docker.home.cz:4314
COP_API_RATE_LIMIT_MAX=2400
COP_API_RATE_LIMIT_WINDOW=1 minute
COP_API_COMPRESS_THRESHOLD_BYTES=1024
COP_API_MAX_EVENT_LOOP_DELAY_MS=1000
```

`COP_PUBLIC_API_BASE_URL` má být při publikaci pod `cop.zeleznalady.cz`
prázdné, aby oba browser klienti volali COP API relativně přes `/api/...`.
`COP_CHAT_BASE_PATH` musí odpovídat DMZ nginx pravidlu pro `/chat/`.
`COP_CHAT_OIDC_TOKEN_ENDPOINT` je same-origin proxy používaná jen samostatným
chatem pro OIDC token exchange; chrání `/chat/` před browser blokací
public-to-private token requestů, když `login.zeleznalady.cz` v pilotní síti
rezolvuje na privátní adresu.
`COP_CHAT_ALLOWED_HOSTS` omezuje HTTP Host i CORS `Origin` pro tuto token proxy,
aby endpoint neodrážel libovolný cizí origin.
`COP_CHAT_PROXY_TARGET` používá pouze lokální Vite dev server mapové aplikace,
aby iframe `/chat/` v COP při vývoji směroval na samostatný `cop-chat`.

COP API registruje produkční ochranné hlavičky, kompresi odpovědí, rate-limit a
kontrolu event-loop tlaku. `COP_API_ALLOWED_ORIGINS` je browser CORS allow-list;
požadavky bez `Origin` hlavičky zůstávají povolené kvůli server-to-server,
mobilním klientům, health checkům a diagnostice. Do produkčního allow-listu
nepatří obecné wildcard hodnoty.

## Mobile Pairing / CSM Messenger

COP poskytuje webové párování pro nativní CSM Messenger iOS/iPadOS aplikaci,
device registry a serverový ACK gateway pro šifrovaný mobile mesh relay. V
produkci nesmí být tyto runtime záznamy pouze v paměti procesu; použijte stejný
HA PostgreSQL/Patroni endpoint jako pro ostatní COP stores.

```env
COP_PUBLIC_URL=https://cop.zeleznalady.cz
COP_IOS_APP_ID=LM6W548X36.cz.zeleznalady.csm.messenger
COP_MOBILE_REDIRECT_SCHEME=csm
COP_MOBILE_DEVICE_STORE=postgres
COP_DATABASE_URL=postgresql://cop_app:<password>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
```

`COP_IOS_APP_ID` se promítá do
`/.well-known/apple-app-site-association`. Universal link
`https://cop.zeleznalady.cz/mobile/pair/{code}` a custom scheme
`csm://pair?code={code}` obsahují pouze krátkodobý párovací kód, nikdy COP
access token, refresh token, Matrix token, recovery key ani room keys.
`COP_MOBILE_DEVICE_STORE=auto` je přípustné jen pro lokální vývoj bez
`COP_DATABASE_URL`; produkce musí používat `postgres`.

CSM Messenger APNs tokeny se ukládají pouze v CSM Messaging službě. COP do iOS
bootstrapu ani pairing odpovědí neposílá `COP_CSM_MESSAGING_TOKEN`, APNs token,
Matrix admin token, recovery key, room keys ani plaintext chat obsah. Mobile
mesh endpointy `/api/v1/mobile/mesh/ingest` a `/api/v1/mobile/mesh/acks` drží
jen auditovatelný ACK stav pro `csm-mesh-v1` encrypted/signed bundles.

## AI Provider / COP Ollama Provider

COP podporuje asistivní AI přes `@cop/ai-gateway`. Produkční lokální režim
nevolá Ollamu přímo z browseru; `cop-api` ji volá server-side přes vlastní
COP Ollama provider. AI KnowledgeBase LLM Gateway může zůstat jako kompatibilní
fallback.

```env
COP_EXTERNAL_AI_ENABLED=true
COP_AI_DEFAULT_PROVIDER=ollama
COP_AI_HEALTH_DEPENDENCY_TIMEOUT_MS=10000
COP_AI_MODEL_ROUTER_ENABLED=true
COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD=70
COP_AI_OLLAMA_BASE_URLS=http://192.168.200.2:11434,http://host.docker.internal:11434,http://192.168.1.176:11434
COP_AI_OLLAMA_TOKEN=<service-token-pokud-je-vyžadován>
COP_AI_OLLAMA_FAST_MODEL=gemma4:12b-mlx
COP_AI_OLLAMA_MODEL=gemma4:12b-mlx
COP_AI_OLLAMA_MAX_TOKENS=512
COP_AI_OLLAMA_TIMEOUT_MS=30000
COP_AI_OLLAMA_RETRY_ATTEMPTS=2
COP_AI_OLLAMA_THINK=false
COP_AI_OLLAMA_REASONING_MODEL=gemma4:31b-mlx
COP_AI_OLLAMA_REASONING_MAX_TOKENS=1200
COP_AI_OLLAMA_REASONING_TIMEOUT_MS=90000
COP_AI_OLLAMA_REASONING_RETRY_ATTEMPTS=1
COP_AI_OLLAMA_REASONING_THINK=false
COP_AI_OLLAMA_EMBEDDING_MODEL=bge-m3:latest
COP_AI_OLLAMA_EMBEDDING_TIMEOUT_MS=10000
COP_AI_SEMANTIC_RETRIEVAL_ENABLED=true
COP_AI_SEMANTIC_RETRIEVAL_MAX_DOCUMENTS=12
COP_AI_SEMANTIC_RETRIEVAL_CACHE_ENTRIES=500
COP_AI_CONTEXT_INDEX_ENABLED=true
COP_AI_CONTEXT_INDEX_REFRESH_SECONDS=120
COP_AI_CONTEXT_INDEX_MAX_DOCUMENTS=800
COP_AI_CONTEXT_INDEX_QUERY_LIMIT=8
COP_AI_CONTEXT_INDEX_LOOKBACK_SECONDS=604800
COP_AI_CONTEXT_INDEX_DEFAULT_RADIUS_KM=30
COP_AI_CONTEXT_INDEX_OBJECT_LIMIT=250
COP_AI_CONTEXT_INDEX_COMMUNITY_REPORT_LIMIT=250
COP_AI_CONTEXT_INDEX_INCIDENT_LIMIT=200
```

Bezpečný vývojový default zůstává:

```env
COP_EXTERNAL_AI_ENABLED=false
COP_AI_DEFAULT_PROVIDER=mock
```

`COP_AI_OLLAMA_TOKEN` a `COP_AI_LOCAL_GATEWAY_TOKEN` jsou server-side hodnoty a nesmí mít prefix
`VITE_`. Web klient posílá `providerPreference=auto`, takže provider volí až
COP API podle konfigurace. `COP_AI_MODEL_ROUTER_ENABLED=true` zapíná
deterministický router `deterministic-v1`: rychlé dotazy používají
`COP_AI_OLLAMA_FAST_MODEL`, komplexní situační/konfliktní dotazy nad prahem
`COP_AI_MODEL_ROUTER_COMPLEXITY_THRESHOLD` používají
`COP_AI_OLLAMA_REASONING_MODEL`. `COP_AI_OLLAMA_MODEL` zůstává kompatibilní
alias pro fast profil. `COP_AI_OLLAMA_EMBEDDING_MODEL` připravuje server-side
embedding provider pro retrieval/RAG nad policy-filtered COP daty; klienti ho
nevolají přímo. `COP_AI_SEMANTIC_RETRIEVAL_ENABLED` zapíná server-side
semantic context vrstvu pro AI endpointy. Vrstva indexuje jen už autorizovaný
kontext dotazu, používá LRU cache embeddingů a do LLM předává jen omezený počet
nejrelevantnějších dokumentů. `COP_AI_CONTEXT_INDEX_*` řídí background COP index
pro AI agenta: refresh, velikost snapshotu, výchozí geo-radius, lookback a počty
canonical entit jednotlivých typů. Guardrails se vyhodnocují před každým voláním LLM.
Chat agent defaultuje na fast profil, pokud klient nepošle explicitní
`modelPreference`; těžký reasoning profil se používá pro explicitní
`modelPreference=reasoning` nebo vědomě zvolený `auto` routing.
`/health/dependencies` ukazuje `ai-gateway` jako `ok`, `degraded` nebo
`disabled` a `ai-context-index` jako stav background indexu; degraded AI nesmí
blokovat mapu, reporting ani chat.

Volitelný compatibility fallback:

```env
COP_AI_LOCAL_GATEWAY_URL=http://docker.home.cz:3220/llm-gateway
COP_AI_LOCAL_GATEWAY_TOKEN=<service-token-pokud-ho-AKB-vyžaduje>
COP_AI_LOCAL_MODEL=gemma4:12b-mlx
COP_AI_LOCAL_MAX_TOKENS=512
COP_AI_LOCAL_TIMEOUT_MS=30000
COP_AI_LOCAL_RETRY_ATTEMPTS=2
COP_AI_LOCAL_THINK=false
```

## Flight Data Source

COP čte veřejné nebo licencované letové tracky pouze přes agregovaný SIM kontrakt `cop-flight-source-v1`. Klientská aplikace nevolá ADS-B/OpenSky endpointy přímo.

```env
COP_FLIGHT_DATA_ENABLED=true
COP_FLIGHT_DATA_BASE_URL=http://docker.home.cz:5020/flight-data
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
COP_SITUATION_DATA_BASE_URL=http://docker.home.cz:5020/situation-data/api/v1
COP_SITUATION_DATA_CACHE_TTL_MS=20000
COP_SITUATION_DATA_MAX_LIMIT=5000
COP_SITUATION_DATA_TIMEOUT_MS=15000
COP_SITUATION_DATA_OSM_POSTGIS_CACHE_TTL_MS=21600000
COP_SITUATION_DATA_MOBILE_NETWORK_CACHE_TTL_MS=600000
COP_SITUATION_DATA_CHMI_WEATHER_STATIONS_CACHE_TTL_MS=600000
COP_SITUATION_DATA_CHMI_WEATHER_WEBCAMS_CACHE_TTL_MS=600000
COP_SITUATION_DATA_CHMI_AIR_QUALITY_CACHE_TTL_MS=900000
COP_SITUATION_DATA_MOBILE_NETWORK_MODEL_CACHE_TTL_MS=600000
COP_WEATHER_RADAR_FRAMES_CACHE_SECONDS=120
COP_WEATHER_CAMERA_ALLOWED_HOSTS=docker.home.cz,sim.zeleznalady.cz
COP_WEATHER_CAMERA_DETAIL_CACHE_SECONDS=60
COP_WEATHER_CAMERA_IMAGE_CACHE_SECONDS=180
COP_WEATHER_CAMERA_TIMEOUT_MS=8000
```

Web klient volá pouze source-neutral COP API (`/api/v1/map/catalog`, `/api/v1/map/query`). COP API při volání SIM nepřeposílá bearer token operátora a v produkci používá interní server-to-server URL `http://docker.home.cz:5020/...`, nikoli veřejné browser API. COP při čtení katalogu načítá také `GET /situation-data/api/v1/taxonomy`; taxonomy zůstává server-side a promítá se do Source Health, zatímco rozhodování o významu vrstev a jevů vychází ze stabilních polí `layerId`, `sourceId`, `typeCode`, `category`, `severity`, `metrics`, `tags` a `localized`, ne z českého nebo anglického textu. Při výpadku SIM endpointu vrací prázdný degraded `FeatureCollection`, aby mapa zůstala použitelná. Timeout je vyšší než běžná obnovovací kadence mapy, protože kombinované veřejné vrstvy mohou po studeném startu trvat několik sekund.

ČHMÚ radar COP načítá pouze přes SIM. Aktuální raster overlay používá SIM clean
URL z `providerProperties.raster.url`; frame katalog pro animaci jde přes COP
endpoint `/api/v1/weather-radar/frames` a jeho krátkou serverovou cache řídí
`COP_WEATHER_RADAR_FRAMES_CACHE_SECONDS` v rozsahu 60-300 sekund.

ČHMÚ webkamery COP z klienta nenačítá přímo z upstream ČHMÚ. Klient používá
pouze URL předané v `providerProperties.camera.detailUrl` nebo `snapshotUrl`
a přeposílá je přes `/api/v1/weather/webcam-proxy`. Proxy povoluje jen hosty
v `COP_WEATHER_CAMERA_ALLOWED_HOSTS` a přímé hosty `chmi.cz` blokuje.

## Safety Data Source

COP čte veřejná bezpečnostní data ze SIM kontraktu `cop-safety-source-v1` přes samostatnou API proxy. Jde o civilní kontextové vrstvy (`warnings`, `flood`), nikoli COP tracky, temporal history ani rozhodovací workflow. V UI jsou vedené jako samostatná skupina „Bezpečnostní data“.

```env
COP_SAFETY_DATA_ENABLED=true
COP_SAFETY_DATA_BASE_URL=http://docker.home.cz:5020/safety-data/api/v1
COP_SAFETY_DATA_CACHE_TTL_MS=120000
COP_SAFETY_DATA_WARNINGS_CACHE_TTL_MS=120000
COP_SAFETY_DATA_FLOOD_CACHE_TTL_MS=300000
COP_SAFETY_DATA_MAX_LIMIT=600
COP_SAFETY_DATA_OBSERVABILITY_CACHE_TTL_MS=60000
COP_SAFETY_DATA_TIMEOUT_MS=15000
```

Web klient volá pouze source-neutral COP API (`/api/v1/map/catalog`, `/api/v1/map/query`). COP API při volání SIM nepřeposílá bearer token operátora a v produkci používá interní server-to-server URL `http://docker.home.cz:5020/...`, nikoli veřejné browser API. COP při čtení katalogu načítá také `GET /safety-data/api/v1/taxonomy`; taxonomy zůstává server-side a promítá se do Source Health. ČHMÚ výstrahy se vyhodnocují podle normalizovaných polí `typeCode`, `sourceCode`, `sourceSystem`, `hazardType`, `category`, `severity`, `validFrom`, `validUntil`, `metrics`, `providerProperties.taxonomy`, `providerProperties.presentation` a `providerProperties.notification`; jazyková varianta `localized.cs`/`localized.en` je pouze prezentace a nesmí vytvářet duplicitní události. COP slučuje malé posuny mapy do kanonického bbox cache klíče a při výpadku vrací prázdný degraded `FeatureCollection`.

COP také server-side čte `GET /safety-data/api/v1/observability`. Tento endpoint se nepoužívá jako mapová vrstva; promítá se jen do Source Health jako provozní kvalita safety provideru, cache hit-rate, stale feature count a varování zdrojových cache. `status=degraded` znamená sníženou kvalitu externích dat, ne výpadek SIM.

## TAK Gateway Source

COP čte neveřejná partnerská TAK/CoT data ze SIM kontraktu `cop-tak-source-v1` pouze server-side. Token zůstává v procesu `cop-api`; web klient volá jen `/api/v1/map/catalog` a `/api/v1/map/query` a v prohlížeči nikdy nemá `COP_TAK_GATEWAY_READ_TOKEN`.

```env
COP_TAK_GATEWAY_ENABLED=false
COP_TAK_GATEWAY_BASE_URL=http://docker.home.cz:5020/tak-gateway/api/v1
COP_TAK_GATEWAY_READ_TOKEN=<tajny-token-ze-SIM>
COP_TAK_GATEWAY_CACHE_TTL_MS=5000
COP_TAK_GATEWAY_STALE_IF_ERROR_MS=60000
COP_TAK_GATEWAY_MAX_LIMIT=250
COP_TAK_GATEWAY_TIMEOUT_MS=7000
```

TAK Gateway je defaultně vypnutý a jeho COP endpointy vyžadují přihlášenou relaci. Vrstva `traffic` je záměrně zobrazena jako `TAK Gateway > Traffic tracks`, aby se nepletla s veřejnou dopravní vrstvou ze `situation-data`.

## Mission Arena Source

COP může číst prezentační stav Mission Arena eventu přes kontrakt `cop-provider-featurecollection-v1`. Jde o vrstvu pro zobrazení stavu mise/týmů a skóre dodaného poskytovatelem. COP skóre nepočítá, nevyhodnocuje správnost rozhodnutí a neukládá hlasy; pouze zobrazuje vrstvu `presentation.mission_arena`.

```env
COP_MISSION_ARENA_ENABLED=false
COP_MISSION_ARENA_BASE_URL=https://missionarena.zeleznalady.cz
COP_MISSION_ARENA_TOKEN=<MISSION_ARENA_COP_TOKEN>
COP_MISSION_ARENA_CACHE_TTL_MS=5000
COP_MISSION_ARENA_TIMEOUT_MS=5000
```

Vrstva je defaultně vypnutá v katalogu, aby se nepletla s běžnými civilními situačními daty. Po zapnutí se objeví ve skupině „Prezentace a eventy“. `featureRole=mission_state` se zobrazuje jako stav mise, `featureRole=team_state` jako stav týmu; barvy a skóre jsou převzaté z Mission Arena. Token zůstává pouze v `cop-api`; web klient jej nikdy nedostává.

## Community Report Store

Komunitní hlášení patří do COP, nikoli do SIM. Produkční režim používá stejný HA PostgreSQL/Patroni endpoint jako track history a user profile store. Databáze musí mít dostupné a vytvořené rozšíření PostGIS.

```env
COP_COMMUNITY_REPORT_STORE=postgres
COP_DATABASE_URL=postgresql://cop_app:<password>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
```

Store při inicializaci vytvoří/aktualizuje tabulky `cop_community_reports` a `cop_community_report_attachments`, doplní `geometry(Point,4326)` sloupce a GiST indexy. Binární média se neukládají do PostgreSQL; metadata příloh odkazují na SeaweedFS/S3 objekt přes `bucket` a `objectKey`.

## Incident Store

Incidenty a incidentní úkoly patří do COP. Vznikají ručně operátorem nebo
potvrzením deterministického fusion návrhu nad komunitními hlášeními. Produkce
má používat stejný HA PostgreSQL/Patroni endpoint jako ostatní COP stores.
Vývojový režim `auto` přejde bez `COP_DATABASE_URL` do paměti.

```env
COP_INCIDENT_STORE=postgres
COP_DATABASE_URL=postgresql://cop_app:<password>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
```

Store při inicializaci vytvoří tabulky `cop_incidents` a
`cop_incident_tasks`. Změny incidentů publikují audit a domain events
`incident.created`, `incident.updated`, `task.created` a
`task.status.changed`. Tyto eventy nesou guardrails `NO_TARGETING` a
`NO_WEAPON_WORKFLOW`; incidentní úkoly slouží k civilní koordinaci, ne k
taktickému navádění.

## Federation Runtime Store

Federace, edge outbox a replay domain eventů jsou aplikační runtime data COP.
Produkční režim má používat stejný HA PostgreSQL/Patroni endpoint jako ostatní
COP stores. Bez databáze zůstává in-memory fallback pouze pro vývoj.

```env
COP_FEDERATION_STORE=auto
COP_DATABASE_URL=postgresql://cop_app:<password>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
```

Store při inicializaci vytvoří tabulky `cop_federation_nodes`,
`cop_domain_events`, `cop_domain_dead_letters` a `cop_edge_replay_cursors`.
`cop_domain_events` používá serverem přidělený `replay_offset` a idempotenci
podle `event_id`, takže edge klient může bezpečně opakovat flush offline
outboxu. `cop_edge_replay_cursors` drží monotónní durable acknowledgement pro
edge replay. `cop_domain_dead_letters` drží i lifecycle stav (`open`,
`redriven`, `resolved`), počet re-drive pokusů a operátora, který záznam
uzavřel.

Edge klienti pro stahování centrálních eventů používají
`GET /api/v1/edge/replay/{nodeId}`. Tento endpoint je policy-filtered: vrací jen
eventy, které registrovaný `edge-node` smí vidět podle `classificationMax` a
`releasePolicy`. Globální `GET /api/v1/events/domain` je určený pro centrální
operátorský replay a diagnostiku, ne jako běžný sync endpoint pro terénní
zařízení. Po durable zpracování položek z edge replay odpovědi klient potvrzuje
`nextOffset` přes `POST /api/v1/edge/replay-cursors/{nodeId}/ack`.

## Edge Node Runtime

Pilotní `cop-edge-node` služba běží jako samostatný kontejner. Nepřistupuje
přímo do SIM. Komunikuje pouze s centrálním COP API přes server-side bearer
token, drží lokální file-backed state a pravidelně provádí heartbeat, outbox
flush a edge replay pull.

```env
COP_EDGE_PORT=4312
COP_EDGE_NODE_ID=node_edge_pilot_01
COP_EDGE_NODE_NAME="CSM Edge Pilot Node"
COP_EDGE_CLASSIFICATION_MAX=INTERNAL
COP_EDGE_CENTRAL_API_URL=http://cop-api:4310
COP_EDGE_CENTRAL_TOKEN=<same-value-as-COP_LAB_TOKEN-or-service-token>
COP_EDGE_ADMIN_TOKEN=<random-long-secret-for-edge-admin-posts>
COP_EDGE_AUTO_SYNC=true
COP_EDGE_SYNC_INTERVAL_MS=10000
```

Pokud se edge publikuje z DMZ, má být pod cestou
`https://cop.zeleznalady.cz/edge/` a proxy má směřovat na
`http://docker.home.cz:4312/edge/`. Měnící endpointy `POST /edge/sync` a
`POST /edge/outbox` vyžadují `COP_EDGE_ADMIN_TOKEN`; bez něj fail-closed vrací
`401`. Detailní provozní postup je v
[13 Edge Node Runtime](13_EDGE_NODE_RUNTIME.md).

Provozní obsluha DLQ používá výhradně COP API:

- `GET /api/v1/events/dead-letter` pro seznam odmítnutých eventů,
- `GET /api/v1/events/dead-letter/{deadLetterId}` pro detail,
- `POST /api/v1/events/dead-letter/{deadLetterId}/redrive` pro publikaci
  opraveného eventu,
- `POST /api/v1/events/dead-letter/{deadLetterId}/resolve` pro uzavření bez
  publikace náhradního eventu.

Nevalidní re-drive payload se vrací jako validační chyba a nezakládá další DLQ
záznam. To je záměrné, aby operátor neopakoval chybu rekurzivně.

## MCP Tool Gateway

Pilotní MCP gateway běží jako samostatná služba `cop-mcp-gateway` na portu
`4313`. Externí agenti mají používat endpointy služby:

- `POST /mcp` je stateless MCP JSON-RPC endpoint. Podporuje `initialize`,
  `notifications/initialized`, `ping`, `tools/list` a `tools/call` nad stejným
  allowlistem jako COP API.
- `GET /mcp` vrací client-safe popis MCP endpointu a podporovaných metod.
- `GET /mcp/tools` vrací allowlist read-only nástrojů.
- `POST /mcp/tools/{toolId}/invoke` volá konkrétní read-only nástroj přes COP
  API.

Gateway má dvě oddělené autentizační hranice:

- `COP_MCP_GATEWAY_TOKEN` chrání vstup pro externí agenty. V produkci musí být
  nastavený a klient jej posílá jako `Authorization: Bearer ...`.
- `COP_MCP_CENTRAL_TOKEN` je server-side token, kterým gateway volá centrální
  COP API. Tento token se nikdy neposílá do browseru ani agentovi.

Původní endpointy `GET/POST /api/v1/mcp*` zůstávají v COP API jako interní a
kompatibilní facade. Zdroj pravdy pro allowlist, audit, policy-filtering a
domain event `ai.tool.invoked` zůstává centrální COP API.

Endpointy neslouží jako proxy do SIM, CSM Messaging ani Matrixu. Do klienta se
přes ně nesmí dostat provider service tokeny, Matrix admin tokeny, plaintext
chat zprávy ani binární média. Měnící workflow musí dál probíhat přes běžné COP
command API s explicitním potvrzením uživatele.

Pro publikaci pod COP doménou použijte samostatné DMZ proxy pravidlo na
`http://docker.home.cz:4313`. Doporučené veřejné cesty jsou `/mcp` a `/mcp/`;
`/api/v1/mcp*` ponechte jako interní/kompatibilní cestu pro COP API.

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
