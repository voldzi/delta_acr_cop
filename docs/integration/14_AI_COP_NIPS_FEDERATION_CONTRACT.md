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
  "softwareVersion": "0.1.0",
  "lastSeenAt": "2026-06-19T12:00:00Z",
  "health": "ok"
}
```

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
broker facade a append-only event log pro pilotní federaci. Pokud je dostupná
`COP_DATABASE_URL`, používá persistentní PostgreSQL runtime store
(`COP_FEDERATION_STORE=auto|postgres`) s tabulkami `cop_federation_nodes`,
`cop_domain_events` a `cop_domain_dead_letters`. Bez databáze běží in-memory
fallback vhodný pouze pro vývoj.

Aktuální endpointy jsou chráněné bearer autentizací a nejsou veřejným klientským
API:

| Endpoint | Účel |
| --- | --- |
| `GET /api/v1/federation/nodes` | seznam registrovaných uzlů |
| `GET /api/v1/federation/nodes/{nodeId}` | detail uzlu |
| `POST /api/v1/federation/nodes/{nodeId}/heartbeat` | registrace/heartbeat uzlu |
| `POST /api/v1/events/domain` | publikace COP domain eventu |
| `POST /api/v1/edge/outbox/flush` | dávkové odeslání offline eventů registrovaného edge uzlu |
| `GET /api/v1/events/domain` | replay eventů podle offsetu, času, typu nebo entity |
| `GET /api/v1/events/dead-letter` | audit odmítnutých eventů |

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
vrácený `replayOffset` a používá jej pro následný replay.

Perzistence je idempotentní podle CloudEvent `id`/`eventId`. Replay offset je
serverem přidělený monotónní `bigserial` offset, nikoli klientský čas ani
lokální pořadí edge zařízení.

Další runtime kroky:

1. přidat explicitní ack cursor pro edge uzly,
2. zavést DLQ retry/re-drive workflow pro operátora,
3. filtrovat replay podle classification/releasePolicy a subject role,
4. doplnit broker adapter pod stejným kontraktem, pokud pilot vyžádá externí
   message broker,
5. napojit edge outbox na iOS/PWA offline frontu a konfliktní dialogy.

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
3. přijme centrální replay od posledního potvrzeného offsetu,
4. vyhodnotí konflikty podle entity `revision`,
5. konflikt publikuje jako `sync.conflict.detected`,
6. vyžádá si ruční potvrzení operátora, pokud by došlo k přepsání dat.

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

## Ověření Pilotní Federace

Povinné testy:

- 3 uzly publikují a přijímají eventy,
- 30 minut offline edge režimu,
- replay bez ztráty eventů,
- DLQ při nevalidním eventu,
- RBAC/ABAC filtr eventu a AI dotazu,
- audit `ai.tool.invoked` a `alert.acknowledged`,
- export respektující classification/releasePolicy.
