# 0048: Explicit database routes for session state

## Status

Accepted for source preparation on 2026-10-13. The production COP broker rollout
remains on hold; this decision does not activate it or change authentication.

## Context

Private Dispatch holds a session advisory lock and verifies ownership with
`pg_backend_pid()`. Safety notification workers also hold a session advisory
lock. PostgreSQL stream listeners own session `LISTEN` state. These operations
must retain their PostgreSQL backend for the required lifetime; routing them
through the ordinary transaction endpoint does not establish that guarantee.

## Decision

- Declare the main route as `COP_DATABASE_POOL_MODE=direct|session|transaction`,
  defaulting to `direct` for compatibility. Mode is never inferred from a host
  or port.
- Use `COP_LEASE_DATABASE_URL` for Dispatch and Safety session leases. Use
  `COP_STREAM_BUS_DATABASE_URL` for the PostgreSQL stream listener and its
  existing publish pool. Memory stream mode creates no database listener.
- Preserve the previous main-route fallback in declared direct/session mode.
  In transaction mode require explicit, separately addressed session routes.
  Missing, unassessable or equivalent endpoint URIs fail before pool creation
  in the affected factory. No lease outage falls back to the business route.
- Compare normalized URI host, explicit port and database; changing credentials,
  TLS query parameters or the PostgreSQL protocol alias does not create a
  separate endpoint. Errors contain fixed text, never URI values or parser
  causes that might expose credentials.
- Preserve lock SQL, backend PID checks, invalidation, release, recovery,
  business queries, TLS/authentication settings and existing retry/replay
  behavior. Do not replay work after losing a lease.

## Consequences and acceptance

Dispatch keeps its existing one-connection lease pool. Safety creates a
separate pool capped at one connection only when a lease URL is explicit;
otherwise it keeps the existing shared pool. Add that connection to the
operator's capacity budget. Both owned pools close, while a shared pool closes
once. No API, tenant authority or persistent schema changes are introduced.

The URI guard cannot prove actual broker pool mode, DNS alias separation,
session affinity, the same logical database/identity or effective TLS. Before
activation the infrastructure owner must verify those facts on the immutable
build, alongside lock ownership, reconnect/HA behavior, client authentication,
dependency health and a scoped rollback. PostgreSQL LISTEN acceptance is
separate when the stream is enabled.

Seventy-one isolated tests cover route separation and normalization, missing
configuration, lease failure without fallback, original Dispatch recovery,
stream lifecycle, Safety invalidation and pool disposal. API TypeScript build,
selected ESLint and skeleton validation pass; independent source review is
closed. These are source checks, not a real broker or production acceptance.

For rollback restore the verified main direct/session route and routing mode
before using an older image that cannot enforce the new separation. Preserve
database state, existing secrets and all production overlays. Never declare
`direct` while leaving the main URL on a transaction endpoint to bypass the
guard. No network, global database or unrelated service changes are part of
this source preparation.

Details: [environment configuration](../runbooks/03_ENVIRONMENT_CONFIGURATION.md#režim-postgresql-a-připojení-pro-session-operace)
and [operations](../operations.md).
