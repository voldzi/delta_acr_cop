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

Community-report clients use a server-owned lifecycle:

- omitted `validUntil` receives a category-specific default;
- the active list excludes expired reports unless `includeExpired=true`;
- `version` and optional `expectedVersion` protect against silent concurrent
  overwrites (`409` on mismatch);
- `DELETE /api/v1/community/reports/{reportId}` removes drafts only;
- active reports are closed through `/resolve` or `/withdraw`; withdrawal
  requires a reason and neither operation destroys history;
- submit creates the private report discussion server-side when no group is
  linked, and submit/update/resolve/withdraw synchronize its lifecycle metadata;
- update, resolve and withdraw decisions use versioned notification
  idempotency keys so recipients receive a correction without duplicate pushes.
- report and attachment creation accept a UUID `X-Idempotency-Key`; an identical
  retry returns the same resource with `200`, while conflicting content returns
  `409 IDEMPOTENCY_CONFLICT`;
- driver clients may send bounded `captureContext` and `roadContext` with a
  report. COP preserves them as provenance for Jizda/COP Mobile, but treats
  client-declared road names, headings and app identity as observations until
  server-side enrichment or review confirms them;
- traffic-specific categories include accidents, congestion, stopped vehicles,
  dangerous weather and the existing road-blockage/general-hazard values;
- `PATCH /api/v1/community/reports/{reportId}/attachments/{attachmentId}/access`
  lets the owner change an existing attachment ACL. Responses to non-owners omit
  the ACL subject and group identifiers, and every content request re-evaluates
  current access.

Direct voice calls use the authoritative endpoints:

- `GET/POST /api/v1/messaging/calls`
- `GET /api/v1/messaging/calls/{callId}`
- `POST /api/v1/messaging/calls/{callId}/actions`

The API returns lifecycle metadata and, only to an authorized active
participant, short-lived LiveKit credentials together with the call-scoped
`media.e2eeKey`. Web and native clients must enable LiveKit end-to-end media
encryption before connecting. Audio, SDP and chat plaintext do not traverse COP
API. Matrix VoIP and `/messaging/calls/wake` are not part of the current
contract. `POST /api/v1/messaging/calls` requires the bound
`roomId`; `participantSubjectIds` is optional because the API normally resolves
the canonical `directPeer` from the server-owned conversation. Transport-level
Matrix aliases are never authoritative call recipients.

An accepting client sends its stable, opaque `endpointId` with the `accept`
action. COP stores the first accepted endpoint atomically and returns
`acceptedByEndpointId` in subsequent call views. Another browser or native app
signed in as the same user must stop ringing and present the call as answered
elsewhere; it must not report `media_failed` for the shared call. Endpoint IDs
identify an installation for coordination only and carry no credential.

AI clients must call only COP API endpoints such as
`/api/v1/ai/situation-summary`, `/api/v1/ai/chat-agent/query`,
`/api/v1/ai/source-health-summary` and `/api/v1/ai/community-report/draft`.
Browser and native clients must never call Ollama, AI KnowledgeBase LLM Gateway
or any provider service token directly.

Emergency routing clients must also call only COP API endpoints:
`/api/v1/routing/profiles`, `/api/v1/routing/route`,
`/api/v1/routing/alternatives`, `/api/v1/routing/isochrone` and
`/api/v1/routing/nearest-access`. COP calls SIM server-to-server and renders
the returned route `features[]`, ETA, distance, rank, steps, quality, traffic
incidents, elevation profile, weather on route, hazards on route, degradation
state, warnings and alternatives as a temporary operational map overlay. COP
does not calculate routing graphs in the browser or API process. The optional
`traffic.liveSpeeds` object is forwarded unchanged from SIM and has typed
freshness, coverage, applied-flow/edge count and routing-dataset fields. Route
ETA is always SIM's `durationSeconds`; COP never adds `delayPenaltySeconds` or
another client-side delay to a traffic-adjusted duration. A `degraded` live
speed state describes limited traffic-data coverage or quality and does not
mean that routing failed.
Road clients may opt in to `includeRoadAttributes` and send actual `vehicle`
dimensions. Optional per-variant `roadAttributes` contain directed shape-index
speed limits and honest availability; `coverage` carries the graph coverage and
dataset build date. COP removes SIM `direct_fallback` lines from navigable
`routes`/`features` and reports `outside_coverage` so native clients can use
MapKit. See [Jízda directed attributes](integration/21_JIZDA_DIRECTED_ROAD_ATTRIBUTES.md).

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

For `chat-agent/query`, search-like questions such as "najdi", "vyhledej" or
"nejbližší" also create an audited `mapSearch` context. COP uses the same map
catalog/query path as the map UI and, when enabled, first asks the internal SIM
`sim-search-source-v1` provider (`COP_SIM_SEARCH_DATA_*`) for normalized
country-wide search entities. COP also pages `GET /search-data/api/v1/entities`
into the background AI context index, bounded by `COP_SIM_SEARCH_DATA_INDEX_LIMIT`,
so non-interactive situational-awareness questions can retrieve SIM canonical
map entities through indexed evidence. Known emergency categories such as police,
fire, rescue, shelters, defibrillators, sirens, healthcare and pharmacies still
resolve to narrow catalog layers, but generic "find/show/nearest" questions now
also search queryable catalog layers in the supplied bbox and match feature
metadata such as label, category, layer, provider/source IDs, tags and summary.
This lets the agent return clickable map results for authorized COP map objects
such as water gauges, transport stops, community reports, bridges, weather
points and future GeoJSON-like catalog layers when the underlying provider
exposes them. Place-only searches continue to use the geocoder. Results are
folded into `priorityContext` as `mapFeature` citations and map snapshot
candidates. When an explicit map-search question has at least one validated
map result, COP may answer deterministically from `mapSearch` without waiting
for the LLM provider, so the chat cannot contradict the authoritative map tool
by claiming that no result was found. If SIM search-data is unavailable, COP
keeps using the existing catalog/query and geocoder fallbacks and records the
SIM search failure in audit and Source Health. When the client supplies an
explicit `geoContext.currentLocation` or bbox and catalog/SIM search returns no
matching result, COP also runs a bounded geocoder fallback for known emergency
categories. If that fallback is empty too, the deterministic answer must state
that the supplied location or area was searched; it must not claim that the
assistant has no access to the user's location.

