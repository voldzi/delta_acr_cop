# Native iOS/iPadOS COP App

Tento dokument popisuje, co je potřeba pro samostatnou nativní aplikaci pro iPhone a iPad. Cílem je profesionální mobilní klient Civilní situační mapy: rychlý situační obraz, civilní vrstvy rizik, offline/degraded provoz, alerty, zdrojová důvěryhodnost a bezpečná práce s identitou. Aplikace nesmí obsahovat targeting, navádění, weapon workflow ani doporučení použití síly.

## Rozsah první verze

První nativní verze má nahradit PWA na iPhone/iPad tam, kde je potřeba lepší offline UX, bezpečnější lokální úložiště, přesnější geolokace, příprava na MDM a napojení na push notifikace doručované přes CSM Messaging.

Součástí v1:

- přihlášení přes Keycloak/OIDC s Authorization Code + PKCE,
- mobilní bootstrap jedním API voláním,
- mapa s OpenStreetMap podkladem a APP-6/NATO symboly,
- current COP tracks, detail objektu, provenance, confidence a source health,
- serverové alerty a potvrzení alertu,
- moje poloha a lokální proximity výstraha jako mapová vrstva,
- historie stop v sekundách a read-only replay,
- lokální šifrovaný offline snapshot,
- offline outbox pro uživatelská hlášení s fotkou a polohou,
- jasný režim `ONLINE`, `DEGRADED`, `OFFLINE`,
- auditovatelná registrace zařízení pro COP session/MDM policy,
- deep link handling pro notifikace doručené přes CSM Messaging.

Mimo v1:

- editace nebo zadávání taktických úkolů,
- přímé odesílání push notifikací z COP nebo ukládání APNS tokenů v COP,
- certifikace interoperability,
- AI mimo informační shrnutí a datovou kvalitu.

## Nové mobilní API

Backend doplňuje tři nativní endpointy pod `/api/v1/mobile`. Všechny používají stejný bearer token jako web.

### `GET /api/v1/mobile/bootstrap`

Startup endpoint pro iPhone/iPad. Vrací identitu, konfiguraci, endpoint discovery, mapu, mobile policy, profil uživatele a aktuální read-only snapshot.

Query parametry:

- `seconds`: časové okno historie v sekundách, výchozí `180`.
- `limit`: limit bodů historie na objekt, výchozí `120`, maximum `1000`.
- `objectIds`: volitelný comma-separated filtr objektů.
- `includeExpired`: volitelně zahrnout expired/stale data.
- `includeAcknowledged`: volitelně zahrnout potvrzené alerty.

Klient používá odpověď pro první render a uloží `snapshot` do lokálního šifrovaného úložiště.

`map.styleUrl`, `map.tileTemplateUrl` a `map.glyphsTemplateUrl` jsou konfigurační hodnoty pro mapový podklad. Pokud je `styleUrl` vyplněné, klient ho použije jako MapLibre style. Jinak použije raster tile template. Produkční klient nesmí mít natvrdo zadrátovaný veřejný tile server; musí používat hodnoty z bootstrapu, aby šlo přepnout na `tiles.zeleznalady.cz` bez nové verze aplikace.

### `GET /api/v1/mobile/offline-snapshot`

Lehčí endpoint pro pravidelnou obnovu offline cache. Vrací pouze policy-filtered snapshot: health, objects, source health, sources, stream health, alerts a track history.

Klient ho volá:

- po přihlášení,
- po návratu aplikace do foregroundu,
- před přechodem do offline režimu, pokud je síť dostupná,
- periodicky v degraded režimu podle nastavení serveru.

API endpointy se v zařízení necachují jako HTTP cache. Klient ukládá pouze explicitní `snapshot` a řídí se `cachePolicy.offlineCacheTtlSeconds`.

### `POST /api/v1/mobile/devices`

Pilotní registrace COP device session. Server vytvoří audit event a vrátí device session policy. Tento endpoint není push registry. Raw APNS token se v COP neukládá a COP přes něj push neposílá.

