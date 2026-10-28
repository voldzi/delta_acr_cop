# Observability

The PostgreSQL disconnect candidate observes both pool and physical-client error
events using fixed component/source codes only. Error counts represent events,
not distinct incidents; no SQL, DSN or raw pg errors are logged by the observer.
See [candidate evidence and deployment status](testing/cop-pg-disconnect-20261028.md).

Automatic safety notifications expose `safety-notification-worker` through
`/health/dependencies`. Its state distinguishes disabled/idle/running/degraded
and includes aggregate examined/accepted/skipped/failed counts and bounded
failure codes. It contains no user IDs, area coordinates or notification text.
An accepted count means Messaging intake with targeted devices, not physical
phone delivery. Do not interpret empty or degraded SIM input as a safe area.
See [acceptance and rollback](runbooks/21_COP_CRISIS_NOTIFICATIONS.md).

This is the standard observability entry point for COP. Detailed observability
and audit documentation remains in:

- [Audit and observability](application/08_AUDIT_AND_OBSERVABILITY.md)
- [Audit](security/05_AUDIT.md)
- [Running Main COP](runbooks/04_RUNNING_MAIN_COP.md)
- [Environment configuration](runbooks/03_ENVIRONMENT_CONFIGURATION.md)

Current runtime observability surfaces:

- `/health/live`
- `/health/ready`
- `/health/dependencies`
- `/metrics`
- source health through `/api/v1/sources/health`
- COP stream health through `/api/v1/stream/cop/health`

The main web client also records a bounded, in-memory set of user-experience
metrics. The monitor is loaded after the application shell so telemetry cannot
delay the map. It records LCP, CLS, interaction latency, navigation timing and
long main-thread tasks, retains at most the last 100 samples in
`window.__COP_WEB_PERFORMANCE__`, and emits a `cop:web-performance` browser
event for diagnostics. Collection is fail-open and does not include user input,
map coordinates, report contents, tokens or message data.

Client ratings use these release thresholds:

| Metric                |         Good | Needs improvement |        Poor |
| --------------------- | -----------: | ----------------: | ----------: |
| LCP / navigation      |  up to 2.5 s |         up to 4 s |    over 4 s |
| INP                   | up to 200 ms |      up to 500 ms | over 500 ms |
| CLS                   |   up to 0.10 |        up to 0.25 |   over 0.25 |
| Long main-thread task | up to 100 ms |      up to 250 ms | over 250 ms |

These runtime measurements complement, but do not replace, the compressed
asset budgets enforced by `pnpm check:bundles`.

The performance buffer is local diagnostic evidence, not a national baseline.
An anonymized production aggregate may record only metric name, value, rating,
coarse device class and coarse network class after privacy review. It must not
contain coordinates, URLs with share state, account identifiers or content.
Release reporting must state sample size and collection window before claiming
that a threshold represents Czech users.

Provider-level diagnostics from SIM are consumed server-side and exposed only
as COP source health or operator diagnostics, not as public map layers.
`SourceHealthItem.summary` may include sanitized provider metadata such as
`taxonomyCount`, `taxonomyEntryCount`, cache status and stale-feature counts;
these values are operational diagnostics and must not be interpreted as public
alerts.

SIM search health describes the last entities-index or query response. It is not
a global assertion about every SIM source. Index summaries retain `responseScope`,
`receivedAt`, `pageCount`, `returnedCount`, `pageStaleCount`, `warningCount` and
`warningsKnown`. `providerOldestGeneratedAt`/`providerNewestGeneratedAt` preserve
known feed timestamps; `providerGeneratedAtKnown=false` means at least one page
is unknown. The combined `generatedAt` is omitted in that case and otherwise is
the oldest page timestamp. Receipt time is never substituted for source age.
Feed timestamps also do not prove the observation age of individual entities.

The SIM observability adapter preserves validated `sources`, `cache`, optional
`dataQualityStatus` and `degradedSourceCount`. It is not newly polled by COP.
Reachability `status=ok` alone does not mean fresh or complete data. Missing
quality, warnings or expiry metadata must not become confirmed zero/freshness.
Cache counts are cumulative or scoped as defined by SIM; source counts are not
unique global entity totals. Optional returned-page freshness is separate from
collection summary counts and must be validated before use.

`providerFreshnessTimestampState` distinguishes valid, future, invalid and unknown
feed time metadata. Known deadlines are checked with an actual post-body clock
and again at combined-page consumption. `consumptionExpiry` is labeled
`COP_DERIVED`, with its own `evaluatedAt` and returned-page expired/missing/invalid
counts. The provider's `freshness.evaluatedAt` stays unchanged even if a gateway
returns an older cache response. Missing reference expiry alone is not an outage.