Hydrology and weather questions are also treated as COP/SIM operational
context, not only as free-form LLM prompts. Questions about water level,
discharge, gauges or "where is water measured nearby" route to SIM entity types
`hydro_station`, `hydro_measurement` and `flood_risk_area` with preferred
source systems `chmi_hydro` and `safety_data`; deterministic answers render
available metrics such as `waterLevelCm`, `discharge`, `waterTemperatureC`,
`floodStage` and the observation timestamp. Weather, rain, wind, temperature,
radar and storm questions route through SIM search-data with entity types
`weather_forecast`, `weather_nowcast`, `weather_radar` and
`thunderstorm_risk`, source systems `weather_forecast` and `chmi_weather_radar`,
and `validAt` set to the request timestamp. COP renders the values supplied by
SIM directly, including `observedAt`, `validFrom`, `validUntil`, precipitation
10 min / 1 h / 3 h, precipitation and thunderstorm probability, wind, gusts,
risk, lightning feed availability and `providerProperties.weatherForecast` or
`providerProperties.display` detail URLs. COP must not derive rain or storm
answers from `weatherCode`. If no current weather entity is returned, the
deterministic answer must say that COP/SIM has no confirmed meteo result for the
query; it must not infer that there is no rain or no storm. When SIM uses a
provider fallback such as MET Norway, COP preserves and may display
`providerProperties.weatherForecast.fallbackUsed=true`.

SIM `osm_reference` entities are treated as public reference read-models, not
confirmed operational status. COP preserves `handling`, `allowedUse`,
`classification`, `visibility`, `metrics` and `positionQuality` in AI evidence
and map results; `reference_not_operational_status` must be rendered as a
reference caveat.

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
HTTP request hanging. If the timed-out request already has a concrete
`mapSearch` result, COP may return a completed deterministic map-search answer
from COP data instead of discarding the useful result.
COP Chat should use `POST /api/v1/ai/chat-agent/jobs` for user-facing composer
requests. The job endpoint returns `202` with `cop-ai-chat-agent-job-v1`; the
client polls `GET /api/v1/ai/chat-agent/jobs/{jobId}` until `completed` or
`failed`. Completed jobs carry the final `AiCopResponse`. The synchronous
`POST /api/v1/ai/chat-agent/query` remains the compatibility endpoint and is
also the server-side execution path for jobs.

`/api/v1/ai/chat-agent/query` may include a bounded `chatContext` snapshot from
the client's currently visible/decrypted Matrix timeline. COP API combines that
explicit client context with authorized server-side COP data; it does not fetch
or decrypt Matrix room history on the server. Web and native clients use the
same maximum of 30 recent messages and may include `replyToEventId` for an
explicit reply. The API resolves a small chronological, topic-compatible
discussion window across participants; participant text remains unverified
conversation context until corroborated by authorized COP evidence.

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

## Potvrzení komunitních dopravních hlášení

Autentizovaný klient potvrzuje aktuální pozorování přes
`PUT /api/v1/community/reports/{reportId}/confirmation` s hodnotou
`still_there` nebo `not_there`. COP uchovává právě jeden aktuální hlas na
uživatele a hlášení; další volba stejného uživatele předchozí hodnotu nahradí.
Odpověď i seznam hlášení obsahují agregované `confirmations` a transparentní
`confidenceSummary`. Skóre kombinuje čerstvost, přesnost polohy a bilanci
potvrzení. Nejde o automatické potvrzení incidentu ani příkaz ke změně trasy.

Krátkodobé dopravní kategorie dostávají při vytvoření serverový `validUntil`.
Po jeho uplynutí se hlášení nezobrazuje v aktivním feedu a nelze je dále
potvrzovat. Web, COP Mobile a Jízda komunikují pouze s COP API; interní SIM a
Valhalla endpointy ani tokeny klientům zpřístupněny nejsou.

## Driver report freshness and support

Default report expiry starts at `observedAt`, not at upload time. Delayed offline
submissions remain in history and do not reappear as fresh incidents. Expiry is
exclusive: an observation is inactive at `validUntil`. Explicit operator expiry
remains supported.

Confirmation summaries optionally include `independentStillThereCount` and
`independentNotThereCount`; both exclude the original author without disclosing
identities. `voteBalance` uses these independent counts. The support score is a
heuristic, not a calibrated probability. Without at least two independent
positive votes and a net balance of two, its maximum is 69/100.

Native nearby feeds send `bbox`, traffic `categories`, active `statuses`,
`includeExpired=false` and `limit=500` to COP before applying the precise radius
filter. Hitting the limit is presented as potentially incomplete. Nearby means
straight-line distance; it is not road-edge or direction matching.
