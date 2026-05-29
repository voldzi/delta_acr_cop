# 06 Professional Civil Map Roadmap

Tento plán převádí produktovou analýzu do bezpečného rozvoje civilní situační aplikace. Rozvoj se drží obecných principů profesionálního situačního obrazu: web-first práce, vrstvy, realtime data, degraded provoz, auditovatelnost, timeline/replay a práce se zdroji. Plán nesmí zavádět targeting, navádění, weapon workflow ani doporučení použití síly.

## Stav k 2026-05-19

| Oblast | Stav | Poznámka |
| --- | --- | --- |
| Profesionální mapové COP UI | Dokončeno v pilotu | Mapová plocha, vrstvy, detail objektu, refresh, historie/predikce, per-user nastavení, PWA metadata, offline shell, responzivní tablet/telefon režim a veřejné publikování. |
| SIM integrace | Dokončeno v pilotu | COP přijímá a zobrazuje cíle ze SIM projektu přes ingest kontrakt, agregovaný `flight-data-api` zdroj, kontextové `situation-data-api` vrstvy a bezpečnostní `safety-data-api` vrstvy. |
| Profesionální symbolika | Dokončeno v pilotu | Civilní režim je výchozí, profesionální režim drží konzistentní symboliku a barvy podle dostupných metadat. |
| Lifecycle objektů | Dokončeno v pilotu | Aktivní/stale/lost stav chrání mapu před trvalým zobrazováním zastavených simulovaných dat. |
| Proximity awareness | Dokončeno v pilotu | Uživatel může zobrazit vlastní polohu a průsvitnou varovnou vrstvu přiblížení cizích objektů. |
| Server-side temporal history | Rozpracováno | API drží body stop, web je používá jako zdroj pro historii tras a PostgreSQL store přes HAProxy/Patroni persistuje historii i current snapshot. |
| Timeline/replay | Rozpracováno v pilotu | UI má časové okno historie v sekundách; replay controller používá serverovou historii pro historické polohy objektů. |
| Stream/delta distribuce | Pilotně hotovo | SSE endpoint posílá snapshot, delta a heartbeat; web používá stream jako primární kanál, fallback synchronizaci a lokální read-only snapshot pro degraded/offline režim. |
| Perzistence a multi-user provoz | Částečně | UI nastavení a profily pohledu jsou lokální pro operátorský scope/prohlížeč; current tracks, historie a serverové uživatelské profily mají PostgreSQL backend. |

## Prioritizované kroky

### P1: Stabilní živý situační obraz

Status: pilotně hotovo.

- mapová pracovní plocha s OpenStreetMap podkladem,
- čitelná civilní/profesionální symbolika podle režimu zobrazení,
- přepínače vrstev a syntetických dat,
- volitelná frekvence refresh,
- lifecycle stop: active, stale, lost,
- veřejná publikace přes `cop.zeleznalady.cz`.

### P2: Časová data, historie a replay

Status: probíhá.

- server drží časovou historii objektů jako samostatný temporal model,
- web načítá historii přes `/api/v1/cop/track-history`,
- UI časové okno historie může být v sekundách,
- temporal history lze persistovat do PostgreSQL přes `haproxy.home.cz`,
- current snapshot se persistuje do PostgreSQL a obnovuje při startu API,
- replay controller nad serverovou časovou osou přepíná mapu mezi live a historickým časem,
- další krok je retence a stránkování dlouhých tras.

### P3: Realtime distribuce

Status: pilotně hotovo.

- polling je doplněný skutečným SSE streamem,
- server posílá snapshot, delta a heartbeat,
- policy filtering zůstává na serveru,
- refresh interval je přesunutý do nastavení jako fallback/degraded synchronizace,
- web měří stav streamu, latenci, heartbeat, reconnecty a poslední chybu,
- server zveřejňuje stream health, Prometheus metriky a backpressure/reconnect provozní signály,
- další krok je retence stream health historie a napojení na externí monitoring.

### P4: Operační nastavení a uživatelský profil

Status: pilotně hotovo pro lokální profily, serverový profil čeká na produkční identity policy.

