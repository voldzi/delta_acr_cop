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

AI responses may include optional `routing` metadata from the server-side
`deterministic-v1` model router. It identifies the selected provider/model role
(`fast`, `reasoning` or provider default), selected model, complexity score and
fallback/embedding model names when configured. Clients may display the selected
model, but must not make provider or model decisions locally.
For `/api/v1/ai/chat-agent/query`, omitted `modelPreference` defaults to
`fast` so ordinary chat questions do not unexpectedly escalate to a heavy
reasoning model. Clients can still send `modelPreference=auto` or
`modelPreference=reasoning` when the user explicitly chooses that mode.

`/api/v1/ai/situation-summary` and `/api/v1/ai/chat-agent/query` also build a
server-side `semanticContext` for the LLM. COP API embeds only the already
authorized request context with `bge-m3`, ranks relevant COP entities/chat
snippets and passes a bounded result set to the LLM. The semantic layer does not
read Matrix history on the server and does not bypass RBAC/ABAC or media ACLs.
Before ranking, COP derives a server-side `retrievalIntent` from the user's
natural-language question and expands the retrieval query with safety-relevant
terms. General situational-awareness questions prioritize people, water/flood,
fire, health, infrastructure, traffic, security/police, community reports and
active alerts. Routine civil flight tracks are suppressed unless the question is
explicitly about the air picture or the air data has direct safety relevance.
The same endpoints also build `priorityContext` before semantic ranking. It
boosts flood/water, fire, medical, infrastructure, traffic, security/police,
community-report and active-alert signals, emits `[P*]`/`[S*]` citation
metadata for important claims and carries structured `mapSnapshot` candidates
for future map-preview rendering. Routine stale or low-confidence civil air
tracks are intentionally low priority unless directly relevant to the user
question, safety or a data-coverage caveat.

Before the provider call, COP applies `bge-m3` evidence-first prompt
compression. The model receives `contextCompression`, thin semantic/indexed
items without raw payload duplication and only the cited or crisis-relevant
records from the larger request snapshot. Omitted records remain counted in
`scope` and `result.structured.evidence`; omission from the prompt context does
not mean they are absent from COP or newly authorized to the client.

The same endpoints also attach `indexedContext` from the background
`AiContextIndex`. It is a read-only, audited query over public/policy-safe
canonical COP entities with geo filtering, a time window and `bge-m3` ranking.
Clients may pass `geoContext`, `bbox`, `currentLocation`, `placeQuery` and
`timeWindow`; if they do not, COP may infer a place from the natural-language
question through the configured geocoder. `indexedContext.citations` use `[I*]`
labels. The index does not include private community reports or server-side
Matrix E2EE history.

Both endpoints echo a bounded, client-safe evidence summary in
`result.structured.evidence`. The summary contains citation lists from
`priorityContext` (`[P*]`), request-time `semanticContext` (`[S*]`) and
background `indexedContext` (`[I*]`), plus map snapshot candidates for future
visual previews. It also carries `observability` with the applied
`retrievalIntent`, semantic/index/provider timings and prompt-compression byte
counts. UI clients may render these citations, counts and diagnostics, but must
not treat them as authorization to fetch entities outside the normal COP API
access rules.

AI endpoints bound expensive work before calling the model. Request-time
semantic retrieval embeds only the highest-priority candidate set
(`COP_AI_SEMANTIC_RETRIEVAL_CANDIDATE_LIMIT`, default 36) and has its own
timeout (`COP_AI_SEMANTIC_RETRIEVAL_TIMEOUT_MS`, default 20 s). The final model
call is capped by `COP_AI_REQUEST_TIMEOUT_MS` (default 70 s). If the provider
does not return in time, COP returns a normal audit-backed
`NEEDS_HUMAN_REVIEW` AI response with evidence metadata instead of leaving the
HTTP request hanging.
COP Chat should use `POST /api/v1/ai/chat-agent/jobs` for user-facing composer
requests. The job endpoint returns `202` with `cop-ai-chat-agent-job-v1`; the
client polls `GET /api/v1/ai/chat-agent/jobs/{jobId}` until `completed` or
`failed`. Completed jobs carry the final `AiCopResponse`. The synchronous
`POST /api/v1/ai/chat-agent/query` remains the compatibility endpoint and is
also the server-side execution path for jobs.

`/api/v1/ai/chat-agent/query` may include a bounded `chatContext` snapshot from
the client's currently visible/decrypted Matrix timeline. COP API combines that
explicit client context with authorized server-side COP data; it does not fetch
or decrypt Matrix room history on the server.

Enabling `metadata.chat.aiAssistant.enabled` for a community group now requires
explicit Matrix-room-member consent. COP provisions the configured AI bot as a
visible CSM Messaging/Matrix member and stores `matrixBot` plus `e2ee` status in
group metadata. The bot uses a dedicated Matrix account/device key model for
future E2EE room keys; provider tokens and Matrix bot tokens are never returned
to clients.
`POST /api/v1/ai/chat-agent/query` accepts optional `modelPreference` with
`auto`, `fast` or `reasoning`; COP Chat maps the AI dialog and `/reasoning`
slash command to this field.

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
