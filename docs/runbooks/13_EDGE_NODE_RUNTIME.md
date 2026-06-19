# 13 Edge Node Runtime

COP obsahuje pilotní `cop-edge-node` runtime pro degraded/offline režim. Edge
uzel není náhradou centrálního COP API. Je to lokální synchronizační a cache
proces, který:

- registruje se jako `edge-node` přes centrální COP API,
- udržuje lokální file-backed outbox,
- flushuje offline domain eventy přes `POST /api/v1/edge/outbox/flush`,
- stahuje policy-filtered centrální eventy přes
  `GET /api/v1/edge/replay/{nodeId}`,
- po durable zpracování potvrzuje replay cursor přes
  `POST /api/v1/edge/replay-cursors/{nodeId}/ack`,
- drží poslední lokální stav v `COP_EDGE_DATA_DIR`.

## Docker Compose

Produkční compose obsahuje službu `cop-edge`:

```env
COP_EDGE_PORT=4312
COP_EDGE_NODE_ID=node_edge_pilot_01
COP_EDGE_NODE_NAME="CSM Edge Pilot Node"
COP_EDGE_CLASSIFICATION_MAX=INTERNAL
COP_EDGE_CENTRAL_API_URL=http://cop-api:4310
COP_EDGE_CENTRAL_TOKEN=<same-value-as-COP_LAB_TOKEN-or-service-token>
COP_EDGE_ADMIN_TOKEN=<random-long-secret-for-edge-admin-posts>
COP_EDGE_AUTO_SYNC=true
COP_EDGE_SYNC_INTERVAL_MS=10000
```

`COP_EDGE_CENTRAL_TOKEN` je server-side token pro komunikaci edge runtime s COP
API. Nepatří do web buildu ani do browseru. `COP_EDGE_ADMIN_TOKEN` chrání
lokální měnící endpointy edge runtime (`POST /edge/sync`, `POST /edge/outbox`).
Pokud není nastavený, tyto endpointy fail-closed vrací `401`.

## Lokální Endpointy

Edge server přijímá endpointy s prefixem i bez prefixu `/edge`, aby šel bezpečně
publikovat pod `https://cop.zeleznalady.cz/edge/`.

| Endpoint | Účel |
| --- | --- |
| `GET /edge/` | jednoduchá HTML status stránka |
| `GET /edge/status` | JSON status, poslední eventy a outbox summary |
| `GET /edge/events?limit=100` | JSON status s větším počtem posledních eventů |
| `GET /edge/health/live` | liveness |
| `GET /edge/health/ready` | readiness/degraded stav |
| `POST /edge/sync` | ruční synchronizace, vyžaduje `COP_EDGE_ADMIN_TOKEN` |
| `POST /edge/outbox` | vložení lokální domain události do outboxu, vyžaduje `COP_EDGE_ADMIN_TOKEN` |

Veřejně publikovat lze pouze read-only status endpointy. Měnící endpointy musí
zůstat chráněné bearer tokenem nebo dostupné jen lokálně.

## DMZ Publikace Pod cop.zeleznalady.cz

Na `dmz.home.cz` lze edge runtime publikovat pod stejnou doménou jako COP:

```nginx
location /edge/ {
    proxy_pass http://docker.home.cz:4312/edge/;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_buffering off;
}
```

Poté ověřit:

```sh
curl -fsS https://cop.zeleznalady.cz/edge/health/live
curl -fsS https://cop.zeleznalady.cz/edge/status
```

## SIM A Provider Data

SIM zůstává samostatný server-to-server provider. Edge runtime nevolá SIM
přímo. Data ze SIM vstupují do centrálního COP API a do edge se dostávají jen
přes COP domain event/replay kontrakt nebo přes budoucí centrálně připravené
snapshoty. Tím se drží bezpečnostní hranice: SIM nezná uživatele, zařízení,
skupiny ani lokální edge outbox.

## Provozní Poznámky

- Edge stav je file-backed a atomicky zapisovaný do `state.json`.
- Inbound replay cache je omezena na posledních 2000 eventů.
- Lokální dead-letter pro rejected outbox položky je omezen na posledních 1000
  položek.
- Edge runtime je PoC lokální synchronizační proces. Pro produkční
  air-gapped režim bude potřeba doplnit šifrování lokálního úložiště,
  per-device identity, retention a konfliktní UI v klientovi.
