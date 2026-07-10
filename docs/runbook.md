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

For repeated undecryptable placeholders, `Cannot ensure Olm sessions: shutting
down`, or duplicate one-time-key uploads, first distinguish an old encrypted
history gap from a broken current device identity. If the current server device
key does not verify the signatures on that device's one-time/fallback keys:

1. Close every other COP Chat tab/window in the affected browser profile.
2. Reopen COP, open the E2EE warning dialog and choose **Opravit pouze toto
   webové zařízení**.
3. Enter the existing recovery key only if automatic key-backup restore is not
   ready.
4. Verify a fresh message decrypts in both directions and the replacement
   device uploads keys with signatures valid for its current device key.
5. Revoke the superseded server device through a supported Matrix device API
   only after the replacement is verified. Never delete one-time keys directly
   in Synapse SQL and do not reset account-wide E2EE merely to repair one
   browser.
