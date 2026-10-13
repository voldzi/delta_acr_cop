# 0048: Explicit database routes for session state

## Status

Accepted on 2026-10-13. Repair source `b13fbdc7` is running in the owner-accepted
a06 production image in DIRECT mode. Its reviewed build-only operation and
actual DIRECT deployment passed; the authenticated protected profile was
synchronized. Same-image repaired TX preflight passed, but the attempt was not
dispatched: explicit human authorization remains pending after automatic
approval review rejected the proposed process twice following the earlier
startup failure. Transaction activation and broker boot activation remain on
hold; there is no pending TX operation. The earlier 629/b123 DIRECT acceptance
and recovery are historical evidence, not the current image. This decision does
not change authentication or measurement flags. The original legacy image's
source remains unproven. Dated current and historical evidence is recorded in
[runbook 24](../runbooks/24_COP_API_RUNTIME_PROFILE.md#production-evidence-on-2026-10-13).

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
- In transaction mode, use the validated `COP_LEASE_DATABASE_URL` for the
  complete measurement consent store. Its PostgreSQL startup parameter
  `statement_timeout=15000` is rejected by the configured transaction broker.
  Keep all SQL, pool max `5`, connection timeout `5000 ms`, statement timeout
  `15000 ms` and query timeout `20000 ms`. In direct/session mode consent keeps
  the exact original main URL even when a lease override exists. Preserve
  lazy injected-store selection and the intake-or-cleanup activation guard.
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

With the reviewed factory configuration, general pool max `5`, explicit lease
URL and memory stream, direct/session mode retains main client maxima `58`
and separate leases `2`. The transaction candidate moves the five consent
connections to the verified route: main `53`, separately addressed direct/session
`7`. Both configurations total `60` clients across `15` pools per API process.
These are client limits, not open connections or broker backend counts. The
configured broker has backend cap `10` and client cap `80`, but the accepted
application is using DIRECT and repaired-image transaction startup has not been
executed or accepted. PostgreSQL stream mode would add its publish pool
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

The infrastructure owner's isolated production-image diagnostic on
2026-10-13 at `14:04:39.570529Z` used image `6299846`, source `b1230d7` and
installed `pg 8.23.1`: read-only `SELECT 1` passed without the startup parameter,
but the sole addition of `statement_timeout=15000` produced PostgreSQL `08P01`
and the query did not run. Both clients closed; the owned diagnostic container
was removed; no configuration or application data were written. This confirms
the historical startup incompatibility. That diagnostic alone did not establish
repair acceptance. The repair was later built and accepted in a06 DIRECT, but
no repaired-image TX deployment has occurred. No startup parameter is ignored
or removed.

Local verification of the consent route repair: `108` targeted tests pass;
one optional real-PostgreSQL consent test is skipped because no isolated test
database is configured. The dependency/API TypeScript build, selected ESLint,
skeleton validation and diff checks pass. Independent source review found no
actionable defect. These tests retain the original consent API/cleanup behavior
and exercise invalid routing before pool creation, unchanged timeouts, startup
failure without fallback and fixed errors without private URI values. They do
not by themselves prove a live TLS handshake or repaired-image production startup.

Separate production-image evidence for a06/source b13 establishes one reviewed
build-only operation with runtime guard, actual Sharp conversion, offline
package manager, compiled PostgreSQL client and verified-TLS read-only
`SELECT 1` with `statement_timeout=15000` passing. The actual native DIRECT
deployment and protected-profile check passed. Its accepted health witness
records `situation-data-source=degraded` and all other recorded statuses OK;
cached ONLINE/CATALOG values do not establish feature freshness or a historical
reason. The original gate and baseline were unchanged. a06 DIRECT is the
primary rollback pair; accepted 629 DIRECT is the secondary reserve. Complete
TX application startup, acceptance and an exact authorized rollback remain
separate owner operations.

Local verification on 2026-10-13 with Node `24.21.0`, installed `pg 8.23.1`
and `pg-connection-string 2.14.1`: `112` targeted tests pass. Two optional
real-PostgreSQL mobility tests are skipped because no isolated test database
was configured. API TypeScript build, selected ESLint, skeleton and diff checks
pass. The malformed-query regression demonstrates that the installed parser can
reinterpret a Unix authority as TCP; the guard rejects that URI before pool
construction. No real broker/TLS handshake, failover or production cutover is
claimed by these checks.

For every future production build, the infrastructure owner must review the
exact source pin and grant a separate build-only GO. The service form
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
