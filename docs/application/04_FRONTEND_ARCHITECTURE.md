# 04 Frontend Architecture

Webový klient je operační konzument COP state. Jeho účelem je rychlá orientace, filtrování vrstev, detail objektu, timeline/replay, stav zdrojů a vysvětlení confidence/provenance.

Pilot má dvě React/Vite webové plochy:

- `apps/cop-web` je hlavní mapový PWA shell.
- `apps/cop-chat` je samostatná chatovací aplikace buildnutá s base path
  `/chat/`. Sdílí existující COP auth helpery, metadata API klienta a
  Matrix/E2EE klienta z `cop-web`, ale UI drží mimo mapový shell.

Hlavní shell nesmí znovu vlastnit čisté odvozování provozního režimu ani
formátování transportních chyb. Tyto odpovědnosti jsou oddělené v
`operating-mode.ts` a `ui/data-availability.tsx`, aby se daly testovat bez
renderu celé mapy. Uživatelská cesta zobrazuje stručný stav a automatickou
obnovu; endpointy, stavové kódy a diagnostický text jsou dostupné pouze v
rozbalovacím detailu pro správce.

Obě webové plochy se v produkci servírují jako statické Vite buildy přes
projektový Node runtime, ne přes vývojový `vite preview`. Runtime musí:

- komprimovat textové assety přes Brotli nebo gzip podle `Accept-Encoding`,
- servírovat hashed `/assets/*` s `Cache-Control: public, max-age=31536000,
immutable`,
- vracet `404` pro chybějící hashed assety místo HTML fallbacku,
- povolit SPA fallback pouze pro aplikační routy bez přípony,
- držet `index.html`, `site.webmanifest` a service worker v `no-cache` režimu.

## Doporučený stack

- Next.js + React,
- MapLibre GL nebo ekvivalent,
- WebSocket/SSE klient pro delta updates,
- lokální state management pro UI filtry a subscription,
- komponenta AI assistant drawer napojená pouze na povolené AI endpointy.

## Zásady

UI musí jasně odlišit syntetická data, stale objekty, konflikty zdrojů a degraded režim. UI nesmí obsahovat targeting, navádění ani workflow použití síly.

### Mobilní design baseline

Hlavní PWA i samostatný chat podporují kompaktní telefon od 320 CSS pixelů a
krátký portrétní viewport od 568 CSS pixelů. Na této hranici platí:

- stránka nesmí vytvářet horizontální scroll ani ořezávat kritický stav;
- primární akce a zavírací prvky mají nejméně 44px dotykovou plochu, pouze
  sekundární mapové úchyty mohou mít 40px při zachování okolního prostoru;
- textové `input`, `select` a `textarea` mají na mobilu nejméně 16px písmo,
  aby WebKit při fokusu nezvětšil viewport a nerozbil šířku dialogu;
- dlouhý dialog má pevnou hlavičku a akce a právě jeden vnitřní scroll;
- dvousloupcové metriky, menu a akce se na 320–360 px skládají do jednoho
  sloupce;
- PWA safe-area se vlastní právě jednou: hostitelská spodní navigace ji nesmí
  duplikovat ve vloženém chatu;
- celoplošné mobilní overlaye nepoužívají `backdrop-filter`; pevný průsvitný
  povrch zachovává čitelnost bez drahé průběžné kompozice na iOS;
- text stavu se nesmí zobrazit jako bezvýznamná useknutá zkratka; prioritní
  výstraha má pod 600 px vlastní řádek s úplným textem. Panely výstrah pod
  860 px používají společné svislé posouvání.

Statické kontrakty pro tuto hranici jsou v
`apps/cop-web/src/mobile-layout.styles.test.ts` a
`apps/cop-chat/src/ChatApp.styles.test.ts`. Změny mobilního shellu se ověřují
také vizuálně na 320 × 568 a na aktuálním iPhone Max viewportu.

## Mapový podklad

Frontend používá MapLibre. Mapový styl je konfigurovatelný:

