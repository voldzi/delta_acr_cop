# COP PostgreSQL disconnect candidate — 2026-10-28

Status: source candidate, **not deployed**. Based directly on deployed source
`07664a77cf19e9433bd6fe4b1267e395616f1985`, not the routing/WAF candidates.
No API, schema, credentials, database roles, guard policy, TTL, session routing,
lease timings or retry-of-write changes.

## Bounded production evidence

Read-only inspection of the existing 10:05:45–10:06:30 UTC log window and
container metadata found RestartCount 355, same API image
`sha256:c06c6080c87c4f88a74be359d459143ac25aef55cf60e6a8e11e4555bb62affa`,
StartedAt 10:06:21.669372750Z. Current OOMKilled=false; this is not an exported
historical OOM event record.

- First failure: unhandled `Client` error, connection terminated unexpectedly.
  Stack locations are pg 8.23.1 client/connection internals. The exact owning
  store is **not proved** by the available sanitized stack; do not attribute it
  to the safety guard merely because it is frequently queried.
- Next startup: structured level-50 DatabaseError, SQLSTATE `08P01` at
  10:06:20.578Z, pool query → mobility-store init → mobility routes.
  Startup did not falsely report a ready server. This is a separate startup
  failure while database transport was recovering, not a second proved
  unhandled-Client event.
- pg-pool 3.14.0 removes its idle error listener during checkout. A pool-level
  error handler alone cannot protect a client held between awaited queries.

No raw SQL, request data, row values, DSNs, credentials or raw error messages
were exported from production for this review. WAF 403 is a separate incident.

## Source changes

- `createCopPgPool` installs one persistent error observer per physical client
  on the pool connect event. It records only allowlisted codes and fixed
  component/source metadata. Query failures still reject; no replay or fallback.
- The two database-v2 continuity pools and two media settlement pools use this
  factory with exactly their existing limits, verified CA and application names.
- Stream LISTEN already had error/end handling, but no automatic resubscription.
  After a successful initial startup it now uses one unref recovery timer,
  500ms–10s exponential backoff with bounded jitter and the existing single-flight
  initialization. Failed initial startup still fails. Existing client-identity
  checks exclude stale notifications; unconfirmed listener closure still blocks
  a replacement. Close cancels recovery. No event/transaction replay is added.
- Pool diagnostic errorCount counts error events, not distinct incidents: one
  idle physical error can be observed at both client and pool levels. The sink
  includes `source=client|pool`; no raw diagnostic fields are retained.

## Verification

- Node 24.22.1 API TypeScript build: PASS.
- Vitest: 76 passed, 7 skipped, six passed files and one skipped media settlement
  PostgreSQL file (its separate fixture was not supplied). These cover pool
  diagnostics, configuration/TLS routing, stream lifecycle, lease and transports.
- Skeleton validation, scoped ESLint and whitespace/diff checks: PASS.
- New actual-PostgreSQL test: seven scenarios, eight TAP tests including parent,
  all passed, zero skipped. PostgreSQL 16.15 / pg 8.23.1 / Node 24.22.1.
  This proves actual factory/constructor behavior, not full production HTTP or
  the production PostgreSQL major version / PgBouncer topology.

The new fixture is two locally created containers with `--network none`, no TCP
listener, production mount or production secret. Database data is tmpfs. The
only shared named volume carries their Unix socket. A synthetic non-superuser
runtime role, two test DBs and the checked-in safety migration are used only
inside this disposable instance.

Scenarios: idle disconnect/new connection; checked-out connection lost between
queries; active query killed; committed write with acknowledgement deliberately
withheld by pausing its socket then disconnecting (one stored row, rejected
COMMIT, no replay); actual mobility transaction rollback/recovery; actual
database-v2 continuity rejection/recovery and continued rejection of a mismatched
dataset binding; real LISTEN termination → exactly one replacement → one new
notification delivered → close leaves no listener.

The fixture containers and exact socket volume were stopped/removed successfully;
subsequent name-filtered inventories were empty. No prune was used. Earlier
fixture setup failures and one test lifecycle error were corrected before the
final pass; no failed run is counted as acceptance.

## Repeat the isolated test

Build the API with Node 24 first. Create fresh disposable PostgreSQL with cluster
name `cop_pg_disconnect_owned`, database `cop_disconnect_test`, role
`cop_disconnect_runtime` (LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE), and grant
USAGE/CREATE only on its public schema. PostgreSQL must have `listen_addresses=''`
and a private Unix socket mounted at `/var/run/postgresql`. Run
`scripts/tests/cop-pg-disconnect.postgres.mjs` using Node 24 in a second
network-none container with the repository read-only and the same socket volume;
set `COP_DISCONNECT_OWNED_FIXTURE=network-none-unix-v1`. The test validates the
cluster name before mutation. Remove both exact containers and their socket
volume, and verify their absence. Never point this test at an existing DB.

## One eventual rollout

No production build or rollout was performed. After coordinated release approval:
build one API-only candidate from this exact narrow branch, record its immutable
image digest and source diff against the deployed base, preserve the current
runtime profile, networks, mounts, secrets and environment. No SQL migration.
Check fresh continuity readiness and completed infrastructure release window,
then use the existing protected COP API deployment operation once. Verify
readiness/dependencies, stream delivery and stable restart count. Do not restart
production PostgreSQL solely to reproduce the test.

Rollback is the existing approved API image/profile transition to the retained
current image above, after checking continuity/config compatibility; no dataset
restore, safety checkpoint rollback or blind COMMIT retry. Any strict image/profile
gate remains enforced. This document does not authorize bypassing that gate.
