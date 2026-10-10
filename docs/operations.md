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

Local defaults:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`
- Chat: `http://localhost:4314/chat/`

Pilot deployment runs from `/srv/cop` on `docker.home.cz`. Health and
readiness are exposed as `/health/live`, `/health/ready` and
`/health/dependencies`.

SIM live-traffic routing release and rollback checks are documented in
[SIM Live Traffic Routing](integration/19_SIM_LIVE_TRAFFIC_ROUTING.md). Record
the current `/srv/cop` Git revision before every pilot update so the same
Compose deployment can be restored and smoke-tested without changing secrets or
server-owned provider endpoints.

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
stop while revocation remains available. See the
[mobile handoff](integration/22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md).
Compose passes the measurement settings from the protected production `.env`
to `cop-api`; both feature flags default to `false`. Deploying the API image
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
explicit opt-in defaults. Reuse existing COP_DATABASE_URL/TLS settings; no new
secret. Startup creates additive cop_mobility_v1 and runs30day domain cleanup.
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