Minimální payload:

```json
{
  "deviceId": "ios-vendor-or-mdm-id",
  "platform": "ipados",
  "appVersion": "0.1.0",
  "buildNumber": "42",
  "osVersion": "18.5",
  "deviceModel": "iPad14,3",
  "capabilities": ["offlineSnapshot", "sseStream"]
}
```

Pole `pushToken` je zachováno jen kvůli kompatibilitě staršího klienta a neslouží k produkčnímu push doručování. CSM Messenger iOS musí APNs token registrovat přímo v CSM Messaging přes `POST /api/v1/devices`.

## Push notifikace a CSM Messenger

Push notifikace nepatří do COP mobile API. Autoritativní služba pro zařízení,
APNs a delivery audit je CSM Messaging.

CSM Messenger iOS má implementovat:

- `POST /api/v1/devices` vůči CSM Messaging s APNs tokenem, platformou,
  locale, timezone a schopnostmi zařízení;
- obnovu registrace při změně APNs tokenu;
- správu notifikačních preferencí pro přímé zprávy, skupinové zprávy,
  bezpečnostní výstrahy a systémová oznámení;
- deep linky `csm://map/alert/<alertId>`, `csm://map/report/<reportId>`,
  `csm://chat/room/<roomId>` a `csm://message/<messageId>`.

COP v tomto toku vyhodnocuje relevanci bezpečnostních a komunitních událostí a
server-side volá CSM Messaging `POST /api/v1/notifications`. iOS klient ani
CSM Messenger nesmí volat SIM přímo a nesmí rozhodovat, zda se SIM výstraha
týká daného uživatele.

Pro chat deep linky je COP autoritativní pro metadata konverzace. iOS klient po
push notifikaci nemá stahovat celý seznam a filtrovat lokálně. Použije:

- `GET /api/v1/messaging/conversations/{conversationId}`, pokud push/deep link obsahuje COP `conversationId`;
- `GET /api/v1/messaging/conversations/resolve?roomId=<encodedRoomId>`, pokud má pouze Matrix `roomId`.

Samotný `messageId` nestačí, protože COP nečte Matrix timeline a nesmí být
plaintext ani Matrix-message proxy. Push payload pro zprávu má proto vedle
`messageId` nést také `roomId` nebo `conversationId`.

## Existující API používané aplikací

Nativní klient nemá znovu vymýšlet kontrakty. Použije:

- `GET /api/v1/stream/cop/live` pro SSE live stream,
- `GET /api/v1/cop/tracks` jako kompatibilní current tracks endpoint,
- `GET /api/v1/cop/track-history` pro detailní historii,
- `GET /api/v1/cop/alerts` pro serverové alerty,
- `POST /api/v1/cop/alerts/{alertId}/acknowledge` pro potvrzení alertu,
- `GET/PUT /api/v1/me/preferences` pro serverové preference,
- `GET /api/v1/community/reports` pro komunitní mapovou vrstvu,
- `POST /api/v1/community/reports` pro vytvoření hlášení,
- `PATCH /api/v1/community/reports/{reportId}` pro úpravu vlastního hlášení,
- `DELETE /api/v1/community/reports/{reportId}` pro smazání vlastního hlášení,
- `GET/POST /api/v1/community/groups` pro skupiny, do kterých se hlášení a média ukládají,
- `GET /api/v1/demo/scenarios` a `POST /api/v1/demo/scenarios/flood-central-bohemia/seed` pro kontrolovanou PoC ukázku,
- `GET /api/v1/sketch/palettes` pro civilní a profesionální palety zákresů,
- `GET /api/v1/sketch/drawings` pro zákresovou vrstvu podle aktuálního bbox mapy,
- `POST /api/v1/sketch/drawings` pro vytvoření zákresu,
- `GET/PATCH/DELETE /api/v1/sketch/drawings/{drawingId}` pro detail, editaci a smazání vlastního zákresu,
- `GET /api/v1/messaging/conversations/{conversationId}` pro detail metadata konverzace,
- `GET /api/v1/messaging/conversations/resolve?roomId=<encodedRoomId>` pro mapování Matrix roomu na COP konverzaci,
- `POST /api/v1/community/reports/{reportId}/attachments` pro presigned upload fotky/videa/dokumentu,
- `POST /api/v1/community/reports/{reportId}/attachments/{attachmentId}/complete` pro potvrzení uploadu,
- `POST /api/v1/community/reports/{reportId}/submit` pro odeslání hlášení ke sdílení,
- `GET /api/v1/sources` a `/api/v1/sources/health`,
- `POST /api/v1/notifications/safety/evaluate` pouze pro operator/diagnostický tok vyhodnocení safety výstrah; běžný iOS push přijde přes CSM Messaging,
- `POST /api/v1/ai/situation-summary` pro serverový situační souhrn,
- `POST /api/v1/ai/source-health-summary` pro srozumitelné vysvětlení kvality zdrojů,
- `POST /api/v1/ai/community-report/draft` pro pomoc s textem hlášení,
- `POST /api/v1/ai/cop-assistant/query` pouze pro pokročilé povolené informační dotazy.

