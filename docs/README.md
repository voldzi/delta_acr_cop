# Documentation Map

This repository keeps an established numbered documentation convention. The
central application standards are satisfied through the mapping below; the
flat files in this directory are stable entry points that point to the detailed
numbered documents.

Decision record: [ADR 0009](adr/0009_STANDARD_DOCUMENTATION_MAPPING_AND_JSON_OPENAPI.md).

## Standard Topic Mapping

| Standard topic                   | Local canonical document(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                      | [../README.md](../README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/architecture.md`           | [architecture.md](architecture.md), [architecture/00_INDEX.md](architecture/00_INDEX.md), [application/03_BACKEND_ARCHITECTURE.md](application/03_BACKEND_ARCHITECTURE.md), [application/04_FRONTEND_ARCHITECTURE.md](application/04_FRONTEND_ARCHITECTURE.md), [mobile/02_PHONE_ONLY_MESH_DEVELOPMENT_SPEC.md](mobile/02_PHONE_ONLY_MESH_DEVELOPMENT_SPEC.md)                                                                                                                                                                                                 |
| `docs/api.md`                    | [api.md](api.md), [api/00_INDEX.md](api/00_INDEX.md), [integration/00_INDEX.md](integration/00_INDEX.md), [mobile/01_NATIVE_IOS_IPADOS_APP.md](mobile/01_NATIVE_IOS_IPADOS_APP.md), [mobile/02_PHONE_ONLY_MESH_DEVELOPMENT_SPEC.md](mobile/02_PHONE_ONLY_MESH_DEVELOPMENT_SPEC.md)                                                                                                                                                                                                                                                                             |
| Data contracts                   | [data/00_INDEX.md](data/00_INDEX.md), [data/07_CANONICAL_ENTITY_MODEL_V2.md](data/07_CANONICAL_ENTITY_MODEL_V2.md), [application/12_INCIDENT_TASK_AND_FUSION.md](application/12_INCIDENT_TASK_AND_FUSION.md), [integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md](integration/13_EVENT_CONTRACT_AND_ASYNCAPI.md), [integration/14_AI_COP_NIPS_FEDERATION_CONTRACT.md](integration/14_AI_COP_NIPS_FEDERATION_CONTRACT.md), [../asyncapi/asyncapi.json](../asyncapi/asyncapi.json)                                                                                   |
| Shared geo foundation            | [ADR 0021](adr/0021_SHARED_GEO_FOUNDATION.md), [SIM routing handoff](integration/16_SHARED_GEO_SIM_ROUTING_HANDOFF.md), [Městem hrou handoff](integration/17_MESTEM_HROU_GEO_HANDOFF.md), [tile runbook](runbooks/10_TILE_CACHE_AND_MAP_TILES.md)                                                                                                                                                                                                                                                                                                              |
| `docs/security.md`               | [security.md](security.md), [security/00_INDEX.md](security/00_INDEX.md), [integration/06_ERROR_MODEL.md](integration/06_ERROR_MODEL.md)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/operations.md`             | [operations.md](operations.md), [runbooks/00_INDEX.md](runbooks/00_INDEX.md), [runbooks/03_ENVIRONMENT_CONFIGURATION.md](runbooks/03_ENVIRONMENT_CONFIGURATION.md), [runbooks/04_RUNNING_MAIN_COP.md](runbooks/04_RUNNING_MAIN_COP.md), [runbooks/13_EDGE_NODE_RUNTIME.md](runbooks/13_EDGE_NODE_RUNTIME.md), [runbooks/17_COP_MEDIA_S3.md](runbooks/17_COP_MEDIA_S3.md)                                                                                                                                                                                       |
| `docs/observability.md`          | [observability.md](observability.md), [application/08_AUDIT_AND_OBSERVABILITY.md](application/08_AUDIT_AND_OBSERVABILITY.md), [runbooks/04_RUNNING_MAIN_COP.md](runbooks/04_RUNNING_MAIN_COP.md)                                                                                                                                                                                                                                                                                                                                                               |
| `docs/runbook.md`                | [runbook.md](runbook.md), [runbooks/00_INDEX.md](runbooks/00_INDEX.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Product scope, roadmap and scale | [product/00_INDEX.md](product/00_INDEX.md), [product/07_AI_COP_NIPS_TARGET_ROADMAP.md](product/07_AI_COP_NIPS_TARGET_ROADMAP.md), [product/10_AI_COP_FEDERATION_GAP_CLOSURE_ASSIGNMENT.md](product/10_AI_COP_FEDERATION_GAP_CLOSURE_ASSIGNMENT.md), [COP Performance and Scale Playbook](COP_PERFORMANCE_AND_SCALE_PROPOSAL.md), [Public readiness implementation](product/11_PUBLIC_READINESS_IMPLEMENTATION.md), [inclusive public pilot](product/12_INCLUSIVE_PUBLIC_PILOT_PROTOCOL.md), [device coverage decision](product/13_DEVICE_COVERAGE_DECISION.md), [driver navigation and reporting](product/14_DRIVER_NAVIGATION_AND_REPORTING_PLAN.md) |
| AI behavior and evaluations      | [ai/00_INDEX.md](ai/00_INDEX.md), [ai/10_RESPONSE_PLAYBOOK_AND_EVALS.md](ai/10_RESPONSE_PLAYBOOK_AND_EVALS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ADRs                             | [adr/00_INDEX.md](adr/00_INDEX.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OpenAPI                          | [../openapi/openapi.json](../openapi/openapi.json), generated export [api/openapi-main-cop.yaml](api/openapi-main-cop.yaml)                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Maintenance

COP host storage separation, retention, deployment and recovery evidence:
[X5 runbook](runbooks/19_COP_X5_STORAGE.md),
[ADR 0038](adr/0038_COP_X5_OPERATIONAL_STORAGE_BOUNDARY.md).

- Keep this table current when moving or adding canonical documentation.
- Historical notes and superseded analyses belong in `docs/archive/`.
- API behavior changes must update `openapi/openapi.json`; the YAML export is
  generated from JSON.

Driver integration release evidence: [integration/20_DRIVER_REPORTING_RELEASE.md](integration/20_DRIVER_REPORTING_RELEASE.md).

Driver navigation/reporting: [delivery plan](product/14_DRIVER_NAVIGATION_AND_REPORTING_PLAN.md), [release record](integration/20_DRIVER_REPORTING_RELEASE.md), [ADR 0023](adr/0023_DURABLE_ROAD_REPORT_ENRICHMENT.md).

Staged user-owned AI credential and SIM handoff: [ADR 0031](adr/0031_USER_FUNDED_AI_CHAT_CREDENTIAL_STAGING.md).

Jízda directed road attributes: [routing contract, measured pilot probes and mobile handoff](integration/21_JIZDA_DIRECTED_ROAD_ATTRIBUTES.md).
Jízda route-bound tunnel contract: [ADR 0032](adr/0032_ROUTE_BOUND_TUNNEL_DATA_FOR_JIZDA.md).
Jízda consented measurement adapter (default off): [mobile handoff](integration/22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md), [ADR 0033](adr/0033_CONSENTED_JIZDA_MEASUREMENT_BOUNDARY.md).

Veřejná syntetická povodňová ukázka: [spuštění a provoz](runbooks/18_PUBLIC_FLOOD_DEMO.md), [ADR 0026](adr/0026_ISOLATED_PUBLIC_FLOOD_DEMO.md).

Jízda immutable road-trip routing: [contract, SDK integration and activation gates](integration/23_JIZDA_ROAD_TRIP_CONTRACT.md).

Jízda road-trip published revisions and test evidence: [acceptance record](integration/24_JIZDA_ROAD_TRIP_ACCEPTANCE.md).

Jízda road-trip server deployment and remaining activation blockers: [production record](integration/25_JIZDA_ROAD_TRIP_PRODUCTION.md).

Ordinary reviewed closure evidence: [contract and scoped SDK handoff](integration/26_JIZDA_KNOWN_CLOSURES.md); ordinary release active with incomplete coverage; physical acceptance pending.

- [27. Jízda mapped vehicle profiles](integration/27_JIZDA_MAPPED_VEHICLE_PROFILES.md): typed ordinary intents, incomplete mapped restrictions, route-bound assessment and actual target guidance (server release deployed; mobile acceptance pending).

Public demo analytics: [integration and release gate](analytics/integration.md), [CZ/EN notice proposal](analytics/privacy-review.md); disabled pending acceptance.

- [Shared mobility v1 JSON contract](api/shared-mobility-v1.openapi.json) — accounts, shared vehicles and private Dispatch; implementation in progress.
- [Jízda shared vehicles/Dispatch handoff](integration/29_JIZDA_SHARED_VEHICLES_DISPATCH_HANDOFF.md) — release status and client integration.

- [31. Jízda community reports and police patrols](integration/31_JIZDA_COMMUNITY_REPORTS.md): server feed decisions, police category, shared SDK and production evidence.

Automatic crisis notifications and separate ČT24 context:
[current notification contract](integration/12_COP_NOTIFICATION_DECISION_AND_PUSH.md),
[configuration, release and pending acceptance](runbooks/21_COP_CRISIS_NOTIFICATIONS.md),
[ADR 0040](adr/0040_VERIFIED_CRISIS_NOTIFICATIONS_AND_MEDIA_CONTEXT.md).
Production activation and physical closed-app delivery must be recorded
separately; neither ready SIM data nor Messaging intake establishes full coverage
or phone receipt.
- [Public search discovery](analytics/search-discovery.md): public landing page, crawler rules and search-engine acceptance.

- [32. COP Dispatch lease recovery](integration/32_COP_DISPATCH_LEASE_RECOVERY.md): approved API-only runtime recovery, observed health gap and separate proposal for lease recovery/readiness.

- [33. Jízda mobility runtime and contract recheck](integration/33_JIZDA_MOBILITY_RUNTIME_CONTRACT_RECHECK.md): recurring Dispatch lease loss, current SDK/runtime, exact invitations/stop/cancel/encrypted snapshot boundaries and remaining device acceptance.

- [34: Dispatch recovery release](integration/34_COP_DISPATCH_RECOVERY_RELEASE.md).

- [35: Mobility invitation notifications](integration/35_MOBILITY_INVITATION_NOTIFICATIONS.md).

- [36: COP self profile / Jízda Já](integration/36_COP_SELF_PROFILE.md).

- [38: Shared vehicle record details v1](integration/38_SHARED_VEHICLE_RECORD_DETAILS.md): same forms, lossless receipts; release and device acceptance status.
