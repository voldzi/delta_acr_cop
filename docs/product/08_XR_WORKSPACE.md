# CSM XR workspace

Stav: Phase 1 initial implementation, Phase 2 foundations, globální mapové hledání hotovo.

CSM XR je samostatný klientský režim nad stejným COP API. Neprovádí žádné rozhodování o zásahu, targeting ani navádění. Slouží pouze k prostorové vizualizaci civilní situační mapy, výstrah a sdílených informací.

## Přístup

- Web route: `/xr`
- Běžná aplikace zůstává na `/`
- Běžná mapa nenačítá Three.js/WebXR, protože XR workspace je lazy-loaded
- Primární cílové zařízení: Meta Quest Browser s podporou WebXR `immersive-vr`
- Desktop fallback: 3D WebGL náhled pro vývoj a kontrolu

## Phase 1

Implementováno:

- Three.js prostorová scéna
- WebXR session start přes uživatelské tlačítko
- 3D operační mapová deska
- COP tracky jako prostorové markery
- veřejné lety jako samostatná barva/symbolika
- simulované tracky jako samostatná vrstva
- desktop výběr objektu kliknutím
- Quest controller ray picking přes `select`
- plovoucí detail vybraného objektu v bočním panelu
- pravidelný refresh dat

## Phase 2 foundations

Implementováno jako základ:

- přepínače vrstev: veřejné lety, simulace, ostatní tracky
- prostorová historie jako 3D linie
- prostorová predikce z posledního směru a rychlosti
- vyhledávání v XR objektech
- základní metriky živého obrazu

Zbývá:

- prostorové karty výsledků hledání pro tracky, situační prvky, bezpečnostní vrstvy a community reporty
- zobrazování AOI/výstražných zón přímo v XR scéně
- detailní práce s katalogem mapových vrstev v XR scéně
- hand tracking UX nad rámec controller select
- optimalizace počtu markerů a labelů pro Quest výkon

## Další kroky

1. Rozšířit XR o situační a safety feature vrstvy přes stejný vyhledávací model.
2. Profilovat Safari a lazy-loadnout další těžké části UI.
3. Optimalizovat marker/label render pro Quest výkon.
4. Doplnit prostorové AOI/výstražné zóny.

## Globální mapové hledání

Běžná mapa má samostatné vyhledávací pole přímo v mapovém režimu. Vyhledávání nemění aktivní filtr dat, pouze najde prvek v aktuálních mapových vrstvách a po výběru:

- vybere track nebo situační prvek,
- zavře výsledky hledání,
- vycentruje mapu na souřadnici prvku,
- zachová aktuální bearing/pitch mapy.

Výsledky jsou typované jako karty:

- let,
- BTS,
- letiště,
- prostor,
- výstraha,
- uživatelské hlášení,
- obecná situační vrstva.

Čistá logika je v `apps/cop-web/src/map-search.ts`, aby ji šlo znovu použít pro XR a budoucí nativní aplikace.

## QA průchod

Ověřeno lokálně proti produkčnímu API přes Vite proxy:

- `/` desktop: mapa se načte, globální hledání je dostupné,
- iPhone viewport `390x844`: katalog vrstev, mapová lišta a hledání se nepřekrývají,
- iPad viewport `820x1180`: katalog vrstev, mapová lišta a hledání se nepřekrývají,
- `/xr`: 3D canvas se vykreslí, route je lazy-loaded a WebXR tlačítko má desktop fallback.