PostgreSQL stream readiness requires the configured persistence path and active
LISTEN connection. A successful publish does not certify an interrupted listener.
Failed provisional listeners are closed by their owner; other store pools and
global database settings are untouched. See [ADR 0047](adr/0047_PROVIDER_PROVENANCE_AND_STREAM_OWNERSHIP.md).

Owned PostgreSQL diagnostics use a bounded weak registry of at most 64 live
records, fixed component labels and `total`, `idle`, `waiting`, `configuredMax`
counts. Invalid/missing counters are null. Counts are per API process, not the
shared database total. The dedicated stream listener is counted separately.
Startup and at most one normal-processing snapshot per minute use the existing
structured logger and its retention. Fixed-code idle and selected store failures
carry counters without raw errors, SQL, connection strings, identities or rows.
Historical error counts do not prove a current outage; closed pools are removed.
Default names are `cop-api:<component>` (listener `cop-api:stream-listener`),
unless existing pg/DSN configuration explicitly supplies another name. There is
no new public diagnostic endpoint, query, connection, retry or pool-limit change.
Lazy map providers that have not received their first viewport request are
reported in `/health/dependencies` as `ok` with an `idle; waiting for first
request` detail. This prevents an unused optional layer from making the PoC
health view look degraded before an operator opens that layer.

Source-health aggregation indexes the current in-memory events and objects by
`sourceSystemId` once per snapshot. Adding more configured providers therefore
does not rescan the full event and track collections for every provider; the
aggregation cost remains linear in sources, events and current objects.

External Nominatim requests are protected by a bounded least-recently-used
cache, identical concurrent-query coalescing and an upstream timeout. Provider
diagnostics expose current/max cache entries and in-flight request count without
including search text or personal location data.

Messaging readiness does not prove that public clients can reach the TURN NAT
mapping or relay port range. Voice-call diagnosis must distinguish signalling
(`invite`, `answer`, `select_answer`) from media establishment and record only
low-cardinality call phase/mode/timeout data; SDP, ICE candidate values and room
keys must not enter COP telemetry.

## OpenTelemetry Status

OpenTelemetry is not currently wired into the COP runtime. The application has
Prometheus-style metrics, Fastify logs, dependency health and provider
observability, but it does not yet emit distributed traces from COP API calls to
SIM, CSM Messaging, PostgreSQL, SeaweedFS or external geocoding.

Target deployment:

- keep `/metrics` for Prometheus/Grafana dashboards,
- add OpenTelemetry traces for server-side request lifecycles,
- propagate W3C `traceparent` headers from COP to internal providers,
- export OTLP traces to the local observability collector,
- do not expose tracing internals to public clients,
- never record tokens, media URLs with signed credentials or personal contact
  data as span attributes.

Recommended implementation phases:

1. Add an optional `COP_OTEL_ENABLED=false` runtime flag plus OTLP endpoint
   configuration.
2. Initialize OpenTelemetry before the Fastify server is imported in
   `apps/cop-api/src/index.ts`.
3. Instrument Fastify request spans, outbound provider fetches, PostgreSQL
   calls and media storage operations.
4. Add low-cardinality custom span attributes: provider id, source layer,
   cache status, HTTP status, dependency name and degraded/ok state.
5. Add deployment documentation for collector, Prometheus, Grafana and Loki.
6. Make tracing fail-open: if the collector is unavailable, COP must continue to
   run without affecting map or reporting functionality.

Detailed rollout guidance is in
[runbooks/12_CHROMADB_AND_OPENTELEMETRY.md](runbooks/12_CHROMADB_AND_OPENTELEMETRY.md).

## Private Dispatch ownership

Structured lease transitions carry component/state/generation with existing
request context where applicable. Raw PostgreSQL errors/DSNs and point data
are not logged. `/health/live` remains process liveness. Enabled Dispatch with
unavailable/recovering/stale ownership makes `/health/ready`503; dependencies
returns200 with degraded status and a private-dispatch item. Capability states
report shared vehicles and Dispatch separately. Record deployment source SHA,
image ID, container start and repeated primary-lock observations separately
from authenticated client and physical two-device acceptance.

Invitation alert diagnostics use aggregate delivery/queue state only. Do not log
notification payloads, account identity, emails, APNs tokens or provider errors.
Record separate intake acceptance, APNs result and physical phone acceptance.
