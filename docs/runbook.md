# Runbook

This is the standard runbook entry point for COP. Detailed operational
procedures remain in the established runbook set:

- [Runbooks index](runbooks/00_INDEX.md)
- [Local development](runbooks/01_LOCAL_DEVELOPMENT.md)
- [Docker Compose](runbooks/02_DOCKER_COMPOSE.md)
- [Environment configuration](runbooks/03_ENVIRONMENT_CONFIGURATION.md)
- [Running Main COP](runbooks/04_RUNNING_MAIN_COP.md)
- [Running contract tests](runbooks/05_RUNNING_CONTRACT_TESTS.md)
- [Demo runbook](runbooks/06_DEMO_RUNBOOK.md)
- [DMZ publication](runbooks/07_DMZ_PUBLICATION_COP_ZELEZNALADY.md)
- [Keycloak COP](runbooks/08_KEYCLOAK_COP.md)
- [Postgres/Patroni temporal store](runbooks/09_POSTGRES_PATRONI_TEMPORAL_STORE.md)
- [Tile cache and map tiles](runbooks/10_TILE_CACHE_AND_MAP_TILES.md)
- [User identity reconciliation](runbooks/11_USER_IDENTITY_RECONCILIATION.md)

Common checks:

```bash
pnpm check
curl -fsS http://localhost:4310/health/ready
curl -fsS http://localhost:4310/health/dependencies
```

For voice-call incidents, Matrix and CSM readiness is not sufficient: it only
proves that TURN configuration can be fetched and may probe it from inside the
deployment network. Test `turn.zeleznalady.cz:3478` from outside the LAN over
both UDP and TCP, verify the Coturn relay range is forwarded, and confirm that a
real browser offer contains a `relay` candidate. Repeated `m.call.negotiate`
events with only `host` candidates identify an ICE/TURN path failure after
successful Matrix signalling.
