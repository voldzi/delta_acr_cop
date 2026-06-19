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

1. odešle lokální eventy s původním `producerNodeId`,
2. přijme centrální replay od posledního potvrzeného offsetu,
3. vyhodnotí konflikty podle entity `revision`,
4. konflikt publikuje jako `sync.conflict.detected`,
5. vyžádá si ruční potvrzení operátora, pokud by došlo k přepsání dat.

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

