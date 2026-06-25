# 14 AI-COP/NIPS Federation Contract

Tento dokument definuje pilotní federační kontrakt pro CSM/COP. Navazuje na
OpenAPI, kanonický entity model a AsyncAPI. Je určený pro web, iOS/iPadOS,
SIM, CSM Messaging a budoucí lokální uzly.

## Principy

- Federace používá explicitní uzly, ne skryté integrace v UI.
- Každý uzel publikuje a přijímá auditovatelné eventy.
- REST/OpenAPI zůstává command/query API.
- AsyncAPI popisuje eventy a replay.
- GeoJSON/OGC API Features popisují mapová data.
- MCP je pouze AI/tool vrstva, ne integrační backbone.
- Každý event a každá entita nese classification, releasePolicy, confidence,
  provenance a correlationId.

## Typy Uzelů

| nodeRole | Popis | Příklady |
| --- | --- | --- |
| `central-orchestrator` | centrální COP backend, audit, AI/MCP, notifikační rozhodování | COP API |
| `civil-crisis-node` | civilní operační pracovní plocha | COP Web workspace |
| `edge-node` | lokální/offline klient nebo lokální server | iOS/iPadOS, PWA offline |
| `provider-node` | server-to-server datový provider | SIM, TAK Gateway, Mission Arena |
| `messaging-node` | komunikace, zařízení, push | CSM Messaging |

## Node Identity

Každý uzel má stabilní identitu:

```json
{
  "nodeId": "node_central_cop",
  "nodeRole": "central-orchestrator",
  "nodeName": "CSM/COP Central",
  "contractVersion": "cop-federation-node-v1",
  "capabilities": [
    "domain-events",
    "audit-events",
    "map-features",
    "mcp-gateway"
  ],
  "classificationMax": "SENSITIVE",
  "nodeTrustDomain": "cop-central",
  "dataEndpoints": [
    "/api/v1/map/catalog",
    "/api/v1/map/query",
    "/api/v1/events/domain",
    "/api/v1/edge/replay"
  ],
  "eventSubscriptions": [
    "cop.domain.events",
    "cop.provider.health",
    "cop.node.sync"
  ],
  "mcpEndpoint": "/api/v1/mcp",
  "publicKeyRef": "oidc:cop-api",
  "releaseScopes": [
    "public",
    "internal",
    "role:central-orchestrator",
    "node:node_central_cop"
  ],
  "softwareVersion": "0.1.0",
  "lastSeenAt": "2026-06-19T12:00:00Z",
  "health": "ok"
}
```

Node registry je provozní zdroj pravdy pro federované schopnosti uzlů. `dataEndpoints`
popisují standardní REST/OpenAPI nebo GeoJSON/OGC rozhraní, `eventSubscriptions`
deklarují spotřebované event kanály, `nodeTrustDomain` odděluje důvěryhodnostní
hranice, `publicKeyRef` odkazuje na klíč/issuer a `releaseScopes` se používají
při policy-filtered edge replay. `mcpEndpoint` je pouze diagnostický/read-only
vstup pro agenty; produkční datová integrace mezi COP, SIM, edge a messaging
uzly zůstává přes REST/OpenAPI, GeoJSON/OGC a event log.

## Event Transport

Eventy se zapisují jako CloudEvents s COP payloadem. Pilotní transport je
abstraktní; konkrétní broker určí samostatné ADR. První podporované kanály jsou
v `asyncapi/asyncapi.json`.

Povinné technické vlastnosti:

- at-least-once delivery,
- idempotence podle `id`/`eventId`,
- replay podle času a typu eventu,
- dead-letter queue nebo ekvivalent,
- audit odmítnutých nebo nevalidních eventů,
- correlationId přes REST, eventy, AI a audit.

## Runtime API Stav

První implementovaná runtime vrstva je server-side v COP API. Slouží jako
broker facade, zdroj pravdy pro MCP allowlist a append-only event log pro pilotní
federaci. Pokud je dostupná
`COP_DATABASE_URL`, používá persistentní PostgreSQL runtime store
(`COP_FEDERATION_STORE=auto|postgres`) s tabulkami `cop_federation_nodes`,
`cop_domain_events`, `cop_domain_dead_letters` a `cop_edge_replay_cursors`. Bez
databáze běží in-memory fallback vhodný pouze pro vývoj.

