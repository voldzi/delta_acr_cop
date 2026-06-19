# API

COP provides a REST API. The binding machine-readable contract is:

- [openapi/openapi.json](../openapi/openapi.json)

The compatibility YAML export is generated from the JSON contract:

- [docs/api/openapi-main-cop.yaml](api/openapi-main-cop.yaml)

Human API documentation remains in the established numbered documentation set:

- [API index](api/00_INDEX.md)
- [Shared integration contracts](integration/00_INDEX.md)
- [Ingest API contract](integration/03_INGEST_API_CONTRACT.md)
- [Streaming contract](integration/04_STREAMING_CONTRACT.md)
- [Error model](integration/06_ERROR_MODEL.md)
- [Map catalog provider contract](integration/08_MAP_CATALOG_V1.md)
- [CSM Messaging integration](integration/09_CSM_MESSAGING_INTEGRATION.md)
- [COP notification decision and push](integration/12_COP_NOTIFICATION_DECISION_AND_PUSH.md)
- [AI-COP/NIPS federation contract](integration/14_AI_COP_NIPS_FEDERATION_CONTRACT.md)
- [Native iOS/iPadOS API guide](mobile/01_NATIVE_IOS_IPADOS_APP.md)

Existing live system endpoints are `/health/live`, `/health/ready` and
`/health/dependencies`. They are intentionally kept for compatibility and
documented in the OpenAPI contract.

Current COP error responses use the repository's compatibility envelope with
`correlationId`; this shape is documented in the OpenAPI contract and
[Error model](integration/06_ERROR_MODEL.md). Any migration to a different
request-id field must be compatibility-safe and recorded in an ADR.
