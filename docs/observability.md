# Observability

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

Provider-level diagnostics from SIM are consumed server-side and exposed only
as COP source health or operator diagnostics, not as public map layers.
Lazy map providers that have not received their first viewport request are
reported in `/health/dependencies` as `ok` with an `idle; waiting for first
request` detail. This prevents an unused optional layer from making the PoC
health view look degraded before an operator opens that layer.

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
