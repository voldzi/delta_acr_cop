# 09 PostgreSQL Patroni Temporal Store

Tento runbook zapíná perzistentní temporal history store pro COP přes existující PostgreSQL HA endpoint `haproxy.home.cz`. Aplikace se připojuje pouze přes HAProxy. Nepřipojuje se přímo na `patroni1.home.cz`, `patroni2.home.cz`, `patroni3.home.cz` ani na `etcd.home.cz`.

## Cíl

Serverová historie stop nemá zůstat jen v paměti kontejneru. PostgreSQL ukládá body historie do tabulky `cop_track_history`, aby historie přežila restart API kontejneru a aby budoucí replay mohl pracovat nad stabilní časovou osou.

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

Aplikace si při startu vytvoří tabulku a indexy sama. Pokud nechceš dát aplikačnímu uživateli `CREATE` právo ve schématu, vytvoř tabulku předem administrátorem podle SQL v `apps/cop-api/src/track-history-store.ts` a aplikačnímu uživateli uděl jen `SELECT`, `INSERT` na `cop_track_history`.

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

curl -fsS http://docker.home.cz:4310/metrics | grep cop_track_history_points_total
```

V `health/dependencies` má být `track-history-store` ve stavu `ok` a detail `postgres: ready`.

Po příchodu SIM eventů ověř v databázi:

```sql
SELECT object_id, count(*) AS points, max(observed_at) AS last_point
FROM cop_track_history
GROUP BY object_id
ORDER BY last_point DESC;
```

## Provozní poznámky

- HAProxy musí směrovat zápisy na aktuální primary Patroni nod.
- COP nepracuje s etcd přímo; etcd zůstává interní součást Patroni clusteru.
- Aktuální objektový stav v pilotu stále drží API v paměti. PostgreSQL v tomto kroku persistuje temporal history stop.
- Další krok je doplnit perzistentní aktuální snapshot nebo replay rekonstrukci aktuálního stavu po restartu.