- workspace model rozděluje práci na Mapa, Data, Zdroje, Výstrahy, Replay a Nastavení,
- lokální profily pohledu ukládají vrstvu, filtr, refresh, historii, predikci a mapový zoom pro daný operátorský scope,
- centrum nastavení zůstává přes operátorskou ikonu a drží detailní volby mapy, dat, polohy a účtu,
- lokální mapové nastavení je oddělené od budoucího serverového profilu,
- přidat Keycloak login bez zásahu do existujících realmů,
- uložit sdílené preference až po zavedení identity a jasné politiky.

### P5: Zdrojová důvěryhodnost a provozní dohled

Status: pilotně hotovo, serverová evidence konfliktů a Alert Center v1 doplněny.

- stav zdrojů, latence, poslední event a degradace,
- Object detail v2 vysvětluje confidence, provenance, lineage a informační konflikty,
- server vrací `conflictEvidence` v aktuálních track objektech a samostatně přes `/api/v1/cop/conflicts`,
- Alert Center vrací informační alerty přes `/api/v1/cop/alerts`, podporuje potvrzení alertu a mapovou alert vrstvu,
- uživatelský profil může ukládat AOI pravidlo, server z něj odvozuje informační `AOI_ENTRY` alert a mapa zobrazuje velmi průsvitnou oblast zájmu,
- další krok je robustnější fusion skórování, retence potvrzení alertů, více AOI pravidel a historie alertů,
- metriky pro retenční velikost temporal store a stream latency.

## Evidence realizace

