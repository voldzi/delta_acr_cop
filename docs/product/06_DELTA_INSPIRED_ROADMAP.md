# 06 DELTA Inspired Roadmap

Tento plán převádí DELTA-inspired analýzu do bezpečného rozvoje COP aplikace. Inspirace je omezena na obecné veřejně popsané principy: web-first situační obraz, vrstvy, realtime data, degraded provoz, auditovatelnost, timeline/replay a práci se zdroji. Plán nesmí zavádět targeting, navádění, weapon workflow ani doporučení použití síly.

## Stav k 2026-05-19

| Oblast | Stav | Poznámka |
| --- | --- | --- |
| Profesionální mapové COP UI | Dokončeno v pilotu | Mapová plocha, vrstvy, detail objektu, refresh, historie/predikce, per-user nastavení, PWA metadata a veřejné publikování. |
| SIM integrace | Dokončeno v pilotu | COP přijímá a zobrazuje cíle ze SIM projektu přes ingest kontrakt. |
| NATO symbologie | Dokončeno v pilotu | Vlastní prvky jsou modré, cizí prvky červené, symboly jsou řešené přes renderer a UI metadata. |
| Lifecycle objektů | Dokončeno v pilotu | Aktivní/stale/lost stav chrání mapu před trvalým zobrazováním zastavených simulovaných dat. |
| Proximity awareness | Dokončeno v pilotu | Uživatel může zobrazit vlastní polohu a průsvitnou varovnou vrstvu přiblížení cizích objektů. |
| Server-side temporal history | Rozpracováno | API drží body stop, web je používá jako zdroj pro historii tras a PostgreSQL store přes HAProxy/Patroni persistuje historii i current snapshot. |
| Timeline/replay | Částečně | UI má časové okno historie v sekundách; plný replay nad serverovou časovou osou je další krok. |
| Stream/delta distribuce | Částečně | Existuje snapshot endpoint; skutečný SSE/WebSocket delta stream je další krok. |
| Perzistence a multi-user provoz | Částečně | UI nastavení jsou lokální pro uživatele/prohlížeč; current tracks a historie mají PostgreSQL backend. |

## Prioritizované kroky

### P1: Stabilní živý situační obraz

Status: pilotně hotovo.

- mapová pracovní plocha s OpenStreetMap podkladem,
- čitelné NATO symboly podle afiliace,
- přepínače vrstev a syntetických dat,
- volitelná frekvence refresh,
- lifecycle stop: active, stale, lost,
- veřejná publikace přes `cop.zeleznalady.cz`.

### P2: Časová data, historie a replay

Status: probíhá.

- server drží časovou historii objektů jako samostatný temporal model,
- web načítá historii přes `/api/v1/cop/track-history`,
- UI časové okno historie může být v sekundách,
- temporal history lze persistovat do PostgreSQL přes `haproxy.home.cz`,
- current snapshot se persistuje do PostgreSQL a obnovuje při startu API,
- další krok je replay controller nad serverovou časovou osou,
- další krok je retence a stránkování dlouhých tras.

### P3: Realtime distribuce

Status: další implementační krok po temporal store v1.

- nahradit polling skutečným SSE nebo WebSocket streamem,
- posílat snapshot, delta, heartbeat a reconnect signalizaci,
- zachovat policy filtering na serveru,
- nechat refresh interval jako fallback/degraded režim.

### P4: Operační nastavení a uživatelský profil

Status: částečně hotovo.

- soustředit narůstající nastavení do kompaktního centra nastavení,
- oddělit lokální mapové nastavení od budoucího serverového profilu,
- přidat Keycloak login bez zásahu do existujících realmů,
- uložit sdílené preference až po zavedení identity a jasné politiky.

### P5: Zdrojová důvěryhodnost a provozní dohled

Status: plán.

- stav zdrojů, latence, poslední event a degradace,
- vysvětlení confidence a provenance v detailu objektu,
- konflikty zdrojů a jejich auditovatelné vysvětlení,
- metriky pro retenční velikost temporal store a stream latency.

## Evidence realizace

| Datum | Krok | Výsledek |
| --- | --- | --- |
| 2026-05-19 | Temporal history API v1 | Přidán in-memory temporal store a endpoint `/api/v1/cop/track-history`; web jej používá pro zobrazení historie tras. |
| 2026-05-19 | PostgreSQL temporal store v1 | Přidán volitelný PostgreSQL backend pro historii stop přes `COP_TRACK_HISTORY_STORE=postgres` a `COP_DATABASE_URL`; runbook popisuje napojení na HAProxy/Patroni. |
| 2026-05-19 | PostgreSQL current snapshot v1 | Přidán `cop_current_tracks`, UPSERT při ingestu a obnova aktuálních objektů při startu API. |
