# 31. Jízda community reports and police patrols

## Ownership and contract

COP owns reports, authenticated authors, durable UUID idempotency, one current
confirmation per account/report, author corrections/withdrawal, expiry and the
server feed decision. Jízda and COP web render that decision. Manual consent to
publish this one observation does not enable speed measurements or private
Dispatch location sharing. No actual user report is created for release tests.

Use existing COP routes: POST reports (X-Idempotency-Key UUID), POST
reports/{reportId}/submit, GET reports, PUT reports/{reportId}/confirmation
(`still_there` or `not_there`), PATCH reports/{reportId}, POST resolve/withdraw.
The binding source is `openapi/openapi.json`.

New category is exactly `police_patrol`, with advisory severity and a 30-minute
server default validity from the original `observedAt`. Offline upload/retry must
retain that timestamp and UUID, and cannot renew an expired observation. COP web
has a police icon and creation category. Public SDK has
`CSMDriverReportCategory.policePatrol`; internal mapping is exhaustive and never
falls back silently to hazard. The nearby category query includes police.

`presence` is an additive response/GeoJSON object:

```json
{"policyVersion":"cop-report-presence-v1","active":false,"reason":"independent_absence"}
```

Reasons are `active`, `expired`, `lifecycle` and `independent_absence`. Only
submitted/published, non-expired observations may appear on the active map.
For police, congestion, accident, stopped vehicle, road blockage, dangerous
weather and hazard, three independent `not_there` accounts with a negative
balance of at least two suppress the observation from default items and map.
Author votes never count as independent. Vote replacement can restore an
observation within its original validity; no confirmation extends expiry.
Corrections invalidate votes older than the report's updated timestamp; they
remain stored as history but do not support the revised observation. An explicit
`includeExpired=true` history query retains suppressed rows with their decision.
These rules are a transparent initial heuristic, not verified account independence
or resistance to coordinated fabricated accounts. Fire/flood and other enduring
incidents require author lifecycle/moderation or expiry, not this traffic heuristic.

Authenticated mutations are rate limited per IP+actor: create20/minute,
submit30/minute and confirmation60/minute; existing global IP limit also applies.
Repeated confirmations replace a vote rather than multiply it. Existing same-road,
same-category/time clusters group presentation only after server-confirmed
matching; originals and independent votes remain separate. No approximate-radius
cluster or phone vote count becomes a routing fact.

Configured durable community storage failure now fails closed: report routes
return503 `COMMUNITY_REPORT_STORE_UNAVAILABLE`, preserving the COP correlation
error envelope. They do not acknowledge a mutation in process-local memory.
Memory storage remains available only when no durable store is configured (tests).

## SIM boundary and optional public SDK binding

SIM is not changed by this release. Existing asynchronous enrichment may return
`roadEnrichment` with state matched, graph `routingDataset`, `directedEdgeId`,
`enrichedAt` and clusterId. Missing/ambiguous/unavailable data is not an identified
road or direction. Police is an observation, never a closure or automatic route
penalty. Incident fusion maps it to community, not traffic obstruction.

`CSMNearbyDriverReport.roadBinding` is optional and populated only from complete
matched enrichment. It exposes dataset, directed edge ID and enrichment time.
It does not assert the report is on the current route: Jízda must compare the graph
version and directed route edge before future route-specific warnings. No route
geometry association or automatic reroute is introduced here.

## Acceptance

Release revision/image and actual checks are recorded below after deployment.
Synthetic tests cover exact police creation/query/idempotency/offline expiry,
unique author/external votes, suppression, correction, authoritative geometry
clustering, durable failure503, SDK exhaustive categories and projection.
Physical iPhone and real user OIDC/web confirmation remain joint acceptance.
No live user report, consent, vehicle location or new routing closure is created.