- obecná konfigurace, URL validace, raster fallback, atribuce, clustering,
  bounds a prezentace běžné GeoJSON trasy pocházejí z neutrálního balíčku
  `@zeleznalady/geo-client`;
- MapLibre runtime i velká komponenta `CopMap` zůstávají vlastnictvím COP;
  sdílený balíček proto nepřidává druhou kopii MapLibre ani COP doménové typy;

- `VITE_COP_MAP_STYLE_URL` má přednost a umožňuje přepnout na vlastní vector/raster tile server bez změny klientského kódu,
- pokud style URL není nastavené, klient vytvoří raster style z `VITE_COP_TILE_URL`,
- glyph endpoint je samostatně řízený přes `VITE_COP_TILE_GLYPHS_URL`,
- PWA service worker cacheuje mapové dlaždice a glyph assets pro opakované zobrazení, ale neprefetchuje mapy mimo aktuální viewport.

Produkční provoz nemá směřovat tisíce klientů přímo na veřejný OSM tile server. Přechodný a cílový postup je popsaný v runbooku [10 Tile Cache and Map Tiles](../runbooks/10_TILE_CACHE_AND_MAP_TILES.md).

## Vyhledávání nad mapou

Globální vyhledávací pole v mapovém režimu kombinuje dvě kategorie výsledků:

- lokálně zobrazené COP objekty a mapové prvky z aktuálně zapnutých vrstev,
- veřejná místa přes serverový endpoint `GET /api/v1/geocode/search`.

Web klient nevolá externí geocoder přímo. Dotaz jde přes COP API, kde je možné provider vyměnit, omezovat a cacheovat. Výběr místa nevybírá žádný COP objekt, pouze vyčistí aktivní detail a plynule přesune mapu na souřadnice se zoomem doporučeným providerem.

## Výkon klienta

Mapa je primární pracovní plocha, proto úvodní bundle nesmí nést těžké moduly,
které uživatel nepotřebuje při prvním zobrazení. Web klient proto drží tyto
části jako lazy-loaded workspace moduly:

- komunikace a Matrix chat panel,
- samostatná `/chat/` aplikace pro plnoobrazovkový messenger bez mapového
  shellu,
- datová tabulka objektů nad TanStack Table,
- XR/WebXR workspace,
- 3D Cesium workspace na samostatné routě `/globe`; viewer, data ani statické
  Cesium assety se neaktivují při běžném otevření 2D mapy,
- renderer NATO/APP-6 symbolů používaný až při registraci mapových ikon,
- MapLibre runtime v samostatném bundlu řízeném Vite manual chunkem.

Při dalších úpravách platí:

- nové velké panely přidávat přes `React.lazy` nebo samostatný route/workspace
  chunk,
- MapLibre, Matrix SDK, Three.js, NATO symbol renderer a tabulkové/grid
  knihovny nenačítat do hlavního mapového shellu, pokud nejsou potřeba ihned,
- po větších změnách kontrolovat výpis `pnpm --filter @cop/cop-web build` a
  sledovat hlavně první `index-*.js` bundle,
- monitor uživatelské odezvy načítat dynamicky po shellu; výpadek měření nesmí
  ovlivnit spuštění nebo práci s mapou,
- před release spouštět `pnpm check:release`, které sestaví všechny aplikace a
  zkontroluje rozpočty pro web shell, mapové runtime chunky, chat shell, Matrix
  runtime, PDF viewer/worker a Office/archive parser,
- `pnpm check:static-runtime` ověřuje, že web i chat runtime po buildu vrací
  správné hlavičky pro kompresi, immutable cache a `404` pro chybějící assety,
- `pnpm format:check` pokrývá aktivně spravovaný rozsah `apps/cop-web`,
  `apps/cop-chat`, `packages/geo-client`, `packages/messaging` a release skripty; celorepo formátování
  se nezapíná skokově, aby nezaneslo velký historický churn mimo aktuální
  vlastnictví,
- veřejný build nesmí obsahovat serverové tokeny ani interní provider URL.

