# 04 Frontend Architecture

Webový klient je operační konzument COP state. Jeho účelem je rychlá orientace, filtrování vrstev, detail objektu, timeline/replay, stav zdrojů a vysvětlení confidence/provenance.

Pilot má dvě React/Vite webové plochy:

- `apps/cop-web` je hlavní mapový PWA shell.
- `apps/cop-chat` je samostatná chatovací aplikace buildnutá s base path
  `/chat/`. Sdílí existující COP auth helpery, metadata API klienta a
  Matrix/E2EE klienta z `cop-web`, ale UI drží mimo mapový shell.

## Doporučený stack

- Next.js + React,
- MapLibre GL nebo ekvivalent,
- WebSocket/SSE klient pro delta updates,
- lokální state management pro UI filtry a subscription,
- komponenta AI assistant drawer napojená pouze na povolené AI endpointy.

## Zásady

UI musí jasně odlišit syntetická data, stale objekty, konflikty zdrojů a degraded režim. UI nesmí obsahovat targeting, navádění ani workflow použití síly.

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
- veřejný build nesmí obsahovat serverové tokeny ani interní provider URL.
