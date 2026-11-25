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

V pilotu je aktuální stav vždy držen v paměti API procesu pro rychlé čtení a temporal historie má in-memory fallback s limitem bodů na stopu. API navíc podporuje volitelný PostgreSQL store přes `COP_TRACK_HISTORY_STORE=postgres` a `COP_DATABASE_URL`. Doporučený provozní endpoint je HAProxy před Patroni clusterem, například `haproxy.home.cz`; aplikace se nepřipojuje přímo na Patroni nody ani na etcd.

PostgreSQL store ukládá body historie do tabulky `cop_track_history` a používá `event_id` jako idempotentní klíč. Poslední známý stav každého objektu ukládá do `cop_current_tracks`; při startu API se z této tabulky obnoví `objects` a lifecycle logika následně vyhodnotí active/stale/expired stav podle času.

Query vrstva historie podporuje časové okno v sekundách, absolutní `from`/`to`, omezení `limit` a filtr `objectIds`. Další produkční krok je doplnit retenci a stránkování nad velkými výsledky.


### Archiv leteckých událostí v PostgreSQL

Kandidát pro optimalizaci RAM (stav k 25. 11. 2026). COP ukládá nově přijatou
veřejnou nesyntetickou kanonickou událost z ověřeného interního FlightData
adaptéru do `cop_public_flight_event_archive`. Ve stejné transakci ukládá
aktuální objekt, bod historie a souhrn počtů a latencí
(`cop_public_flight_event_totals`). Opakovaný zápis téže úplné události je
idempotentní; rozdílný obsah pod stejným ID je konflikt. Externě zaslané
události a data jiné klasifikace nepodléhají této optimalizaci.

V RAM zůstává zpravidla nejvýše 16 384 událostí; pokud je aktuálních objektů
nebo nearchivovatelných událostí více, jejich důkazy zůstanou zachovány.
Starší potvrzené letecké události se uvolňují z mapy `events`. Polohové body
v RAM jsou zatím ponechány pro existující výpočet konfliktů, s původním
limitem 5 000 na objekt. Historie v PostgreSQL používá důkazy načtené v
dávkách po 128 ID, včetně plné původní klasifikace a ověření shody bodu.
Žádná historická data se automaticky nemažou.

Při restartu se načtou pouze důkazy aktuálních objektů, starší důkazy
se načítají na vyžádání. Staré body vzniklé před zavedením archivu, ke
kterým neexistuje původní kanonická událost, zůstávají v úložišti, ale
nejsou pokládány za ověřený veřejný obsah. Jejich viditelnost vyžaduje
doložený původ; automatické přeznačení starých dat není povoleno.
