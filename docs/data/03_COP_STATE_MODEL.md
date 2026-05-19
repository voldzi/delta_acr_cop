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

Implementační pilot rozlišuje dvě datové vrstvy:

- `objects`: aktuální policy-filtered COP state pro mapu a seznam stop,
- `trackHistory`: časově řazené body stop pro historii trasy a budoucí replay.

`trackHistory` není zdroj pravdy pro aktuální objekt. Je to odvozený temporal index z přijatých eventů. Každý bod uchovává `objectId`, typ, afiliaci, status, souřadnice, čas bodu, čas produkce, čas ingestu, zdroj, `eventId`, `synthetic` a `confidence`.

## Retence pilotu

V pilotu je temporal historie držena v paměti API procesu s limitem bodů na stopu. Query vrstva podporuje časové okno v sekundách, absolutní `from`/`to`, omezení `limit` a filtr `objectIds`. Produkční varianta musí tuto vrstvu přesunout do perzistentního temporal store s definovanou retencí, stránkováním a obnovou po restartu.