Nativní klient nevolá Ollama, AI KnowledgeBase LLM Gateway ani žádný modelový
provider přímo. AI kontext skládá COP server podle oprávnění uživatele a výsledek
audituje.

Demo endpointy jsou určeny jen pro pilotní prezentace a testovací účty. Klient
nesmí demo data zapisovat lokálně mimo běžný offline cache/outbox mechanismus;
seed/reset vždy spouští COP server-side a objekty jsou označené
`demoScenarioId=flood-central-bohemia`.

Sdíleným datovým základem pro web i iOS je
[Canonical Entity Model v2](../data/07_CANONICAL_ENTITY_MODEL_V2.md). Nativní
klient nemusí zobrazit všechna governance pole, ale musí respektovat
`releasePolicy`, `confidence`, `dataQuality`, `provenance`, časovou platnost a
stale stav. Eventové chování a budoucí AsyncAPI směr jsou popsány v
[Event Contract and AsyncAPI Direction](../integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md).

Nativní iOS klient má před vytvořením hlášení načíst polohu z média, pokud je dostupná. Pro fotky použít metadata z Photos/EXIF, pro video a iPhone Spatial Video preferovat AVFoundation/Photos metadata. Pokud uživatel polohu z média potvrdí, poslat `location.source="media_metadata"`. Hlášení musí být vždy přiřazené do COP skupiny; nová skupina vytvořená z hlášení má dostat `anchorLocation` z první polohy reportu.

## Mapový katalog pro nativní klienty

Nativní klient nesmí skládat menu vrstev z provider `/layers`, `/sources` ani z legacy `/cop/features`. Autoritativní vstup je:

- `GET /api/v1/map/catalog?locale=cs-CZ`
- `POST /api/v1/map/query`
- `GET /api/v1/map/raster-overlay?url=<encodedUrl>` pro `kind=raster_overlay`

Uživatelův výběr vrstev se ukládá do `preferences.catalogLayerIds`. Jazyk aplikace se ukládá do `preferences.language` (`cs` nebo `en`). Podklad mapy se ukládá do `preferences.mapBasemapMode`. Webový klient navíc ukládá rozložení pracovní plochy do `preferences.workspaceLayout`, vizuální skin do `preferences.workspaceSkin` (`civil`, `operations`, `field`) a profilovou kartu do `preferences.operatorProfile`; nativní klient může tato pole zobrazit nebo ignorovat, ale nesmí je mazat při ukládání vlastních preferencí.

Klient musí podporovat tyto druhy katalogových vrstev:

