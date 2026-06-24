# 12 ChromaDB and OpenTelemetry

## ChromaDB Retrieval Scope

COP can use the shared local ChromaDB tooling without limiting other
applications such as APSYD. The safe rule is to keep each application indexed
under its own repository root and repository name.

COP has a repository-local Chroma configuration in `.chroma-dev.yaml`. It keeps
the collection name stable as `delta_acr_cop` and expands the default include
set to cover files that are important for fast engineering work:

- API and web implementation under `apps/`,
- root and app `package.json` / `tsconfig*.json`,
- contract tests under `tests/`,
- JSON schemas under `docs/api/schemas/`,
- OpenAPI / AsyncAPI contracts,
- deployment and validation scripts,
- Keycloak theme files under `infra/`,
- `mise.toml`.

Generated output, temporary folders, local Chroma state, build artefacts and
binary media are intentionally excluded. Indexing every file indiscriminately
would make retrieval slower and less relevant; the target is complete coverage
of useful text artefacts, not screenshots, PDFs, videos or build output.

Recommended COP commands:

```bash
cd "/Users/voldzi/Documents/Development/18 2026/DELTA_ACR/01 COP"
"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" \
  reindex \
  --root . \
  --repo-name delta_acr_cop

"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" \
  search-all \
  --root . \
  "COP observability OpenTelemetry" \
  --limit 5
```

Do not change global Chroma chunking, retention or collection cleanup rules for
COP unless the change is namespaced or confirmed safe for all application
repositories.

Before running a forced COP reindex, check that a global rebuild is not already
running:

```bash
ps aux | grep -E '[c]hroma-rebuild-indexes.sh|[c]hroma_dev.cli reindex'
```

If another large repository is being rebuilt, wait. Running COP reindex in
parallel with a global rebuild can leave searches temporarily empty or fail with
Chroma metadata segment errors. Once idle, run:

```bash
"/Users/voldzi/Documents/Development/18 2026/chromadb/tools/chroma-dev.sh" \
  reindex \
  --root . \
  --force
```

Expected verification after a clean reindex:

- about `332` indexed text files,
- about `3135` chunks,
- `search-all "incident fusion suggestions" --root . --limit 5` returns
  incident/fusion documentation,
- `search-code "MessagingPanel conversation groups" --root . --limit 5`
  returns `apps/cop-web/src/messaging/MessagingPanel.tsx`.

Daily workflow:

1. Use Chroma search first for code and documentation lookup.
2. Use `get_file_context` or direct file reads only after selecting likely
   relevant hits.
3. Use `rg` for exact symbol/string checks and final confirmation.
4. Run a forced reindex after broad file moves, new documentation areas, API
   contract restructuring or generated skeleton changes.

## Current OpenTelemetry State

COP currently exposes:

- `/health/live`
- `/health/ready`
- `/health/dependencies`
- `/metrics`
- `/api/v1/sources/health`
- `/api/v1/stream/cop/health`

This is enough for basic monitoring, but not enough for cross-service incident
diagnostics. There is no active OpenTelemetry runtime instrumentation in COP at
this point.

## Target Topology

```mermaid
flowchart LR
  "COP API" -->|"OTLP traces"| "OpenTelemetry Collector"
  "COP API" -->|"/metrics"| "Prometheus"
  "COP API" -->|"structured logs"| "Loki"
  "OpenTelemetry Collector" --> "Tempo or Jaeger"
  "Prometheus" --> "Grafana"
  "Loki" --> "Grafana"
  "Tempo or Jaeger" --> "Grafana"
```

## COP Runtime Configuration

Planned environment variables:

```bash
COP_OTEL_ENABLED=false
OTEL_SERVICE_NAME=cop-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.home.cz:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector.home.cz:4318/v1/traces
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=pilot,service.namespace=csm
```

The feature must fail open. If the collector is down or misconfigured, COP must
continue to serve API, map data, chat bootstrap and community reports.

## Span Policy

Allowed attributes:

- route pattern,
- HTTP method and status,
- provider id,
- source id,
- layer id,
- cache hit/miss/stale,
- dependency name,
- duration,
- degraded/ok state.

Forbidden attributes:

- bearer tokens,
- signed media URLs,
- raw request bodies,
- user contact details,
- full chat content,
- precise private user location unless explicitly needed and approved.

## Implementation Checklist

1. Add OpenTelemetry dependencies to the API package.
2. Create `apps/cop-api/src/telemetry.ts`.
3. Initialize telemetry before importing the Fastify server in
   `apps/cop-api/src/index.ts`.
4. Propagate W3C trace context to server-side provider requests.
5. Add custom spans around SIM, CSM Messaging, PostgreSQL, SeaweedFS and
   geocoder calls.
6. Update `.env.example`, `docker-compose.yml` and DMZ/internal runbooks.
7. Add a readiness check that reports tracing as diagnostic only, never as a
   service-blocking dependency.
8. Validate that no secret or personal data appears in exported spans.

## Deployment Verification

```bash
curl -fsS http://docker.home.cz:4310/health/ready
curl -fsS http://docker.home.cz:4310/metrics | head
```

After OpenTelemetry is enabled:

```bash
curl -fsS http://otel-collector.home.cz:4318/ || true
journalctl -u otel-collector --since "10 minutes ago"
```

Then issue one COP API request and verify a trace containing:

- inbound COP API span,
- outbound provider span,
- response status,
- correlation or request id.
