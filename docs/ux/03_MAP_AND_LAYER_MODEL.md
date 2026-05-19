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

## Výstrahy přiblížení

Klient může po souhlasu uživatele zaměřit vlastní polohu a počítat lokální výstrahy pro cizí cíle. Výstraha se aktivuje, pokud je cizí cíl v nastaveném poloměru nebo predikce pohybu ukazuje vstup do tohoto poloměru.
