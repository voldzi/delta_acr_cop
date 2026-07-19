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

Local defaults:

- API: `http://localhost:4310`
- Web: `http://localhost:4311`
- Chat: `http://localhost:4314/chat/`

Pilot deployment runs from `/srv/cop` on `docker.home.cz`. Health and
readiness are exposed as `/health/live`, `/health/ready` and
`/health/dependencies`.

Production voice calls additionally require durable
`COP_VOICE_CALL_STORE=postgres`, `voice-call-media=ok` in dependency health, a
publicly reachable LiveKit WSS/media endpoint and confirmed CSM Messaging
PushKit delivery. Matrix readiness is unrelated to the voice media path.