Veřejný anonymní vstup na `/` nabízí tři úkoly běžným jazykem: zjistit výstrahy
v okolí, podat hlášení a otevřít celou mapu. Úvod se po první volbě zapamatuje a
nezobrazuje se nad sdíleným nebo hlubokým odkazem. Operátorské vrstvy zůstávají
v hlavním shellu, ale nejsou podmínkou pro splnění veřejných cest.

3D workspace používá stejná COP data a policy jako 2D mapa. Běží v režimu
`requestRenderMode`, omezuje počet objektů a historii podle schopností zařízení,
má vlastní obnovovací frekvenci a zobrazuje rozdíl mezi měřenou, krátce
odhadnutou a zastaralou polohou. Kamera i vrstvy mají verzovaný share kontrakt.
Podrobnosti a původ návrhových vzorů jsou v [ADR-0022](../adr/0022_OPT_IN_3D_SITUATION_WORKSPACE.md).

PWA shell instaluje novou verzi teprve po ověření kritického HTML, manifestů a
všech odkazovaných entry assetů. Jednotlivé volitelné ikony instalaci
nezablokují, kritické požadavky mají omezený retry a pomalé obnovení navigace
zůstává připojené k `FetchEvent.waitUntil`. Registrace opakuje kontrolu po
krátkém výpadku i po návratu online. Po převzetí kontroly se dokument obnoví
jednou, ale až když v textovém poli nebo file pickeru nezůstává rozepsaný obsah.

Velké situační offline snapshoty patří primárně do IndexedDB; synchronní
`localStorage` je vyhrazen jen pro malé neautentizační preference a diagnostiku.

V režimu BFF (`VITE_COP_BFF_SESSION_ENABLED=true`) frontend tokeny vůbec neukládá. Při startu vyžádá anonymní informaci o relaci z `/api/v1/auth/session`; cookie je `HttpOnly` a přístupový/obnovovací token zůstává na serveru. Při prvním spuštění BFF frontend odstraní případný historický záznam s tokeny z `localStorage` a `sessionStorage`.
Live stream ukládání slučuje nejvýše na jednu verzi za 10 sekund. Detailní
metadata webkamer se načítají v dávce nejvýše po šesti souběžných požadavcích a
stabilní klíč katalogu brání tomu, aby běžná výměna GeoJSON pole rozpracovanou
dávku stále rušila. XR polling se nepřekrývá a na skryté stránce se pozastaví.

Chat slučuje scroll a swipe změny přes `requestAnimationFrame`, memoizuje
odhadované výšky dlouhé timeline a respektuje `prefers-reduced-motion` i pro
skriptované posuny. Mobilní akční povrchy nepoužívají animovaný blur a barevné
akce s bílým textem používají kontrastní tmavší odstín značky.

## Místní výstrahy a cíle navigace

Místní výstrahy mají oddělený `useLocalSafetyFeed`; jeho dotazy nejsou
vázány na vykreslované vrstvy. Podrobnosti aktuálnosti a rušení požadavků
jsou v [Alert Center](../ux/06_ALERT_CENTER.md). Rozhraní klientské funkce
`fetchMapFeatures` přijímá volitelný `AbortSignal`, který se neposílá jako
pole REST požadavku. Serverový kontrakt tím není změněn.

`feature-navigation.ts` povoluje obecnou navigaci z detailu pouze pro
platný bod podporované cílové vrstvy (`trail_poi`, `flight_airports`,
`place_settlements`) bez označení rizika. Vrchol polygonu ani konec čáry
nejsou implicitní vstup do cíle. Výstražný či komunitní rizikový bod se
touto cestou cílem navigace nestane. Toto omezení není ověřením bezpečnosti
trasy ani navigací k evakuaci; samostatné již definované trasy a explicitní
výběr bodu mají vlastní workflow.

CI po sestavení spouští `check:bundles` a `check:static-runtime`. Rozpočty
jsou regresní hranice velikosti gzip assetů, nikoli měření reálné rychlosti
na telefonu nebo důkaz kapacity pro celou ČR.
