# Incident, Task and Fusion Runtime

COP now contains the first runtime step from the AI-COP/NIPS roadmap: a
server-side incident workflow over civil data. The goal is to move from a pure
map view to an auditable situation process while preserving the safety boundary:
no targeting, no weapon workflow and no automated instruction to act.

## Responsibilities

COP is authoritative for:

- incident records created or confirmed by an operator,
- deterministic fusion suggestions over community reports,
- incident tasks used to track civil follow-up work,
- domain events, audit entries and replay for incident/task lifecycle changes.

SIM remains a server-to-server data provider. CSM Messaging remains the delivery
and chat provider. iOS/iPadOS clients use this COP API contract and do not
calculate incident relevance or fusion locally.

## Incident Model

An incident is an operator-curated civil situation entity. It has:

- `incidentId`,
- `title` and optional `description`,
- `category`: `community`, `fire`, `flood`, `infrastructure`, `medical`,
  `other`, `security`, `traffic`, `weather`,
- `severity`: `info`, `advisory`, `warning`, `critical`,
- `status`: `candidate`, `monitoring`, `active`, `resolved`, `closed`,
  `rejected`,
- `confidence` between `0` and `1`,
- `location` with `lat`, `lon` and source,
- `sourceRefs` pointing to community reports, provider features, alerts,
  sketches or manual inputs,
- `properties` and `provenance` for bounded structured context.

Incidents are exposed as GeoJSON points through `GET /api/v1/incidents` so the
web and native clients can use the same map rendering pipeline.

## Fusion Suggestions

`GET /api/v1/incidents/fusion/suggestions` produces explainable deterministic
suggestions from submitted/published community reports. Version 1 clusters
reports by:

- mapped incident category,
- distance from cluster centroid,
- observation time window.

The response includes `sourceRefs`, `reportIds`, `metrics`, `confidence`,
`explanation` and a suggested location. A suggestion is not an incident until an
authenticated operator creates one with `POST /api/v1/incidents`.

This is intentionally deterministic and auditable. AI may later summarize or
explain why a suggestion exists, but AI must not silently promote it.

## Tasks

Incident tasks live under an incident:

- `GET /api/v1/incidents/{incidentId}/tasks`,
- `POST /api/v1/incidents/{incidentId}/tasks`,
- `PATCH /api/v1/incidents/{incidentId}/tasks/{taskId}`.

Tasks track follow-up such as verification, contact, documentation or field
coordination. They are not orders to use force and must not contain targeting or
weapon workflow semantics.

## Web Operator Workflow

The web client exposes the first operator workflow in the `Výstrahy` workspace.
Authenticated operators can:

- refresh deterministic fusion suggestions for the current map viewport,
- inspect why a suggestion exists: report count, spatial spread, time window and
  confidence,
- promote a suggestion into an active incident,
- inspect active/candidate/monitoring incidents in the same view,
- switch an incident between `active`, `monitoring` and `resolved`,
- create follow-up tasks and mark them as `in_progress` or `done`.

The UI deliberately keeps this as an operator-confirmed process. Fusion
suggestions are presented as explainable recommendations from submitted
community reports, but COP never turns them into incidents automatically.
Unauthenticated users can continue to browse the public map, but they cannot
create or manage incidents and tasks.

For PoC demonstrations this provides the civil workflow chain:

`community report -> fusion suggestion -> confirmed incident -> follow-up task`.

## Persistence

`COP_INCIDENT_STORE` controls persistence:

- `auto`: PostgreSQL when `COP_DATABASE_URL` is present, otherwise memory,
- `postgres` or `postgresql`: force PostgreSQL,
- `memory`: in-memory development mode,
- `disabled` or `off`: disable the primary incident store.

The API keeps an in-memory fallback so operator workflows remain available if
the durable store temporarily degrades. Production should use PostgreSQL/Patroni
through `COP_DATABASE_URL`.

PostgreSQL tables:

- `cop_incidents`,
- `cop_incident_tasks`.

## Domain Events and Audit

Lifecycle changes emit domain events for replay/edge integration:

- `incident.created`,
- `incident.updated`,
- `task.created`,
- `task.status.changed`.

Each event carries guardrails:

- `NO_TARGETING`,
- `NO_WEAPON_WORKFLOW`.

Audit entries record actor subject, status/category/priority and identifiers.
The audit log is informational and does not replace policy enforcement.

## API Contract

The binding REST contract is `openapi/openapi.json`. YAML under
`docs/api/openapi-main-cop.yaml` is generated compatibility output.

Current endpoints:

- `GET /api/v1/incidents/fusion/suggestions`,
- `GET /api/v1/incidents`,
- `POST /api/v1/incidents`,
- `GET /api/v1/incidents/{incidentId}`,
- `PATCH /api/v1/incidents/{incidentId}`,
- `GET /api/v1/incidents/{incidentId}/tasks`,
- `POST /api/v1/incidents/{incidentId}/tasks`,
- `PATCH /api/v1/incidents/{incidentId}/tasks/{taskId}`.

All endpoints require an authenticated operator identity. Public map browsing
does not expose incident management.

## Next Steps

This v1 runtime is deliberately narrow. The next AI-COP/NIPS increments are:

- explicit incident-to-notification rules,
- task assignment policy and group membership checks,
- richer provider-feature source references,
- operator confirmation/rejection workflow for fusion suggestions,
- analytics over missing data and source conflicts,
- edge offline outbox support for incident/task changes.