- `vector_features`: bbox GeoJSON prvky pro běžné mapové overlaye.
- `static_reference`: pomalu se měnící referenční data.
- `track_stream`: pohyblivé objekty přes COP stream/state.
- `user_objects`: uživatelská hlášení, zóny a komunitní prvky.
- `aggregate`: složená vrstva, kterou COP rozpadá na více provider dotazů.
- `mvt_tiles` a `raster_tiles`: dlaždicové vrstvy.
- `raster_overlay`: jedna georeferencovaná obrazová vrstva; polygon ve feature je pouze rozsah rastru a nesmí se kreslit jako vyplněný polygon.
- `grid_field` a `vector_field`: hustá pole pro počasí, kvalitu ovzduší, vítr nebo podobné analytické vrstvy.

Pokud aktuální verze iOS klienta neumí některý `kind` vykreslit, nesmí kvůli tomu selhat katalog. Takovou vrstvu skryje z běžného výběru, zobrazí ji maximálně v diagnostice a dál respektuje `selectable`, `audience`, `role`, `minZoom`, `maxZoom`, `filters`, `legal` a `provenance`.

U `raster_overlay` klient používá `providerProperties.raster.url`, `boundsWgs84`, `opacity` a případnou atribuci. Obrázek ale nenačítá přímo z externí URL; hodnotu `providerProperties.raster.url` percent-encoduje a volá COP endpoint `/api/v1/map/raster-overlay`. Pokud image overlay nepodporuje, vrstvu nezobrazí; nikdy nesmí vybarvit extent polygon jako meteorologickou plochu.

ČHMÚ radar je speciální případ `raster_overlay`. Nativní klient nikdy nevolá
ČHMÚ ani SIM přímo. Použije jen URL z `providerProperties.raster.url`; ta má v
produkci směřovat na SIM clean endpoint `/api/v1/weather-radar/clean/...` a
klient ji znovu předá přes COP `/api/v1/map/raster-overlay`. Pole
`rawUrl`/`sourceUrl` jsou pouze diagnostika. Pro animaci radaru klient načítá
COP endpoint:

```http
GET /api/v1/weather-radar/frames?product=merge1h&hours=6&limit=24
```

Snímky se seřadí podle `observedAt` vzestupně a přehrávají se přes
`frame.cleanUrl`, opět výhradně přes `/api/v1/map/raster-overlay`. Živý režim
může obnovit katalog přibližně každých 300 sekund.

Vrstva `public.weather.current` není plošná vrstva. Je to bodový aktuální
souhrn počasí pro střed aktuálního mapového výřezu. Klient ji zobrazí jako jeden
marker nebo detail "Počasí ve středu oblasti"; pro plošné počasí použije grid a
field vrstvy (`public.weather.temperature_grid`,
`public.weather.precipitation_grid`, `public.weather.wind_field`,
`public.weather.humidity_grid`, `public.weather.pressure_grid`).

Provider identifikátory, sourceId a technické vstupy se v běžném UI nezobrazují jako mapové vrstvy. Patří do detailu/provenance a diagnostiky.

## Doporučená architektura iOS aplikace

Minimum OS cílit podle podporovaných zařízení. Pro první pilot je praktické použít moderní SwiftUI architekturu a izolovat síť/data tak, aby šla snadno testovat.

Navržené moduly:

- `AppShell`: lifecycle, přihlášení, root navigation.
- `Auth`: OIDC/PKCE, token refresh, logout.
- `CopApiClient`: OpenAPI-generated nebo ručně typovaný REST klient.
- `CopStreamClient`: SSE parser nad `URLSession` streamem.
- `CopStore`: aktuální in-memory stav, merge snapshot/delta, stale/lost vyhodnocení.
- `OfflineStore`: šifrovaný lokální snapshot, metadata stáří, read-only fallback.
- `CommunityOutbox`: lokální šifrovaná fronta hlášení a příloh čekajících na upload.
- `MapWorkspace`: MapLibre render, vrstvy, symboly, AOI/proximity kruhy.
- `AlertCenter`: serverové alerty, lokální proximity výstrahy, ack flow.
- `Settings/Profile`: vrstvy, historie, predikce, refresh/degraded preference.
- `Diagnostics`: source health, stream status, dependency stav, build info.

