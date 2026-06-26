# Documentation Map

This repository keeps an established numbered documentation convention. The
central application standards are satisfied through the mapping below; the
flat files in this directory are stable entry points that point to the detailed
numbered documents.

Decision record: [ADR 0009](adr/0009_STANDARD_DOCUMENTATION_MAPPING_AND_JSON_OPENAPI.md).

## Standard Topic Mapping

| Standard topic | Local canonical document(s) |
| --- | --- |
| `README.md` | [../README.md](../README.md) |
| `docs/architecture.md` | [architecture.md](architecture.md), [architecture/00_INDEX.md](architecture/00_INDEX.md), [application/03_BACKEND_ARCHITECTURE.md](application/03_BACKEND_ARCHITECTURE.md), [application/04_FRONTEND_ARCHITECTURE.md](application/04_FRONTEND_ARCHITECTURE.md) |
| `docs/api.md` | [api.md](api.md), [api/00_INDEX.md](api/00_INDEX.md), [integration/00_INDEX.md](integration/00_INDEX.md), [mobile/01_NATIVE_IOS_IPADOS_APP.md](mobile/01_NATIVE_IOS_IPADOS_APP.md) |
| Data contracts | [data/00_INDEX.md](data/00_INDEX.md), [data/07_CANONICAL_ENTITY_MODEL_V2.md](data/07_CANONICAL_ENTITY_MODEL_V2.md), [application/12_INCIDENT_TASK_AND_FUSION.md](application/12_INCIDENT_TASK_AND_FUSION.md), [integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md](integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md), [integration/14_AI_COP_NIPS_FEDERATION_CONTRACT.md](integration/14_AI_COP_NIPS_FEDERATION_CONTRACT.md), [../asyncapi/asyncapi.json](../asyncapi/asyncapi.json) |
| `docs/security.md` | [security.md](security.md), [security/00_INDEX.md](security/00_INDEX.md), [integration/06_ERROR_MODEL.md](integration/06_ERROR_MODEL.md) |
| `docs/operations.md` | [operations.md](operations.md), [runbooks/00_INDEX.md](runbooks/00_INDEX.md), [runbooks/03_ENVIRONMENT_CONFIGURATION.md](runbooks/03_ENVIRONMENT_CONFIGURATION.md), [runbooks/04_RUNNING_MAIN_COP.md](runbooks/04_RUNNING_MAIN_COP.md), [runbooks/13_EDGE_NODE_RUNTIME.md](runbooks/13_EDGE_NODE_RUNTIME.md) |
| `docs/observability.md` | [observability.md](observability.md), [application/08_AUDIT_AND_OBSERVABILITY.md](application/08_AUDIT_AND_OBSERVABILITY.md), [runbooks/04_RUNNING_MAIN_COP.md](runbooks/04_RUNNING_MAIN_COP.md) |
| `docs/runbook.md` | [runbook.md](runbook.md), [runbooks/00_INDEX.md](runbooks/00_INDEX.md) |
| Product scope, roadmap and scale | [product/00_INDEX.md](product/00_INDEX.md), [product/07_AI_COP_NIPS_TARGET_ROADMAP.md](product/07_AI_COP_NIPS_TARGET_ROADMAP.md), [product/10_AI_COP_FEDERATION_GAP_CLOSURE_ASSIGNMENT.md](product/10_AI_COP_FEDERATION_GAP_CLOSURE_ASSIGNMENT.md), [COP Performance and Scale Playbook](COP_PERFORMANCE_AND_SCALE_PROPOSAL.md) |
| ADRs | [adr/00_INDEX.md](adr/00_INDEX.md) |
| OpenAPI | [../openapi/openapi.json](../openapi/openapi.json), generated export [api/openapi-main-cop.yaml](api/openapi-main-cop.yaml) |

## Maintenance

- Keep this table current when moving or adding canonical documentation.
- Historical notes and superseded analyses belong in `docs/archive/`.
- API behavior changes must update `openapi/openapi.json`; the YAML export is
  generated from JSON.
