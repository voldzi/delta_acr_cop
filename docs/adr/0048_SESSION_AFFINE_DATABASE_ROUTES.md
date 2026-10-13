# 0048: Explicit database routes for session state

## Status

Accepted for source preparation on 2026-10-13. The production COP broker rollout
remains on hold; this decision does not activate it or change authentication.
The candidate is limited to actual runtime source `3a010127` plus the session
route changes. It excludes `f84fe6f`, measurement changes, authentication changes
and Messaging changes. Production remains unchanged.

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
- Permit one additional transaction route: an encoded absolute Unix socket
  directory in the PostgreSQL URI authority, explicit port (approved deployment
  port `6432`), explicit
  database, mandatory `sslmode=disable` and optional `application_name`. No
  other query keys, endpoint overrides, duplicate or case-variant keys,
  fragments, malformed percent escapes or dot-segment paths are permitted. Raw socket/service DSNs are
  not an alternative to this contract. The socket directory is protected local
  IPC; there is no TCP frontend or public broker port.
- When that Unix main route is selected, the separate lease route and any
  enabled PostgreSQL stream route must be TCP PostgreSQL URIs with explicit
  host, port and database, exact `sslmode=verify-full` and canonical absolute
  `sslrootcert` path. The approved deployment uses
  `/etc/vcode-cop-pgbouncer/postgres-ca.crt`; the source does not hardcode that
  path. Reject endpoint
  overrides, duplicate/case-variant keys, alternate `ssl`, libpq compatibility,
  certificate/key overrides and noncanonical paths. These remote routes retain
  verified TLS; the historical global `COP_DATABASE_SSL=false` is unchanged.
- Account for the installed `pg` behavior: SSL URI parameters replace the
  entire inherited `PoolConfig.ssl` object. The Unix URI disables SSL only for
  local IPC; the TCP session URIs explicitly configure certificate-verified
  TLS and the CA. Infrastructure owns the real secrets, socket permissions,
  runtime GID and a read-only mount of the single CA file, and must separately
  verify the broker's PostgreSQL backend TLS.
- Preserve lock SQL, backend PID checks, invalidation, release, recovery,
  business queries, TLS/authentication settings and existing retry/replay
  behavior. Do not replay work after losing a lease.

## Consequences and acceptance

Dispatch keeps its existing one-connection lease pool. Safety creates a
separate pool capped at one connection only when a lease URL is explicit;
otherwise it keeps the existing shared pool. Add that connection to the
operator's capacity budget. Both owned pools close, while a shared pool closes
once. No API, tenant authority or persistent schema changes are introduced.

With the known active factory configuration, general pool max `5`, explicit
lease URL and memory stream, the main client pool maxima total `58`; Dispatch
and Safety leases add `1` each: `60` clients across `15` pools per API process.
These are client limits, not open connections or broker backend counts. The
infrastructure proposal is broker backend cap `10` and client cap `80`; neither
is claimed deployed here. PostgreSQL stream mode would add its publish pool
(default max `2`) and one independent `LISTEN` client outside the pool registry.

The URI guard cannot prove actual broker pool mode, DNS alias separation,
session affinity, the same logical database/identity or effective TLS. Before
activation the infrastructure owner must verify those facts on the immutable
build, alongside lock ownership, reconnect/HA behavior, client authentication,
dependency health and a scoped rollback. PostgreSQL LISTEN acceptance is
separate when the stream is enabled.

Targeted route/parser/recovery tests cover route separation and normalization,
missing configuration, lease failure without fallback, original Dispatch
recovery, stream lifecycle, Safety invalidation and pool disposal. Record their
result, the API TypeScript build, selected ESLint, skeleton validation and source
review against the exact candidate pin. Synthetic URI/parser checks are not
actual TLS, broker or production acceptance.

Local verification on 2026-10-13 with Node `24.21.0`, installed `pg 8.23.1`
and `pg-connection-string 2.14.1`: `112` targeted tests pass. Two optional
real-PostgreSQL mobility tests are skipped because no isolated test database
was configured. API TypeScript build, selected ESLint, skeleton and diff checks
pass. The malformed-query regression demonstrates that the installed parser can
reinterpret a Unix authority as TCP; the guard rejects that URI before pool
construction. No real broker/TLS handshake, failover or production cutover is
claimed by these checks.

The infrastructure owner must review the exact source pin and grant a separate
build-only GO before any production build. The service form
`scripts/deploy-production.sh cop-api` performs build and service update; it is
not a build-only command. [ADR 0049](0049_API_IMAGE_RUNTIME_PROFILE_BINDINGS.md)
adds an explicit reviewed `--build-only` preparation and immutable deploy-only
path. Runtime activation still requires its own coordinated GO.

For rollback restore the verified main direct/session route and routing mode
before using an older image that cannot enforce the new separation. Preserve
database state, existing secrets and all production overlays. Never declare
`direct` while leaving the main URL on a transaction endpoint to bypass the
guard. No network, global database or unrelated service changes are part of
this source preparation.

Details: [environment configuration](../runbooks/03_ENVIRONMENT_CONFIGURATION.md#režim-postgresql-a-připojení-pro-session-operace)
and [operations](../operations.md).
