# 04 Frontend Architecture

Webový klient je operační konzument COP state. Jeho účelem je rychlá orientace, filtrování vrstev, detail objektu, timeline/replay, stav zdrojů a vysvětlení confidence/provenance.

Pilot má dvě React/Vite webové plochy:

- `apps/cop-web` je hlavní mapový PWA shell.
- `apps/cop-chat` je samostatná chatovací aplikace buildnutá s base path
  `/chat/`. Sdílí existující COP auth helpery, metadata API klienta a
  Matrix/E2EE klienta z `cop-web`, ale UI drží mimo mapový shell.

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
- text stavu se nesmí zobrazit jako bezvýznamná useknutá zkratka; na nejmenším
  telefonu se zachová stručný stavový badge a podrobný text je dostupný v
  detailu.

Statické kontrakty pro tuto hranici jsou v
`apps/cop-web/src/mobile-layout.styles.test.ts` a
`apps/cop-chat/src/ChatApp.styles.test.ts`. Změny mobilního shellu se ověřují
také vizuálně na 320 × 568 a na aktuálním iPhone Max viewportu.

## Mapový podklad

Frontend používá MapLibre. Mapový styl je konfigurovatelný:

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
- renderer NATO/APP-6 symbolů používaný až při registraci mapových ikon,
- MapLibre runtime v samostatném bundlu řízeném Vite manual chunkem.

Při dalších úpravách platí:

- nové velké panely přidávat přes `React.lazy` nebo samostatný route/workspace
  chunk,
- MapLibre, Matrix SDK, Three.js, NATO symbol renderer a tabulkové/grid
  knihovny nenačítat do hlavního mapového shellu, pokud nejsou potřeba ihned,
- po větších změnách kontrolovat výpis `pnpm --filter @cop/cop-web build` a
  sledovat hlavně první `index-*.js` bundle,
- před release spouštět `pnpm check:release`, které sestaví všechny aplikace a
  zkontroluje rozpočty pro web shell, mapové runtime chunky, chat shell, Matrix
  runtime, PDF viewer/worker a Office/archive parser,
- `pnpm check:static-runtime` ověřuje, že web i chat runtime po buildu vrací
  správné hlavičky pro kompresi, immutable cache a `404` pro chybějící assety,
- `pnpm format:check` pokrývá aktivně spravovaný rozsah `apps/cop-web`,
  `apps/cop-chat`, `packages/messaging` a release skripty; celorepo formátování
  se nezapíná skokově, aby nezaneslo velký historický churn mimo aktuální
  vlastnictví,
- veřejný build nesmí obsahovat serverové tokeny ani interní provider URL.

PWA shell instaluje novou verzi teprve po ověření kritického HTML, manifestů a
všech odkazovaných entry assetů. Jednotlivé volitelné ikony instalaci
nezablokují, kritické požadavky mají omezený retry a pomalé obnovení navigace
zůstává připojené k `FetchEvent.waitUntil`. Registrace opakuje kontrolu po
krátkém výpadku i po návratu online. Po převzetí kontroly se dokument obnoví
jednou, ale až když v textovém poli nebo file pickeru nezůstává rozepsaný obsah.

Velké situační offline snapshoty patří primárně do IndexedDB; synchronní
`localStorage` je pouze fallback a starý záznam se po úspěšné migraci odstraní.
Live stream ukládání slučuje nejvýše na jednu verzi za 10 sekund. Detailní
metadata webkamer se načítají v dávce nejvýše po šesti souběžných požadavcích a
stabilní klíč katalogu brání tomu, aby běžná výměna GeoJSON pole rozpracovanou
dávku stále rušila. XR polling se nepřekrývá a na skryté stránce se pozastaví.

Chat slučuje scroll a swipe změny přes `requestAnimationFrame`, memoizuje
odhadované výšky dlouhé timeline a respektuje `prefers-reduced-motion` i pro
skriptované posuny. Mobilní akční povrchy nepoužívají animovaný blur a barevné
akce s bílým textem používají kontrastní tmavší odstín značky.
