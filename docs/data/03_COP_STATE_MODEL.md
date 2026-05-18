# 03 COP State Model

COP state je aktuální agregovaný stav odvozený z událostí, nikoli ručně editovaná mapa.

## Vlastnosti objektu

- stabilní `objectId`,
- `objectType`, `domain`, `affiliation`, `status`,
- aktuální poloha a pohyb,
- `confidence`,
- `synthetic`,
- `lastUpdatedAt`,
- symbol resolution metadata,
- provenance odkazy,
- policy tags.

## Temporal model

Každý stav rozlišuje čas produkce, čas ingestu a čas poslední aktualizace COP state. Stale a lost stavy musí být explicitní.
