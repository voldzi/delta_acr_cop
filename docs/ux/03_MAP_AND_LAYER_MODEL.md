# 03 Map and Layer Model

Mapový model je složený z vrstev, filtrů, policy a rendereru.

## Vrstvy MVP

- air situation,
- UAV,
- friendly,
- rescue,
- reports,
- data quality,
- source status,
- SIM data overlay.

Každá vrstva musí být filtrovatelná podle oblasti, object type, confidence, SIM/synthetic flagu a oprávnění uživatele.

## Uživatelský stav

Zobrazení mapy, zoom, vybraná vrstva, filtry, refresh cadence a volby historie/predikce jsou uživatelské preference. V pilotu jsou uložené lokálně v prohlížeči daného uživatele, ne ve sdíleném COP state.

Poloha uživatele je klientský stav. Neposílá se do COP API a používá se pouze pro centrování mapy a lokální výpočet výstrah.

## Historie a predikce

Historie trasy se drží v klientovi po jednotlivých objektech. Výchozí hloubka je 36 bodů na objekt; operátor ji může v pilotu přepnout na 12, 24, 36, 72 nebo 120 bodů. Duplicitní souřadnice se do historie nepřidávají.

Predikce je analytická vizualizace pro orientaci operátora, nikoli navádění. Pilot podporuje režimy:

- adaptivní: použije telemetrii speed/heading, pokud je dostupná, jinak trend z historie,
- telemetrie: promítá aktuální speed/heading v přímém směru,
- trend: promítá vektor z posledních historických poloh,
- manévr: odhaduje poslední rychlost a rychlost zatáčení z historie a kreslí zakřivenou trajektorii.

## Výstrahy přiblížení

Klient může po souhlasu uživatele zaměřit vlastní polohu a počítat lokální výstrahy pro cizí cíle. Výstraha se aktivuje, pokud je cizí cíl v nastaveném poloměru nebo predikce pohybu ukazuje vstup do tohoto poloměru.
