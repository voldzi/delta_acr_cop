# Operations

The isolated COP code health audit, release gates and deployment boundaries
are recorded in [runbook 20](runbooks/20_COP_CODE_HEALTH.md). Its candidate tests
do not activate AI, public analytics or a production service. Existing X5
preflight, dedicated builder and rollback requirements remain mandatory.

This is the standard operations entry point for COP. Detailed operational
documentation remains in:

- [Runbooks index](runbooks/00_INDEX.md)
- [Local development](runbooks/01_LOCAL_DEVELOPMENT.md)
- [Docker Compose](runbooks/02_DOCKER_COMPOSE.md)
- [Environment configuration](runbooks/03_ENVIRONMENT_CONFIGURATION.md)
- [Running Main COP](runbooks/04_RUNNING_MAIN_COP.md)
- [Running contract tests](runbooks/05_RUNNING_CONTRACT_TESTS.md)
- [DMZ publication](runbooks/07_DMZ_PUBLICATION_COP_ZELEZNALADY.md)
- [Keycloak COP](runbooks/08_KEYCLOAK_COP.md)
- [Postgres/Patroni temporal store](runbooks/09_POSTGRES_PATRONI_TEMPORAL_STORE.md)
- [Tile cache and map tiles](runbooks/10_TILE_CACHE_AND_MAP_TILES.md)
- [COP media S3](runbooks/17_COP_MEDIA_S3.md)
- [COP storage on X5: paths, retention and deployment gates](runbooks/19_COP_X5_STORAGE.md)
- [Automatic crisis notifications and ČT24 context](runbooks/21_COP_CRISIS_NOTIFICATIONS.md)
- [Standalone chat runtime release](runbooks/22_COP_CHAT_RELEASE_20261010.md)
- [API immutable image/runtime profile and scoped rollback](runbooks/24_COP_API_RUNTIME_PROFILE.md)

Local defaults:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`
- Chat: `http://localhost:4314/chat/`

Pilot deployment runs from `/srv/cop` on `docker.home.cz`. Health and
readiness are exposed as `/health/live`, `/health/ready` and
`/health/dependencies`.

## PostgreSQL routing and session operations

`COP_DATABASE_POOL_MODE=direct|session|transaction` declares the main
`COP_DATABASE_URL` path and defaults to `direct`. This is an administrator
assertion; a hostname or port does not establish the runtime broker mode.
Direct/session mode preserves the existing database path and TLS/authentication
rules when optional session URLs are absent. Dispatch keeps its dedicated
`max: 1` lease pool; Safety shares its ledger pool unless explicit
`COP_LEASE_DATABASE_URL` selects a separate `max: 1` lease pool.

