# Operations

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
