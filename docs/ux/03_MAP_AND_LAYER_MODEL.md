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
- synthetic data overlay.

Každá vrstva musí být filtrovatelná podle oblasti, object type, confidence, synthetic flagu a oprávnění uživatele.