Pilot současně obsahuje samostatný `cop-edge-node` runtime. Ten běží jako
lokální edge služba s file-backed stavem, lokálním outboxem a replay cache. Edge
runtime nevolá SIM ani externí providery přímo. Připojuje se pouze k centrálnímu
COP API, přes heartbeat se registruje jako `edge-node`, flushuje lokální outbox,
stahuje policy-filtered replay a po durable zápisu potvrzuje cursor. V
produkčním pilotu se publikuje pod COP doménou jako `/edge/`, například
`GET /edge/status` a `POST /edge/sync`. Mutující lokální edge endpointy vyžadují
samostatný `COP_EDGE_ADMIN_TOKEN`; token centrálního COP API zůstává jen
server-side v edge procesu.

MCP běží jako samostatná služba `cop-mcp-gateway`. Gateway publikuje agent-facing
endpointy `/mcp`, `/mcp/tools` a `/mcp/tools/{toolId}/invoke`, chrání je
`COP_MCP_GATEWAY_TOKEN` a server-side deleguje do centrálního COP API pomocí
`COP_MCP_CENTRAL_TOKEN`. Centrální `/api/v1/mcp*` endpointy zůstávají
kompatibilní interní facade a jediný zdroj pravdy pro allowlist, audit,
policy-filtered výsledek a domain event `ai.tool.invoked`.

Aktuální endpointy jsou chráněné bearer autentizací a nejsou veřejným klientským
API:

| Endpoint | Účel |
| --- | --- |
| `GET /api/v1/federation/nodes` | seznam registrovaných uzlů |
| `GET /api/v1/federation/nodes/{nodeId}` | detail uzlu |
| `POST /api/v1/federation/nodes/{nodeId}/heartbeat` | registrace/heartbeat uzlu |
| `POST /api/v1/events/domain` | publikace COP domain eventu |
| `POST /api/v1/edge/outbox/flush` | dávkové odeslání offline eventů registrovaného edge uzlu |
| `GET /api/v1/edge/replay-cursors/{nodeId}` | čtení potvrzeného replay cursoru edge uzlu |
| `POST /api/v1/edge/replay-cursors/{nodeId}/ack` | monotónní potvrzení zpracovaného replay offsetu |
| `GET /api/v1/edge/replay/{nodeId}` | policy-filtered replay centrálních eventů pro registrovaný edge uzel |
| `GET /api/v1/events/domain` | replay eventů podle offsetu, času, typu nebo entity |
| `GET /api/v1/events/dead-letter` | audit odmítnutých eventů |
| `GET /api/v1/events/dead-letter/{deadLetterId}` | detail odmítnutého eventu |
| `POST /api/v1/events/dead-letter/{deadLetterId}/redrive` | opětovné vložení opraveného eventu do runtime logu |
| `POST /api/v1/events/dead-letter/{deadLetterId}/resolve` | uzavření DLQ záznamu bez publikace náhradního eventu |
| `GET /mcp` | standalone MCP gateway popis endpointu pro externí agenty |
| `POST /mcp` | standalone MCP JSON-RPC endpoint pro externí agenty |
| `GET /mcp/tools` | standalone seznam allowlistovaných COP MCP nástrojů |
| `POST /mcp/tools/{toolId}/invoke` | standalone facade pro auditované volání read-only COP MCP nástroje |
| `GET /api/v1/mcp` | interní/kompatibilní client-safe popis MCP JSON-RPC endpointu v COP API |
| `POST /api/v1/mcp` | interní/kompatibilní MCP JSON-RPC endpoint v COP API |
| `GET /api/v1/mcp/tools` | interní/kompatibilní seznam allowlistovaných COP MCP nástrojů |
| `POST /api/v1/mcp/tools/{toolId}/invoke` | interní/kompatibilní auditované volání read-only COP MCP nástroje |

`POST /api/v1/events/domain` přijímá zjednodušený COP event command i
CloudEvents-like pole. COP jej normalizuje do CloudEvent `specversion=1.0`,
doplní `replayOffset`, `receivedAt` a zapíše jej do runtime logu. Neznámý
`producerNodeId` nebo nevalidní payload je odmítnut a uložen do DLQ.

`POST /api/v1/edge/outbox/flush` vyžaduje `nodeId` registrovaný přes heartbeat
jako `edge-node`. COP přepíše `producerNodeId` na tento uzel, takže odpojený
klient nemůže podvrhnout jiný zdroj. Dávka je limitovaná na 100 eventů. Každá
položka vrací stav `accepted`, `duplicate` nebo `rejected`; idempotence je podle
`id`/`eventId`, případně podle `clientEventId`, pokud klient neposlal vlastní
CloudEvent ID.

`fromOffset` u replay dotazu je exkluzivní: klient posílá poslední potvrzený
offset a COP vrací novější eventy. Edge klient po úspěšném flushi uloží nejvyšší
vrácený `replayOffset` a potvrzuje jej přes
`POST /api/v1/edge/replay-cursors/{nodeId}/ack`. Uložený cursor je monotónní:
nižší nebo opakovaný offset neposune serverový stav zpět. `GET
/api/v1/edge/replay-cursors/{nodeId}` vrací poslední durable acknowledgement
nebo implicitní offset `0`, pokud edge uzel ještě nic nepotvrdil.

