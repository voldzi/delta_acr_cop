# ADR 0047: Provider provenance and stream connection ownership

Date: 2026-10-12. Status: accepted for source; production acceptance is separate.

## Context

The staged service-account API was rolled back after two unchanged dependency
checks failed. Original failed-response metadata was not retained. Later healthy
samples cannot establish a historical cause. No database limits, other
applications, firewall or authentication grants are changed by this decision.

Focused tests exposed two independent defects: the SIM search request timer
was cleared after headers, before JSON body completion, and a stream listener
connected before a failing LISTEN could escape owned cleanup. Publication could
then report readiness without a working listener. These mechanisms are confirmed
by isolated tests, not attributed to the historical rollout failure.

## Decision

- Bound the entire existing SIM search exchange, including body reading, without
  increasing its timeout or adding retries. Reject redirects and oversized bodies.
  Transport errors expose fixed reason codes, never provider text or request URLs.
- Preserve actual SIM observability fields with typed, validated counters. Service
  reachability, optional data quality and returned-page freshness are separate.
  Missing information stays unknown. Observability is not newly polled by COP.
- Preserve provider feed timestamps while combining index pages. Keep receipt
  time separate, retain oldest/newest known feed times, and mark whether every
  page supplied a valid timestamp. Feed generation time is not measurement time.
  Collection-level counts must not be treated as unique or page-level counts.
- Retain the existing dependency comparator and source health transitions. A
  warning or stale response still degrades the relevant dependency; these fixes
  must not hide a provider failure. A last-request health value has that request's
  scope and does not prove global provider coverage.
- Close only owned provisional stream clients on failed initialization. Report
  readiness only when required persistence and listener work. A successful write
  cannot restore a failed listener or certify cross-instance delivery.
- Register existing PostgreSQL pools by fixed component labels in bounded weak
  references. Reading total/idle/waiting counters creates no connection and runs
  no query. Unknown counters remain null. Default technical application names
  support attribution, while explicit operator/DSN names retain pg precedence.
  Pool limits, TLS, connection strings and transactions are unchanged.
- Handle idle-client error events in every owned pool, including four previously
  unguarded constructors. Query failures still reject; error counts are historical
  diagnostics and do not establish current health. Existing structured logs may
  receive fixed-code failure metadata and at most one normal-processing snapshot
  per minute, plus startup. There is no new endpoint or retention store.
- Keep diagnostic aggregates in the existing bounded request/source state. No new
  durable diagnostic database, raw queries, coordinates, IDs, content or tokens.

## Acceptance

Regression fixtures must exercise delayed bodies, invalid/missing timestamps and
quality, mixed pages, LISTEN failure, publication after listener failure and
initialization/close races. Production must then pass the unchanged dependency
gate and bounded normal operation before renewing Edge/MCP clients are enabled.
Lab authentication is disabled last, after restricted grants, renewal across two
token lifetimes, isolated outage denial and retained web/native access are proven.
