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

For voice-call incidents, check the three independent boundaries in order:

1. `/health/dependencies` reports `voice-call-store=ok` and
   `voice-call-media=ok`.
2. `POST /api/v1/messaging/calls` creates one direct call and CSM Messaging
   accepts the incoming PushKit notification for at least one recipient device.
3. Both clients join the same `cop-call-<callId>` LiveKit room and publish one
   microphone track.

Matrix sync, Matrix E2EE recovery and TURN configuration from Synapse are not
part of the current voice path. Test the configured
`COP_LIVEKIT_PUBLIC_URL` from an external mobile network and verify the LiveKit
WSS plus media ports instead. A terminal call remains visible through
`GET /api/v1/messaging/calls?roomId=...` and should appear as a call event in
both timelines.

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

## Matrix stream consistency after database migration or restore

If E2EE recovery remains on **Ukládám obnovovací údaje…**, first verify that a
new account-data event is visible through an incremental Matrix `/sync`. A full
sync that contains the event while `/sync?since=...` repeatedly returns the same
token identifies a homeserver stream-position problem, not slow cryptography or
a client timeout.

Synapse PostgreSQL migrations and restores must keep every stream sequence at
or above both its associated table maximum and `stream_positions`. Check at
least these mappings:

- `events_stream_seq` → `events` / `events.stream_ordering`
- `presence_stream_sequence` → `presence_stream`
- `receipts_sequence` → `receipts_linearized`
- `account_data_sequence` → `account_data`, `room_account_data`,
  `room_tags_revisions`
- `push_rules_stream_sequence` → `push_rules_stream`
- `device_inbox_sequence` → `device_inbox`, `device_federation_outbox`
- `device_lists_sequence` → all `device_lists_*` streams and
  `user_signature_stream`

For a repair, stop all Synapse writers, save an audit snapshot of sequences and
`stream_positions`, and advance each affected PostgreSQL sequence to the
greatest of its current value, associated table maxima, and the matching live
stream position. Never move a sequence backwards and do not delete
`stream_positions` as a permanent workaround. Restart Synapse, then prove the
repair with a harmless account-data canary: the next incremental `/sync` must
advance `account_data_key` and return that canary. Only then retry E2EE recovery
and verify that `m.secret_storage.default_key`, cross-signing secrets, and one
active key-backup version were created. Do not log access tokens, recovery keys,
secret-storage content, or room keys during diagnosis.