Edge klient nemá pro běžnou synchronizaci číst globální
`GET /api/v1/events/domain`. Používá `GET /api/v1/edge/replay/{nodeId}`. COP
vezme uložený cursor jako výchozí `fromOffset`, případně respektuje explicitní
`fromOffset` pro recovery, načte centrální event log a vrátí jen eventy povolené
pro daný `edge-node`. Filtr kontroluje `classification.level` proti
`classificationMax` uzlu a `releasePolicy` proti veřejnému, internímu,
role-based nebo explicitnímu node scope. Odfiltrované eventy nejsou vráceny do
payloadu; odpověď uvádí pouze počty podle důvodu (`classification`,
`releasePolicy`). `nextOffset` je nejvyšší prohledaný offset, aby edge mohl po
durable zpracování vrácených položek a vědomém přeskočení nepovolených eventů
bezpečně potvrdit cursor.

DLQ workflow je operátorské. `GET /api/v1/events/dead-letter/{deadLetterId}`
zobrazí původní odmítnutý payload, stav (`open`, `redriven`, `resolved`) a
počet retry. Re-drive přijímá buď přímo opravený domain event command, nebo
objekt `{ "event": ... }`; prázdné tělo se pokusí znovu použít původní payload.
Nevalidní re-drive payload vrací validační chybu a nezakládá další DLQ záznam.
`resolve` slouží pro ruční uzavření záznamu, pokud byl odmítnutý event záměrně
zahozen nebo nahrazen jiným postupem.

Perzistence je idempotentní podle CloudEvent `id`/`eventId`. Replay offset je
serverem přidělený monotónní `bigserial` offset, nikoli klientský čas ani
lokální pořadí edge zařízení.

`POST /mcp` je preferovaný MCP JSON-RPC vstup pro externí agenty. Podporuje
metody `initialize`, `notifications/initialized`, `ping`, `tools/list` a
`tools/call`. REST endpointy `GET /mcp/tools` a
`POST /mcp/tools/{toolId}/invoke` jsou jednoduchá agent-facing facade. Interní
endpointy `GET /api/v1/mcp/tools` a
`POST /api/v1/mcp/tools/{toolId}/invoke` zůstávají kompatibilní facade pro web,
runbooky a smoke testy. Všechny cesty používají stejný server-side allowlist a
stejný audit v COP API.

Nejde o obecnou exekuci nástrojů. Registry vrací pouze allowlistované,
client-safe metadata. Aktuální implementované nástroje jsou read-only:

- `cop.federation.nodes.list`,
- `cop.area.summary`,
- `cop.fusion.explain`,
- `cop.events.replay`,
- `cop.events.dead_letters.list`,
- `cop.audit.events.list`.

Každé úspěšné volání zapisuje audit `MCP_TOOL_INVOKED` a současně publikuje
domain event `ai.tool.invoked` na kanál `cop.ai.audit`. Payload auditního
eventu obsahuje identitu nástroje, subject volajícího, výsledek a dobu běhu,
nikoli provider tokeny, plaintext chat zprávy ani citlivé binární přílohy.
`cop.area.summary` používá stejný katalog, policy filtraci a provider query
cestu jako mapové vrstvy. Vrací jen kompaktní situační souhrn, zdroje,
confidence a nejistoty; nevrací celé GeoJSON payloady ani žádná mutační
doporučení.
`cop.fusion.explain` navazuje na stejný souhrn a deterministicky sestaví
vysvětlitelné priority podle závažnosti, providerů, kategorie, polohy,
aktuálnosti a nejistot. Výstup obsahuje evidenci a doporučený další krok pro
operátora nebo klientskou aplikaci, ale nikdy sám nezakládá ani neupravuje
incident.
Měnící AI/MCP nástroje zůstávají mimo tento endpoint; musí vrátit návrh a
skutečnou změnu provede až explicitní COP command API s potvrzením uživatele.

Další runtime kroky:

1. doplnit DMZ publikaci `/edge/`, pokud má být edge runtime dostupný veřejně
   přes `cop.zeleznalady.cz`,
2. doplnit broker adapter pod stejným kontraktem, pokud pilot vyžádá externí
   message broker,
3. napojit edge outbox na iOS/PWA offline frontu a konfliktní dialogy,
4. rozšířit edge replay o subject/group ACL podle finální pilotní identity
   matice,
5. přidat retention/archivaci domain eventů a DLQ podle pilotní provozní politiky.

## CloudEvent Baseline

