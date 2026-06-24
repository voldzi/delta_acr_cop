# 04 Running Main COP

Runbook pro spuštění hlavního COP systému popisuje lokální běh a pilotní instalaci na `docker.home.cz` ve složce `/srv/cop`.

## Lokální spuštění bez Dockeru

```bash
pnpm install
pnpm check
pnpm dev
```

Výchozí lokální porty:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`
- Chat: `http://localhost:4314/chat/`

## Lokální spuštění přes Docker Compose

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
```

Ověření:

- `/health/live` vrací stav procesu,
- `/health/ready` potvrzuje připravenost API,
- `/health/dependencies` ukazuje stav DB/cache/bus/AI,
- `/metrics` publikuje základní metriky,
- Source Registry umožňuje registraci laboratorního SIM zdroje,
- ingest endpoint přijme validní syntetický event.

## Volba portů na docker.home.cz

Na serveru běží více Docker aplikací, proto nejdříve ověř obsazené porty:

```bash
ss -tulpn | grep LISTEN
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Výchozí návrh pro COP pilot:

- `COP_API_PORT=4310`
- `COP_WEB_PORT=4311`
- `COP_CHAT_PORT=4314`
- `COP_PUBLIC_API_BASE_URL=http://docker.home.cz:4310`

Pokud jsou porty obsazené, zvol jiné a nastav je v `/srv/cop/.env`.

## První příprava `/srv/cop`

Pokud složka ještě neexistuje nebo nemá správná práva, uživatel s oprávněním spustí:

```bash
sudo mkdir -p /srv/cop
sudo chown -R voldzi:voldzi /srv/cop
```

Pak jako `voldzi`:

```bash
cd /srv/cop
git clone https://github.com/voldzi/delta_acr_cop.git .
cp .env.example .env
```

Uprav `.env` podle zvolených portů, například:

```bash
COP_API_PORT=4310
COP_WEB_PORT=4311
COP_CHAT_PORT=4314
COP_PUBLIC_API_BASE_URL=http://docker.home.cz:4310
COP_ALLOW_LAB_TOKEN=true
COP_LAB_TOKEN=dev-lab-token
```

Nasazení:

```bash
docker compose build
docker compose up -d
docker compose ps
```

## Aktualizace z GitHubu

```bash
cd /srv/cop
git pull
docker compose build
docker compose up -d
docker compose ps
```

## Testovací ingest

```bash
curl -sS -X POST "http://docker.home.cz:${COP_API_PORT:-4310}/api/v1/ingest/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${COP_LAB_TOKEN:-dev-lab-token}" \
  -H "X-Source-System-Id: sim-air-situation-001" \
  -H "X-Contract-Version: cop-ingest-v1" \
  -H "X-Correlation-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  --data @tests/contract/fixtures/sim-event.json
```
