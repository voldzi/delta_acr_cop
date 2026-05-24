# Native iOS/iPadOS COP App

Tento dokument popisuje, co je potřeba pro samostatnou nativní aplikaci pro iPhone a iPad. Cílem je profesionální mobilní COP klient inspirovaný principy DELTA: rychlý situační obraz, vrstvy, offline/degraded provoz, alerty, zdrojová důvěryhodnost a bezpečná práce s identitou. Aplikace nesmí obsahovat targeting, navádění, weapon workflow ani doporučení použití síly.

## Rozsah první verze

První nativní verze má nahradit PWA na iPhone/iPad tam, kde je potřeba lepší offline UX, bezpečnější lokální úložiště, přesnější geolokace, příprava na MDM a budoucí push notifikace.

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
- auditovatelná registrace zařízení pro budoucí APNS/MDM policy.

Mimo v1:

- editace nebo zadávání taktických úkolů,
- push notifikace přes APNS,
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

Pilotní registrace zařízení. Server vytvoří audit event a vrátí device session policy. Raw APNS token se nevrací v odpovědi. V této fázi se push neposílá; endpoint připravuje kontrakt pro budoucí APNS/MDM.

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

Volitelně lze poslat `pushToken`; server vrátí jen `pushTokenRegistered: true`.

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
- `POST /api/v1/community/reports/{reportId}/attachments` pro presigned upload fotky/videa/dokumentu,
- `POST /api/v1/community/reports/{reportId}/attachments/{attachmentId}/complete` pro potvrzení uploadu,
- `POST /api/v1/community/reports/{reportId}/submit` pro odeslání hlášení ke sdílení,
- `GET /api/v1/sources` a `/api/v1/sources/health`,
- `POST /api/v1/ai/cop-assistant/query` pouze pro povolené informační dotazy.

Nativní iOS klient má před vytvořením hlášení načíst polohu z média, pokud je dostupná. Pro fotky použít metadata z Photos/EXIF, pro video a iPhone Spatial Video preferovat AVFoundation/Photos metadata. Pokud uživatel polohu z média potvrdí, poslat `location.source="media_metadata"`. Hlášení musí být vždy přiřazené do COP skupiny; nová skupina vytvořená z hlášení má dostat `anchorLocation` z první polohy reportu.

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

## UI pro iPhone a iPad

iPhone:

- první obrazovka mapa,
- spodní taby: `Mapa`, `Data`, `Výstrahy`, `Zdroje`, `Nastavení`,
- detail objektu jako sheet z mapy,
- alert banner nesmí zakrýt mapové ovládání,
- režim `OFFLINE/DEGRADED` viditelný v horní stavové liště.

iPad:

- split workspace: levý navigační sidebar, střed mapa, pravý inspector,
- podpora landscape jako primární režim,
- detail objektu a source health vedle mapy,
- replay/timeline jako spodní panel.

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
5. Načíst katalog mapových vrstev přes `/api/v1/map/catalog` a podle aktuálního bbox mapy volat `/api/v1/map/query` s vybranými katalogovými `layerIds`.
6. Načíst komunitní hlášení přes `/api/v1/community/reports` podle aktuálního bbox mapy.
7. Otevřít SSE `/api/v1/stream/cop/live`.
8. `snapshot` zprávou nahradit current state.
9. `delta` zprávy mergovat podle `objectId`.
10. Při výpadku streamu přepnout na `DEGRADED` a volat `/api/v1/mobile/offline-snapshot`.
11. Při výpadku API přepnout na `OFFLINE` a držet read-only snapshot.
12. Po obnově spojení znovu zavolat bootstrap/offline snapshot a přepnout stav podle streamu.
13. Pokud `CommunityOutbox` obsahuje čekající hlášení, odeslat je v pořadí: report, upload slot, upload média, complete, submit.

## Generování klienta

OpenAPI kontrakt je v `docs/api/openapi-main-cop.yaml`. Pro iOS lze použít generátor Swift klienta, ale doporučuji držet ručně psanou tenkou síťovou vrstvu nad generovanými DTO. Důvod: SSE stream, offline store a doménové merge chování je lepší vlastnit v aplikaci.

Modely, které musí být stabilní:

- `MobileBootstrap`,
- `MobileOfflineSnapshot`,
- `CommunityReport`,
- `CommunityReportAttachment`,
- `CommunityUploadSlot`,
- `ObservedObject`,
- `TrackHistoryPoint`,
- `CopAlert`,
- `SourceHealthItem`,
- `SituationLayer`,
- `SituationFeatureCollection`,
- `UserPreferenceProfile`.

## Build a distribuce

Pilotní konfigurace:

- bundle id například `cz.zeleznalady.cop`,
- display name `COP`,
- custom URL scheme `cop`,
- Associated Domains později pro universal links,
- Keychain access group podle Apple Team ID,
- background mode zatím nepovolovat pro trvalý stream; refresh dělat při foregroundu,
- push capability zapnout až po dokončení APNS backendu.

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
- Device registration API vrací policy a nezobrazuje raw APNS token.
- iPhone i iPad layout neobsahuje překryvy, které blokují mapu.
- UI neobsahuje targeting, navádění ani weapon workflow.

## Další fáze

- APNS notifikace pro informační alerty,
- persistentní serverová evidence mobilních zařízení,
- MDM policy a device trust,
- vector tile/offline map pack management,
- audit AI dotazů v mobilním klientovi,
- contract tests proti vygenerovanému Swift klientovi.