Stav aplikace:

- `ONLINE`: bootstrap nebo stream je čerstvý, API dostupné.
- `DEGRADED`: stream selhal, ale REST fallback nebo snapshot refresh funguje.
- `OFFLINE`: API není dostupné, zobrazuje se jen poslední lokální snapshot.

Offline režim je read-only. Uživatel musí vždy vidět stáří snapshotu a že data nejsou live.

Zákresy v nativním klientovi mají vlastní offline outbox. Nový nebo upravený
zákres se lokálně ukládá šifrovaně a po obnovení spojení se odešle přes
`/api/v1/sketch/drawings`. Při konfliktu revize klient nesmí změnu tiše
přepsat; zobrazí konflikt a nabídne uložení jako novou úpravu.

## UI pro iPhone a iPad

iPhone:

- první obrazovka mapa,
- spodní taby: `Mapa`, `Data`, `Výstrahy`, `Zdroje`, `Nastavení`,
- detail objektu jako sheet z mapy,
- zákresy jako samostatný mapový režim s explicitním přepnutím mezi pohybem mapy a kreslením,
- alert banner nesmí zakrýt mapové ovládání,
- režim `OFFLINE/DEGRADED` viditelný v horní stavové liště.

iPad:

- split workspace: levý navigační sidebar, střed mapa, pravý inspector,
- podpora landscape jako primární režim,
- detail objektu a source health vedle mapy,
- vlastnosti vybraného zákresu v pravém inspektoru nebo bottom sheetu,
- replay/timeline jako spodní panel.
- rozložení panelů má respektovat `preferences.workspaceLayout`, pokud ho nativní klient podporuje; jinak ho zachovat beze změny na serveru.

V obou režimech:

- vlastní prvky modré, cizí červené,
- mapové výstrahy jako velmi průsvitné kruhy,
- žádný text ani akce, které by naznačovaly použití síly.

## Offline data a bezpečnost

Klient ukládá jen poslední policy-filtered snapshot, ne raw ingest data.

Doporučení:

- snapshot ukládat šifrovaně v device-protected storage,
- tokeny ukládat do Keychain,
- snapshot vázat na `subjectId`; po logoutu smazat,
- při změně uživatele nepoužít cache předchozího uživatele,
- respektovat `offlineCacheTtlSeconds`,
- po překročení TTL zobrazit snapshot jako stale, ne jako live,
- APNS token nikdy nelogovat,
- APNS tokeny neposílat do COP; registrují se v CSM Messaging,
- OIDC access token neposílat do logů ani crash reportů.

MDM/MAM příprava:

- minimální verze aplikace řízená přes `policy.minimumAppVersion`,
- budoucí `requireManagedDevice`,
- budoucí forced logout/minimum app build,
- možnost zakázat offline cache pro vybrané role.

## Sync algoritmus

1. App start.
2. Načíst lokální snapshot pro `subjectId`, pokud existuje.
3. Pokud je token platný, volat `/api/v1/mobile/bootstrap`.
4. Zobrazit bootstrap snapshot a uložit ho do `OfflineStore`.
5. Načíst katalog mapových vrstev přes `/api/v1/map/catalog` a podle aktuálního bbox mapy volat `/api/v1/map/query` s vybranými katalogovými `layerIds`. Raster overlay obrázky načítat jen přes `/api/v1/map/raster-overlay`.
6. Načíst komunitní hlášení přes `/api/v1/community/reports` podle aktuálního bbox mapy.
7. Otevřít SSE `/api/v1/stream/cop/live`.
8. `snapshot` zprávou nahradit current state.
9. `delta` zprávy mergovat podle `objectId`.
10. Při výpadku streamu přepnout na `DEGRADED` a volat `/api/v1/mobile/offline-snapshot`.
11. Při výpadku API přepnout na `OFFLINE` a držet read-only snapshot.
12. Po obnově spojení znovu zavolat bootstrap/offline snapshot a přepnout stav podle streamu.
13. Pokud `CommunityOutbox` obsahuje čekající hlášení, odeslat je v pořadí: report, upload slot, upload média, complete, submit.
14. Pokud klient používá federovaný edge režim, obnovit heartbeat přes
    `POST /api/v1/federation/nodes/{nodeId}/heartbeat`, odeslat lokální domain
    eventy přes `POST /api/v1/edge/outbox/flush`, stáhnout centrální
    policy-filtered replay přes `GET /api/v1/edge/replay/{nodeId}` a po
    durable zpracování potvrdit `nextOffset` přes
    `POST /api/v1/edge/replay-cursors/{nodeId}/ack`.