Transaction mode requires explicit `COP_LEASE_DATABASE_URL` for the PostgreSQL
Dispatch/Safety factories and explicit `COP_STREAM_BUS_DATABASE_URL` for the
PostgreSQL stream bus (`LISTEN`). Both must provide direct/session affinity.
The main and relevant session URLs must be assessable PostgreSQL URIs with an
explicit host/port/database. The port is mandatory to avoid `PGPORT` and `pg`
default ambiguity. Fragments and query endpoint overrides (`host`, `hostaddr`,
`port`, `database`, `dbname`, `service`, case-insensitive keys) are rejected in
transaction mode. Missing or unassessable URLs, or a session URL with the
same normalized host/port/database endpoint as the main URL, fail before the
factory creates pools, without fallback. Different passwords, SSL query
parameters or `postgres`/`postgresql` aliases do not establish a different
endpoint. URI checks cannot prove DNS alias separation or the broker mode.
See [environment configuration](runbooks/03_ENVIRONMENT_CONFIGURATION.md#režim-postgresql-a-připojení-pro-session-operace).

The agreed additional transaction frontend uses protected Unix IPC, not a TCP
listener or public broker port. Its PostgreSQL URI contains an encoded absolute
socket-directory authority, explicit port (approved deployment `6432`), explicit
database and mandatory
`sslmode=disable`; only optional `application_name` may accompany that query
key. Endpoint overrides, duplicate/case-variant query keys, fragments and
malformed percent escapes and dot-segment paths are rejected. This is a narrowly permitted route, not a reason
to declare a transaction broker as `direct`.

For a Unix main route, the lease and enabled PostgreSQL stream routes must use
explicit TCP PostgreSQL host/port/database with exact `sslmode=verify-full` and
canonical absolute `sslrootcert` path. The approved deployment mounts
`/etc/vcode-cop-pgbouncer/postgres-ca.crt`; the source does not hardcode that path.
Reject endpoint overrides, alternate `ssl`, libpq compatibility and certificate
or key overrides. URI SSL parameters replace the complete inherited
`PoolConfig.ssl` object; preserve the historical global `COP_DATABASE_SSL=false`
and configure verified remote TLS explicitly in each session URI. Infrastructure
owns actual secret values, socket permissions, runtime GID and the read-only
single-file CA mount, and must also prove the broker-to-PostgreSQL TLS path.

For the reviewed configuration with general pool max `5`, explicit lease URL and
memory stream, direct/session mode keeps maxima main `58` plus separate leases
`2`. The repaired transaction candidate moves the five consent connections to
the verified route: main `53`, direct/session `7`. Both total `60` clients across
`15` pools per API process. This is not the number of open
connections or PostgreSQL backends. Broker backend cap `10` and client cap `80`
are configured; the accepted production application now uses transaction mode
and broker boot activation is enabled. The dated broker observation
after completion was five backends, nine frontend clients and zero waiting.
Memory stream creates no listener; PostgreSQL stream adds its pool (default max
`2`) and one independent `LISTEN` client outside pool diagnostics.

Repair application source
`b13fbdc71f3d9821f8b857c3f73255a75c46fa76` is running in the accepted immutable
a06 image in transaction mode. One reviewed build-only operation passed the image
guard, actual Sharp conversion, offline package manager and compiled PostgreSQL
verified-TLS `SELECT 1` with `statement_timeout=15000`. The native DIRECT receipt
and authenticated synchronized protected profile passed. The accepted health
witness records `situation-data-source=degraded` and all other recorded statuses
OK; cached ONLINE/CATALOG snapshots do not establish that feature's freshness
or explain a historical reason. The health gate and baseline were unchanged.
After explicit human authorization, one same-a06 TX wrapper dispatch exited
`1`, leaving a healthy target pending; the specific first native failure cause
is unconfirmed. The infrastructure owner completed that same target through
native recovery at `2026-10-13T16:18:44Z` without Docker `up`, recreation,
another deployment attempt or baseline rebase. The original pending health
baseline, native effective configuration/peer checks and pointer CAS passed;
the pending journal is closed. The accepted active generation is
`7a351c5cb66e45cdbb845a76206fc282`, release
`release-cfc42353256f4f24ab026ffc4d3ed993`, with unchanged target start time
and restart count zero.

Independent read-only verification at `2026-10-13T16:20:17Z` confirmed the exact
TX binding, a06 DIRECT rollback witness, Unix main route, read-only socket/CA,
GID `982` and separate verified-TLS lease URI. The completion helper checked
three selected deployment source pins; the original dispatch's entire
source/environment parity proof was not completed and is not claimed.
The Mac's earlier default route refused COP, while the same HTTP check through
the existing `ppp0` interface returned `200`; no network or authentication
change was made. The owner subsequently confirmed the protected TX profile:
"Profil se načetl a je synchronizovaný". This explicit human confirmation is
the profile PASS; the automatic in-app-browser check failed at the transport
layer and supplies no such evidence.

Infrastructure QGA worker `1754080` then completed one broker boot enablement
with terminal code `0`, PASS, `enableattempts=1` and `confirmed=true`. Service
PID and the accepted API binding remained unchanged; the existing ordering
before Docker was preserved, with zero service restarts and no API/database
mutation. The infrastructure-owned receipt is
`reports/postgresql-pool-audit-20261013/cop-a06-broker-boot-enabled.json`
with root helper SHA256
`a05518e2c0e61bdba69f1c0af824b92b8bf7e74f4395836df051404313199d41`.
Actual cold boot, failover and restoration tests have not been performed.

Earlier 629/b123 DIRECT acceptance and recovery are historical evidence. The
owner's isolated read-only diagnostic on that image confirmed rejection of
startup `statement_timeout=15000` with PostgreSQL `08P01`. The b13 repair retains
all timeouts and SQL and routes consent through the validated separate URL only
when transaction mode is selected; same-a06 TX startup acceptance is recorded
above. No web, normal chat, measurement/authentication flags or other
service changes were included. A later documentation-only revision does not
change the deployed application's b13 source identity.
Exact dated image/profile evidence is in
[runbook 24](runbooks/24_COP_API_RUNTIME_PROFILE.md#production-evidence-on-2026-10-13).
The original legacy image's source remains unproven; its manifest records
`null` rather than inferring source identity from the server checkout.

Any future runtime activation requires separate owner GO and complete
application startup, business and direct/session lease acceptance, plus `LISTEN`
acceptance if that mode is enabled. Preserve the same logical database/identity,
verified TLS, lock SQL/PID checks, business queries, retry/replay and persistent
state. The primary rollback pair is a06 with its accepted DIRECT profile;
accepted 629 DIRECT is the secondary reserve. The legacy pair is only a
separately coordinated last resort. Return through the existing native immutable
`activate` path requires separate exact owner GO and current CAS checks.
Preserve routing flags and use the existing server secret store without copying
secrets into release artifacts. Future releases must preserve the reviewed
immutable deployment operations from `6b123ec` and consent routing from `b13fbdc`,
with fresh exact image/source/profile attestation. This documentation update
does not rebuild or change the deployed application source.

Record targeted route/parser/recovery tests against the exact reviewed source
pin. Synthetic parser tests do not prove TLS, broker affinity or live acceptance.
Infrastructure must approve that pin and give separate build-only authority
before a production build. The published wrapper provides
`bash scripts/deploy-production.sh --build-only cop-api` and an explicit immutable
API deploy-only path, as described in [runbook 24](runbooks/24_COP_API_RUNTIME_PROFILE.md).
Use the infrastructure owner's reviewed build runner and independent terminal
receipt; a foreground CLI exit does not prove BuildKit completion after a
disconnection. `scripts/deploy-production.sh cop-api` is not a build-only command
and must not be used under build-only authority. Runtime deployment needs the
separately agreed release GO and all current production overlays.

SIM live-traffic routing release and rollback checks are documented in
[SIM Live Traffic Routing](integration/19_SIM_LIVE_TRAFFIC_ROUTING.md). Record
the current `/srv/cop` Git revision before every pilot update so the same
Compose deployment can be restored and smoke-tested without changing secrets or
server-owned provider endpoints.

Odstranění produkčního lab přístupu má samostatný
[postup a podmínky přepnutí](runbooks/08_KEYCLOAK_COP.md#bezpecne-odstraneni-lab-pristupu).
Bezpečné výchozí hodnoty frontend buildů nezmění běžící API ani přihlašování
služeb Edge/MCP; konfiguraci přepínejte až po jejich akceptaci.

Before release, `pnpm test:load:stream -- <base-url> <clients> <duration-ms>`
opens bounded concurrent SSE clients and fails when any connection cannot be
established. Browser reconnects use capped exponential jitter; the client queue
drops the oldest item above its fixed limit and records the drop. The API closes
a slow SSE connection when the socket signals backpressure rather than growing
an unbounded application queue. `COP_API_LISTEN_BACKLOG` defaults to `4096` so
an expected SSE reconnect wave is not constrained by the smaller Node default;
the host must still expose a compatible kernel listen queue.

Production voice calls additionally require durable
`COP_VOICE_CALL_STORE=postgres`, `voice-call-media=ok` in dependency health, a
publicly reachable LiveKit WSS/media endpoint, a separately managed
`COP_VOICE_CALL_E2EE_SECRET` of at least 32 characters and confirmed CSM
Messaging PushKit delivery. Rotate this secret only during a coordinated client
cutover because it changes every derived active-call media key. Matrix readiness
is unrelated to the voice media path.

The user-owned AI credential relay is staged behind
`COP_AI_CHAT_BYOK_ENABLED=false`; ordinary chat routing has a separate default-off
`COP_AI_CHAT_BYOK_ROUTING_ENABLED=false`. SIM implements the versioned contract,
but production acceptance of its disabled BYOK path, separate actor secret,
actual project billing and local-model recovery is still required. See
[ADR 0031](adr/0031_USER_FUNDED_AI_CHAT_CREDENTIAL_STAGING.md). Neither flag is
enabled by this change. The credential flag alone does not switch the chat.

The Jízda measurement adapter is staged behind
`COP_DRIVER_MEASUREMENTS_ENABLED=false`. Consent and deletion use separate
PostgreSQL state and a dedicated SIM token. After any activation, keep
`COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED=true` during rollback, so uploads
stop while revocation remains available. Restrict a voluntary pilot with
`COP_DRIVER_MEASUREMENTS_PILOT_ENABLED=true` and a protected comma-separated
`COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS` list of verified OIDC subjects.
Empty or invalid pilot configuration blocks intake, while GET/DELETE and
pending cleanup remain available to every authenticated native account. See the
[mobile handoff](integration/22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md).
Compose passes the measurement settings from the protected production `.env`
to `cop-api`; the intake, cleanup and pilot flags default to `false`. Deploying the API image
alone does not provision the SIM connection, create consent state, or begin
collecting GPS.
For the approved internal pilot link, create the dedicated Docker bridge
`cop_sim_driver_measurements_internal` with `--internal` and deploy the API
using `docker compose -f docker-compose.yml -f docker-compose.driver-measurements.yml up -d --no-deps cop-api`.
Only COP API joins this bridge; SIM must attach only
its situation-data-api under the DNS alias `sim-driver-measurements`. The COP
upstream URL is then
`http://sim-driver-measurements:4020/api/v1/internal/driver-measurements/v1`.
The base Compose file remains usable without this bridge. A rollback of the
network attachment uses the base Compose file while preserving the measurement
cleanup flag and secrets if any consent has already been granted.

The optional strict road-trip integration depends on SIM runtime capability and authoritative reviewed closure data. Publishing the COP/SDK contract does not activate new profiles. Keep SIM strict routing disabled until its engine/source tests and joint Jízda acceptance pass. No measurement flags are changed. See integration/23_JIZDA_ROAD_TRIP_CONTRACT.md.

## Shared mobility deployment

`COP_SHARED_MOBILITY_ENABLED=false` and `COP_PRIVATE_DISPATCH_ENABLED=false` are
explicit opt-in defaults. Default direct/session routing reuses existing
`COP_DATABASE_URL`/TLS settings; an explicit `COP_LEASE_DATABASE_URL` selects the
session lease path described above. Startup creates additive cop_mobility_v1 and
runs30day domain cleanup.
Private Dispatch requires one API instance with a dedicated PostgreSQL session
advisory lease on a dedicated connection. A contender stays unready and retries;
lease loss returns Dispatch503 while shared vehicles remain independent.
The owner verifies its primary-session lock every5seconds (10% jitter), retries
with bounded500ms–10s backoff, and treats verification older than15s as unavailable.
Connection/query timeouts are5s/3s. Recovery invalidates previous share metadata
before ready, clears RAM ciphertext and fences requests from prior generations.
Restart also invalidates existing share metadata and drops all RAM ciphertext. No
client consent or GPS collection is enabled by either infrastructure flag.
Backup existing database before enabling. Rollback restores previous API image and
bothflagsfalse; leave the additive table intact. No migration drops existing COP
state. Existing routing/web analytics and driver collection remain independent.

Community reporting release/rollback and acceptance are recorded in
[integration/31_JIZDA_COMMUNITY_REPORTS.md](integration/31_JIZDA_COMMUNITY_REPORTS.md).
No new configuration or port is required. During durable store outage return503;
restore its connectivity rather than accepting reports into RAM. Police expiry
and absence suppression do not modify SIM closure data.

## Automatic crisis notifications

`COP_SAFETY_NOTIFICATION_WORKER_ENABLED=false` is the opt-in default. The
worker uses the configured primary PostgreSQL profile/notification stores,
current device capability and verified SIM candidates, without a fabricated
user credential. Account consent is independent and remains disabled until
explicitly enabled. Ready per-area cache is short-lived; incomplete/unavailable
inputs and technical failures produce degraded status/backoff, not a public
alert. Health exposes `safety-notification-worker` with aggregate run counts.

New additive delivery/cooldown/device-capability tables retain opaque hashes
and operational timestamps, not notification payloads or raw GPS. No automatic
audit/ledger deletion is introduced. On rollback disable the worker, preserve
consent and deduplication, and restore only affected API/web images through the
standard X5-aware deployment wrapper. Do not change networks, tokens or other
applications. ČT24 stays in its separate informational path.

Candidate implementation, actual deployment and phone delivery are separate
gates. A Messaging intake acceptance is not APNs/Web Push delivery proof;
downstream retry/idempotency must be checked with Messaging. Production and
physical acceptance are pending until recorded in
[runbook 21](runbooks/21_COP_CRISIS_NOTIFICATIONS.md).

## Invitation push delivery

No new flags/secrets/networks. The existing Messaging/APNs integration delivers
registered verified recipients from the durable COP outbox. Both API ticket
allowlists must admit Jízda, and client signing/OS permission must enable ordinary
APNs. Intake acceptance is not phone delivery. See integration/35_MOBILITY_INVITATION_NOTIFICATIONS.md.

Jízda self-profile API release and remaining device acceptance: [handoff](integration/36_COP_SELF_PROFILE.md).

Shared receipt details capability and rollback/downgrade guard: [release handoff](integration/38_SHARED_VEHICLE_RECORD_DETAILS.md).

A rollback from odometer projection to the receipt-only image preserves records but removes snapshot capability; clients must show unknown and never replace it with zero/local/paged-event mileage. Retain receipt-details downgrade protection. See [handoff39](integration/39_SHARED_VEHICLE_ODOMETER_SNAPSHOT.md).

Completed ride mileage v2 requires coordinated capability/version/scope/revision handling. Any rollback must retain detailed-ride omission and trip ID reservation guards; older unguarded images could erase intervals and release dedup identities. See [handoff40](integration/40_SHARED_VEHICLE_COMPLETED_RIDE_MILEAGE.md).

Shared profile/audit/recovery keeps existing retention and no migrations; use guard-only rollback preserving sealed metadata. Delivery and physical acceptance limits: [integration41](integration/41_SHARED_VEHICLE_PROFILE_AUDIT_RECOVERY.md).

Read-only Matrix lookup rollout: Messaging then COP API, preserving exact existing images/configuration. Old images remain a schema-safe rollback; see [integration42](integration/42_VERIFIED_MATRIX_IDENTITIES.md).


Embedding outages are bounded by the total budget in
[configuration runbook 03](runbooks/03_ENVIRONMENT_CONFIGURATION.md).
The chat update and joint cache/authentication evidence are in
[release runbook 22](runbooks/22_COP_CHAT_RELEASE_20261010.md). A healthy
generative gateway does not prove that the configured embedding server or
default Ollama inference is available; verify each separately.
