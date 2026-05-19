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

## Retence a persistence pilotu

V pilotu je temporal historie vždy držena i v paměti API procesu s limitem bodů na stopu. API navíc podporuje volitelný PostgreSQL temporal store přes `COP_TRACK_HISTORY_STORE=postgres` a `COP_DATABASE_URL`. Doporučený provozní endpoint je HAProxy před Patroni clusterem, například `haproxy.home.cz`; aplikace se nepřipojuje přímo na Patroni nody ani na etcd.

Query vrstva podporuje časové okno v sekundách, absolutní `from`/`to`, omezení `limit` a filtr `objectIds`. PostgreSQL store ukládá body do tabulky `cop_track_history` a používá `event_id` jako idempotentní klíč. Další produkční krok je doplnit retenci, stránkování nad velkými výsledky a obnovu aktuálního snapshotu po restartu.
