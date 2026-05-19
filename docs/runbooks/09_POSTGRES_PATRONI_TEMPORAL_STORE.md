# 09 PostgreSQL Patroni COP Store

Tento runbook zapíná perzistentní PostgreSQL store pro COP přes existující PostgreSQL HA endpoint `haproxy.home.cz`. Aplikace se připojuje pouze přes HAProxy. Nepřipojuje se přímo na `patroni1.home.cz`, `patroni2.home.cz`, `patroni3.home.cz` ani na `etcd.home.cz`.

## Cíl

Serverová historie stop a aktuální snapshot objektů nemají zůstat jen v paměti kontejneru. PostgreSQL ukládá body historie do tabulky `cop_track_history` a poslední známý stav objektů do `cop_current_tracks`. Díky tomu historie přežije restart API kontejneru a mapa se po startu obnoví z posledního uloženého snapshotu.

## Příprava databáze

Spusť jako databázový administrátor proti write endpointu HAProxy. V aktuální domácí síti je z `docker.home.cz` dosažitelný `haproxy.home.cz:5000`; porty `5432`, `5001` a `6432` při ověření timeoutovaly.

```bash
psql "postgresql://postgres@haproxy.home.cz:5000/postgres"
```

```sql
CREATE ROLE cop_app LOGIN PASSWORD '<nahodne-dlouhe-tajne-heslo>';
CREATE DATABASE cop OWNER cop_app;
GRANT CONNECT ON DATABASE cop TO cop_app;
```

Aplikace si při startu vytvoří tabulky a indexy sama. Pokud nechceš dát aplikačnímu uživateli `CREATE` právo ve schématu, vytvoř tabulky předem administrátorem podle SQL v `apps/cop-api/src/track-history-store.ts` a aplikačnímu uživateli uděl `SELECT`, `INSERT`, `UPDATE` na `cop_track_history` a `cop_current_tracks`.

## Nastavení `/srv/cop/.env`

Na `docker.home.cz` uprav `/srv/cop/.env`:

```bash
COP_TRACK_HISTORY_STORE=postgres
COP_DATABASE_URL=postgresql://cop_app:<nahodne-dlouhe-tajne-heslo>@haproxy.home.cz:5000/cop
COP_DATABASE_SSL=false
COP_DATABASE_POOL_MAX=5
COP_DATABASE_CONNECT_TIMEOUT_MS=5000
COP_DATABASE_IDLE_TIMEOUT_MS=30000
```

Pokud je mezi `docker.home.cz` a PostgreSQL vyžadované TLS, nastav:

```bash
COP_DATABASE_SSL=true
COP_DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

`COP_DATABASE_SSL_REJECT_UNAUTHORIZED=false` používej jen pro interní certifikát bez důvěryhodného CA řetězce. Pro produkční certifikát ponech `true`.

## Restart aplikace

```bash
cd /srv/cop
docker compose up -d --build
docker compose ps
```

## Ověření

```bash
curl -fsS http://docker.home.cz:4310/health/dependencies \
  -H "Authorization: Bearer $COP_LAB_TOKEN"

curl -fsS http://docker.home.cz:4310/metrics | grep -E 'cop_track_history_points_total|cop_current_tracks_persisted_total'
```

V `health/dependencies` má být `track-history-store` ve stavu `ok` a detail ve tvaru `postgres: ready; restored N current tracks`.

Po příchodu SIM eventů ověř v databázi:

```sql
SELECT object_id, count(*) AS points, max(observed_at) AS last_point
FROM cop_track_history
GROUP BY object_id
ORDER BY last_point DESC;

SELECT object_id, last_updated_at, status
FROM cop_current_tracks
ORDER BY last_updated_at DESC
LIMIT 20;
```

## Provozní poznámky

- HAProxy musí směrovat zápisy na aktuální primary Patroni nod.
- COP nepracuje s etcd přímo; etcd zůstává interní součást Patroni clusteru.
- API pořád drží aktuální stav v paměti kvůli rychlému čtení, ale při každém ingestu ukládá poslední snapshot do PostgreSQL.
- Při startu API se `objects` obnoví z `cop_current_tracks`; lifecycle logika pak podle stáří označí objekty jako active, stale nebo expired.
- Další krok je doplnit retenci historie, stránkování dlouhých tras a skutečný realtime stream.