| Datum | Krok | Výsledek |
| --- | --- | --- |
| 2026-05-19 | Temporal history API v1 | Přidán in-memory temporal store a endpoint `/api/v1/cop/track-history`; web jej používá pro zobrazení historie tras. |
| 2026-05-19 | PostgreSQL temporal store v1 | Přidán volitelný PostgreSQL backend pro historii stop přes `COP_TRACK_HISTORY_STORE=postgres` a `COP_DATABASE_URL`; runbook popisuje napojení na HAProxy/Patroni. |
| 2026-05-19 | PostgreSQL current snapshot v1 | Přidán `cop_current_tracks`, UPSERT při ingestu a obnova aktuálních objektů při startu API. |
| 2026-05-19 | SSE live stream v1 | Přidán `/api/v1/stream/cop/live`, snapshot/delta/heartbeat zprávy, klientské čtení přes `fetch` stream s bearer hlavičkou a fallback synchronizace. |
| 2026-05-19 | Source Health + provenance v1 | Přidán health endpoint zdrojů, UI Source Health Center a provenance metadata v detailu objektu. |
| 2026-05-19 | Replay controller v1 | Timeline umí přepnout mapu z live režimu do historického času a objektům nastavuje polohy z `/api/v1/cop/track-history`. |
| 2026-05-19 | Responsive COP workspace v1 | Tablet a telefon režim drží mapu jako primární plochu, zkracuje horní lištu a ponechává nastavení dostupné přes operátorskou ikonu. |
| 2026-05-19 | Workspace + view profiles v1 | Přidána modulová navigace Mapa/Data/Zdroje/Výstrahy/Replay/Nastavení a lokální profily pohledu per operátorský scope. |
| 2026-05-19 | Object detail v2 + lineage | Detail objektu má sekce Identita/Poloha/Symbologie/Zdroj/Confidence/Data lineage/Konflikty/Source history a informační detekci datových konfliktů. |
| 2026-05-19 | Server conflict evidence v1 | API odvozuje konfliktní evidenci z aktuálního objektu, historie a source health; `/api/v1/cop/tracks`, SSE a `/api/v1/cop/conflicts` ji poskytují klientům. |
| 2026-05-19 | Alert Center v1 | Přidány serverové alerty, acknowledgement endpoint, audit potvrzení a UI workspace Výstrahy s mapovou alert vrstvou. |
| 2026-05-19 | Fallback sync UX | Refresh interval přejmenován a přesunut do nastavení jako degraded/fallback synchronizace; hlavní panel ponechává jen ruční obnovu. |
| 2026-05-19 | Stream observability v1 | Web zobrazuje `LIVE` / `DEGRADED` / `OFFLINE`, latenci streamu, poslední heartbeat, reconnecty a poslední chybu v Data readiness. |
| 2026-05-19 | PostgreSQL pool hardening v1 | API obsluhuje idle-client chyby `pg.Pool`, aby HAProxy/Patroni ukončení spojení neshodilo celý proces; diagnostika se propisuje do dependency health. |
| 2026-05-19 | Stream Health + backpressure v1 | Přidán `/api/v1/stream/cop/health`, Prometheus stream metriky, SSE `backpressure`/`reconnect_required` provozní zprávy a UI panel `Stream Health`. |
| 2026-05-19 | Keycloak user profiles v1 | Přidán `/api/v1/me/preferences`, serverové preference podle OIDC `sub`, per-user potvrzení alertů, PostgreSQL tabulky `cop_user_profiles` a `cop_user_alert_acknowledgements`, UI stav synchronizace profilu. |
| 2026-05-19 | AOI alerting v1 | Přidán typ alertu `AOI_ENTRY`, uložení AOI pravidla v serverovém profilu, výpočet vstupu objektu do oblasti zájmu a samostatná velmi průsvitná AOI vrstva v mapě. |
| 2026-05-19 | PWA offline/degraded mode v1 | Přidán service worker pro offline shell, lokální cache posledního COP snapshotu per operátorský scope a jasné UI `ONLINE` / `DEGRADED` / `OFFLINE` s read-only fallbackem. |
| 2026-05-19 | Native iOS/iPadOS API baseline | Přidány endpointy `/api/v1/mobile/bootstrap`, `/api/v1/mobile/offline-snapshot`, `/api/v1/mobile/devices` a realizační dokument pro nativní mobilní aplikaci. |
| 2026-05-20 | Public flight data source v1 | Přidán server-side pull adapter pro SIM `flight-data-api`, canonical mapping `PUBLIC_FLIGHT_AGGREGATE`, Source Health override, vrstva `Public flights`, detail licencí/providerů a provozní env konfigurace. |
| 2026-05-20 | Situation data source v1 | Přidána COP proxy pro SIM `situation-data-api`, canonical mapping `PUBLIC_SITUATION_AGGREGATE`, bbox/cache dotazy, mapové vrstvy `weather`/`ground`/`mobile`/`traffic`, detail feature a uživatelské preference vrstev bez zásahu do COP tracků. |
| 2026-05-20 | Safety data source v1 | Přidána server-side COP integrace se SIM `safety-data-api`, canonical mapping `PUBLIC_SAFETY_AGGREGATE`, vrstvy `warnings`/`flood`, samostatné UI ovládání, Source Health a bbox cache bez ukládání do track history. Veřejný klientský kontrakt je nyní sjednocený přes `/api/v1/map/catalog` a `/api/v1/map/query`. |
| 2026-05-21 | TAK Gateway production source v1 | Přidána volitelná server-side COP integrace se SIM `tak-gateway-api`, canonical typ `TAK_COT_GATEWAY`, krátká bbox cache, token pouze na backendu, Source Health a samostatná neveřejná skupina vrstev `Mobile units`/`Ground markers`/`Traffic tracks`. Veřejný klientský kontrakt je nyní sjednocený přes `/api/v1/map/catalog` a `/api/v1/map/query`. |
| 2026-05-21 | Community reports PostGIS store v1 | Komunitní hlášení v COP PostgreSQL store používají PostGIS `geometry(Point,4326)` a GiST indexy pro bbox dotazy; `lat/lon` zůstává v API kvůli kompatibilitě a média zůstávají v SeaweedFS/S3. |
| 2026-05-21 | Map tile cache readiness v1 | Web a mobilní bootstrap podporují `COP_MAP_STYLE_URL`, `COP_TILE_URL` a `COP_TILE_GLYPHS_URL`; PWA cache zahrnuje mapové dlaždice/glyph assets a runbook popisuje `tiles.zeleznalady.cz`, nginx cache a následný vlastní tile server nad PostGIS/PMTiles. |