CloudEvent musí mít:

- `id`: unikátní identita eventu,
- `source`: URI nebo stabilní ID uzlu,
- `type`: doménový typ eventu,
- `specversion`: `1.0`,
- `time`: čas publikace,
- `subject`: volitelně ID entity,
- `datacontenttype`: `application/json`,
- `data`: COP domain payload.

COP payload musí obsahovat:

- `contractVersion`,
- `correlationId`,
- `producerNodeId`,
- `entityId`,
- `entityType`,
- `classification`,
- `releasePolicy`,
- `quality`,
- `provenance`,
- `payload`.

## Minimální Event Catalog

| Event | Význam |
| --- | --- |
| `incident.created` | vznik incidentu |
| `incident.updated` | změna incidentu |
| `incident.merged` | sloučení incidentů potvrzené člověkem |
| `unit.status.updated` | změna stavu jednotky/prostředku |
| `resource.capacity.updated` | změna dostupné kapacity |
| `sensor.observation.created` | nové měření/modelovaná hodnota |
| `alert.raised` | vznik výstrahy |
| `alert.acknowledged` | potvrzení výstrahy člověkem |
| `task.created` | vznik pracovního úkolu |
| `task.status.changed` | změna stavu úkolu |
| `node.disconnected` | ztráta uzlu |
| `node.reconnected` | návrat uzlu |
| `sync.conflict.detected` | konflikt synchronizace |
| `ai.summary.generated` | AI shrnutí |
| `ai.tool.invoked` | volání MCP/AI nástroje |

Existující COP eventy jako `report.created`, `media.attached`,
`sketch.drawing.created` a `notification.requested` zůstávají povolené a mapují
se na stejný envelope.

## Sync A Konflikty

Edge uzel ukládá lokální event log a outbox. Po návratu spojení:

1. ověří/obnoví registraci přes
   `POST /api/v1/federation/nodes/{nodeId}/heartbeat`,
2. odešle lokální eventy přes `POST /api/v1/edge/outbox/flush`,
   `producerNodeId` vynutí COP podle registrovaného `nodeId`,
3. přijme centrální policy-filtered replay přes
   `GET /api/v1/edge/replay/{nodeId}`,
4. po durable zpracování potvrdí cursor přes
   `POST /api/v1/edge/replay-cursors/{nodeId}/ack`,
5. vyhodnotí konflikty podle entity `revision`,
6. konflikt publikuje jako `sync.conflict.detected`,
7. vyžádá si ruční potvrzení operátora, pokud by došlo k přepsání dat.

Tiché přepsání není povolené.

## Classification A Release Policy

Pilotní úrovně:

- `PUBLIC`,
- `INTERNAL`,
- `SENSITIVE`,
- `RESTRICTED_SIMULATED`.

Event může být doručen jen uzlu a uživateli, který splní:

- roli,
- ABAC atributy,
- maximální klasifikaci uzlu,
- release policy entity,
- účel použití.

AI nástroje a MCP Gateway musí dostat pouze policy-filtered data.

## Provider Node Pravidla

SIM a další provideři:

- neposílají notifikace uživatelům,
- neznají APNs tokeny,
- nepočítají uživatelskou relevanci výstrah,
- poskytují katalog, features, observability a domain events,
- nesmí být přímo volané mobilním klientem.

## Messaging Node Pravidla

CSM Messaging:

- je autoritativní pro zařízení, push a chat metadata,
- nepřijímá mapovou relevanci od SIM,
- neposílá plaintext E2EE zprávy přes COP API,
- používá idempotentní notification intake od COP,
- poskytuje delivery audit.

## MCP Gateway Pravidla

MCP Gateway je povolená pouze pro nástroje v allowlistu. Každé volání obsahuje:

- subjectId,
- role,
- purpose,
- correlationId,
- tool name/version,
- input schema version,
- time,
- outcome.

Nástroje měnící stav vrací návrh. Provedení vyžaduje explicitní potvrzení
uživatele přes COP command API.

Pilotní COP publikuje jen read-only nástroje. Externí agenti používají
standalone gateway `/mcp`; COP API drží interní kompatibilní `/api/v1/mcp`.
Browser ani iOS klient nesmí dostat SIM provider token, CSM Messaging service
token, Matrix admin token ani payload plaintext zpráv.

## Ověření Pilotní Federace

Povinné testy:

- 3 uzly publikují a přijímají eventy,
- 30 minut offline edge režimu,
- replay bez ztráty eventů,
- DLQ při nevalidním eventu,
- RBAC/ABAC filtr eventu a AI dotazu,
- audit `ai.tool.invoked` a `alert.acknowledged`,
- export respektující classification/releasePolicy.
