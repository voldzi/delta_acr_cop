# 03 Map and Layer Model

Mapový model je složený z vrstev, filtrů, policy a rendereru.

Autoritativní integrační model vrstev je definovaný v [Map Catalog v1](../integration/08_MAP_CATALOG_V1.md). Frontend nemá dlouhodobě držet pevný seznam všech vrstev v kódu; má renderovat strom, filtry, legendu a chování podle katalogu.

## Mapový podklad

Mapový podklad je samostatná vrstva pod situačními daty, bezpečnostními vrstvami, uživatelskými zónami a COP tracky. Produkční konfigurace má používat first-party endpoint `tiles.zeleznalady.cz`, aby opakované zobrazení mapy obsloužila cache a aby se externí tile zdroje volaly jen v nezbytné míře.

Klient podporuje dva režimy:

- MapLibre style URL pro vlastní vector/raster tile server,
- raster tile template jako fallback.

PWA cache zlepšuje opakované zobrazení na zařízení uživatele, ale nenahrazuje serverovou tile cache ani vlastní tile server.

Navigační režim navíc umí předem zahřát dlaždice v koridoru aktuální trasy do
samostatné route tile cache service workeru. Tato cache se používá před
běžnou mapovou tile cache, aby aktivní trasa zůstala dostupná i při krátkém
výpadku signálu. Cache obsahuje pouze mapové dlaždice a lokální route package;
COP v PWA bez online SIM/backend spojení nepočítá novou trasu.

## Vrstvy MVP

- air situation,
- UAV,
- friendly,
- rescue,
- reports,
- data quality,
- source status,
- SIM data overlay,
- situační kontext ze SIM (`weather`, `ground`, `mobile`, `traffic`).

Každá vrstva musí být filtrovatelná podle oblasti, object type, confidence, SIM/synthetic flagu a oprávnění uživatele.

## Uživatelský stav

Zobrazení mapy, zoom, vybraná vrstva, filtry, refresh cadence a volby historie/predikce jsou uživatelské preference. V pilotu jsou uložené lokálně v prohlížeči daného uživatele, ne ve sdíleném COP state.

Poloha uživatele je klientský stav. Neposílá se do COP API a používá se pouze pro centrování mapy a lokální výpočet výstrah.

Pokud uživatel polohu nepovolí, prohlížeč geolokaci neposkytuje nebo uložený mapový střed obsahuje neplatné souřadnice, web po startu a při neúspěšném zaměření centrová mapu na střed České republiky. Souřadnice `0,0` se nepovažují za platný uložený střed mapy.

## Situační kontext

Situační kontext ze SIM se vykresluje jako samostatná mapová vrstva nad podkladem a pod COP tracky. Výchozí je `weather`; `ground`, `mobile` a `traffic` jsou volitelné. Výběr vrstev je uživatelská preference a neovlivňuje počet tracků, historii tras ani predikci.

Po kliknutí na situační feature se v pravém panelu zobrazí detail: label, category, source, observedAt, confidence, stale/severity, licence, metriky a tagy. Tato data slouží k orientaci a provenance, ne k targeting ani akčnímu workflow.

## Historie a predikce

Historie trasy se drží v klientovi po jednotlivých objektech. Výchozí časové okno je 180 sekund; operátor jej může v pilotu přepnout na 30, 60, 120, 180, 300 nebo 600 sekund. Zároveň platí bodový strop na objekt kvůli výkonu mapy při rychlém refreshi. Duplicitní souřadnice se do historie nepřidávají, ale staré body se i u stojícího objektu odstraňují podle časového okna.

Predikce je analytická vizualizace pro orientaci operátora, nikoli navádění. Pilot podporuje režimy:

- adaptivní: použije telemetrii speed/heading, pokud je dostupná, jinak trend z historie,
- telemetrie: promítá aktuální speed/heading v přímém směru,
- trend: promítá vektor z posledních historických poloh,
- manévr: odhaduje poslední rychlost a rychlost zatáčení z historie a kreslí zakřivenou trajektorii.

## Výstrahy přiblížení

Klient může po souhlasu uživatele zaměřit vlastní polohu a počítat lokální výstrahy pro cizí cíle. Výstraha se aktivuje, pokud je cizí cíl v nastaveném poloměru nebo predikce pohybu ukazuje vstup do tohoto poloměru.