Edge klient nesmí pro běžnou synchronizaci používat globální
`GET /api/v1/events/domain`; tento endpoint je určený pro centrální replay a
diagnostiku. MCP registry (`/api/v1/mcp/tools`) je read-only, auditovaný a
neslouží jako mobilní write API.

## Generování klienta

OpenAPI kontrakt je v `docs/api/openapi-main-cop.yaml`. Pro iOS lze použít generátor Swift klienta, ale doporučuji držet ručně psanou tenkou síťovou vrstvu nad generovanými DTO. Důvod: SSE stream, offline store a doménové merge chování je lepší vlastnit v aplikaci.

Modely, které musí být stabilní:

- `MobileBootstrap`,
- `MobileOfflineSnapshot`,
- `CommunityReport`,
- `CommunityReportAttachment`,
- `CommunityUploadSlot`,
- `SketchDrawing`,
- `SketchDrawingCollection`,
- `SketchPaletteResponse`,
- `ObservedObject`,
- `TrackHistoryPoint`,
- `CopAlert`,
- `SourceHealthItem`,
- `SituationLayer`,
- `SituationFeatureCollection`,
- `UserPreferenceProfile`.
- `DomainEventRecord`,
- `EdgeDomainEventReplayResponse`,
- `EdgeReplayCursor`,
- `CopMcpTool`.

## Build a distribuce

Pilotní konfigurace:

- bundle id například `cz.zeleznalady.cop`,
- display name `COP`,
- custom URL scheme `cop`,
- Associated Domains později pro universal links,
- Keychain access group podle Apple Team ID,
- background mode zatím nepovolovat pro trvalý stream; refresh dělat při foregroundu,
- push capability patří do CSM Messenger iOS a zapíná se proti CSM Messaging, ne proti COP API.

Distribuce:

- interní TestFlight pro pilot,
- samostatné prostředí pro `cop.zeleznalady.cz`,
- build metadata zobrazit v Diagnostics,
- crash/log sanitizace před veřejným provozem.

## Akceptační kritéria v1

- Uživatel se přihlásí přes Keycloak a vidí svůj profil.
- Aplikace po startu vykreslí mapu z `/api/v1/mobile/bootstrap`.
- Po vypnutí sítě zůstane read-only mapa s jasným `OFFLINE` stavem.
- Po obnovení sítě se obnoví snapshot a stream.
- Historie v sekundách se zobrazuje pro vybrané objekty.
- Serverové alerty lze potvrdit.
- Uživatel vytvoří report s povinnou polohou, přidá fotku a aplikace ho odešle přes presigned upload.
- Při ztrátě sítě report zůstane v šifrovaném outboxu a odešle se později.
- Proximity alert se zobrazuje jako průsvitný kruh na mapě.
- COP device registration API vrací policy a nezobrazuje ani neukládá raw APNS token.
- iPhone i iPad layout neobsahuje překryvy, které blokují mapu.
- UI neobsahuje targeting, navádění ani weapon workflow.

## Další fáze

- napojení CSM Messenger deep linků na mapu, reporty, alerty a chat,
- persistentní evidence APNS zařízení v CSM Messaging,
- MDM policy a device trust,
- vector tile/offline map pack management,
- audit AI dotazů v mobilním klientovi,
- contract tests proti vygenerovanému Swift klientovi.
