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
- [Local AI provider and assistant endpoints](ai/05_LOCAL_LLM_PROVIDER.md)
- [Native iOS/iPadOS API guide](mobile/01_NATIVE_IOS_IPADOS_APP.md)
- [PoC demo runbook and resettable seed](runbooks/14_CLIENT_POC_DEMO_GUIDE.md)

Existing live system endpoints are `/health/live`, `/health/ready` and
`/health/dependencies`. They are intentionally kept for compatibility and
documented in the OpenAPI contract.

Current COP error responses use the repository's compatibility envelope with
`correlationId`; this shape is documented in the OpenAPI contract and
[Error model](integration/06_ERROR_MODEL.md). Any migration to a different
request-id field must be compatibility-safe and recorded in an ADR.

AI clients must call only COP API endpoints such as
`/api/v1/ai/situation-summary`, `/api/v1/ai/chat-agent/query`,
`/api/v1/ai/source-health-summary` and `/api/v1/ai/community-report/draft`.
Browser and native clients must never call Ollama, AI KnowledgeBase LLM Gateway
or any provider service token directly.

`/api/v1/ai/chat-agent/query` may include a bounded `chatContext` snapshot from
the client's currently visible/decrypted Matrix timeline. COP API combines that
explicit client context with authorized server-side COP data; it does not fetch
or decrypt Matrix room history on the server.

The resettable PoC demo is exposed through `/api/v1/demo/scenarios` and
documented in the OpenAPI contract. Demo seeding and reset are server-side
operations; browser and native clients only launch them through authenticated COP
API calls.

Community sharing groups expose membership management through the OpenAPI
contract. `DELETE /api/v1/community/groups/{groupId}/members/me` marks the
authenticated caller as `left`; the last active owner/admin cannot leave until
another active manager exists or the group is deleted. Managers can remove
another member through
`DELETE /api/v1/community/groups/{groupId}/members/{subjectId}`, which marks
the target membership as `left` and keeps the historical membership record.
