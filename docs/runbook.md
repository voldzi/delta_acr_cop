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
- [COP media S3](runbooks/17_COP_MEDIA_S3.md)
- [COP storage on X5: verification and scoped rollback](runbooks/19_COP_X5_STORAGE.md)
- [Automatic crisis notifications: consent, source readiness, release and rollback](runbooks/21_COP_CRISIS_NOTIFICATIONS.md)
- [Standalone chat release and SIM acceptance](runbooks/22_COP_CHAT_RELEASE_20261010.md)
- [API immutable image/runtime profile deployment and recovery](runbooks/24_COP_API_RUNTIME_PROFILE.md)

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

For the staged user-owned AI credential flow, verify authenticated status,
register, rotate and removal against SIM before enabling
`COP_AI_CHAT_BYOK_ENABLED`. Inspect only configured state and opaque user IDs;
never print keys or request bodies. Test two users to prove isolation. Leave
ordinary chat routing unchanged until the separate routing and data-class
acceptance tests in [ADR 0031](adr/0031_USER_FUNDED_AI_CHAT_CREDENTIAL_STAGING.md)
pass in production.

For strict trip errors 422/429/503/502, preserve the trip and show the unavailable requirement; never retry as an unrestricted car/Apple route. Check SIM capabilities, graph version/freshness, closure revision/validity, all variant assessments, then repeat only the same requirements. Rollback restores the prior COP image/SDK pin; keep new strict profiles inactive. Existing internal network overlays must survive service recreation.

Shared vehicle/Dispatch release and remaining authenticated/device acceptance:
[integration handoff29](integration/29_JIZDA_SHARED_VEHICLES_DISPATCH_HANDOFF.md).
To disable on incident restore prior image/feature flags; never forward GPS to SIM,
replay location history or restore consent from previous share metadata.

## Dispatch lease recovery

Check `/health/ready` and the private-dispatch entry in `/health/dependencies`,
then verify the exclusive primary PostgreSQL advisory lock(731031,1) using a
read-only connection. One ready instance owns one session lock; a contender
remains unready. Dedicated connection application_name is
`cop-private-dispatch-lease`. Recovery retries automatically after DB connectivity
returns; investigate primary access, timeouts and sanitized lease-state logs if
unavailable persists. Do not restart repeatedly or manually reactivate shares.
Every acquisition stops previous share metadata and drops RAM points before
readiness. Restored health never authorizes GPS: users must start sharing again.
Rollback uses the captured previous API image with unchanged environment and
network attachments. See integration/34_COP_DISPATCH_RECOVERY_RELEASE.md.

## Invitation notification incident

Check durable outbox state/attempt counts, Messaging APNs configuration and device
registration/permissions without exposing email or tokens. Never create real
user invitations or publish GPS for diagnosis. Preserve queued records through
rollback; recipients can use the verified inbox. Device delivery remains best
effort. See integration/35_MOBILITY_INVITATION_NOTIFICATIONS.md.

For identity lookup failures, preserve403/404versus503 and never retry through provisioning resolve. Do not clamp DM count to2. Missing verified incoming caller names are generic COP kontakt. Deployment and acceptance: [integration42](integration/42_VERIFIED_MATRIX_IDENTITIES.md).

## Temporary transport for the approved clean account release

The separate `cop-release-peer-identity-v1` operator contract authorizes only
`comm.home.cz` and `storage.home.cz` for this release. It does not extend the
existing COMM-only contract implicitly. The operator creates a fresh Ed25519
identity in Root-owned tmpfs, `/run/cop-clean-reset-comm`; the additional exact
peer binding is `/run/cop-clean-reset-peers/peer-authorizations.json` (Root 0600,
parent 0700). Only public metadata is published for installing the two exact
public authorization lines. Both lines restrict source to `192.168.10.116`,
expire after two hours, and disable PTY and forwarding. Private key material
never leaves Docker Root RAM. Existing account passwords and SSH configuration
are unchanged.

The explicit peer receipt selects public-key authentication with password
fallback disabled. Existing password transport behavior remains available only
when no peer contract exists. Failure or disappearance of a bound receipt must
stop the release. Do not retry the deployment with an expired or missing key.

The outer release cleanup attempts removal on both hosts independently before
wiping local private authority; failure on one host must not skip the other.
A successful cleanup requires both exact public lines absent, both fixed SSH
control sessions closed and local private identity removed. Never unlink a
control socket to conceal a failed session shutdown. An incomplete remote cleanup must be reported and resolved
through existing authenticated administration; expiration alone is not evidence
of removal. Preserve all other authorized keys. Transport preparation does not
prove deployment or enable account deletion. Verify actual production versions,
owner capabilities and final release receipts separately.

Targeted regression tests: `python3 scripts/test-temporary-release-key.py`.

For the clean release, run
`python3 scripts/tests/test-clean-release-global-names.py` together with
`python3 scripts/tests/test-clean-reset-root.py`. The temporary identity test
executes the actual metadata-binding function; mocking that entire function
would conceal a runtime NameError. Its digest uses `hashlib.sha256` directly.
Never edit a previously sealed operator bundle in place to apply a source fix;
keep operator-version transition evidence separate from account reset evidence.

### Already retired measurement-report producer

`known-retired-v1` is an explicit alternative to the unchanged exact legacy
cron custody. Missing legacy cron alone never authorizes a reset. The alternative
requires the Root-owned disabled-installation receipts under
`/srv/sim/.sim-erasure-cutover`, bound to source `ca1fd6b`, retired cron digest
`c46a03...` and original inventory `12e5f8...`, with matching clear post-stop
inventories. Unknown or changed evidence fails closed.

The first binding uses the sealed SIM report inventory and pinned Node runtime
to check protected report storage, no initial report lock and no selected
scheduled/running producer. Every subsequent custody assertion rereads the Root
receipts, scans the same five scheduler roots and checks current processes.
Scheduler/receipt digests must remain unchanged. Report-file contents are not a
producer digest: deletion and temporary file locks belong to the separately
admitted reset worker while application writers remain stopped. No legacy cron
is recreated and no comment marker is manufactured.

For this operator change the user explicitly cancelled further test suites.
Only syntax/global-name inspection and independent source review were performed;
the final Root command must enforce actual retirement and producer preflight
before changing account data. This is not evidence of production activation.


### Clean-release Keycloak preparation ordering (2026-10-18)

The clean-release pre-freeze inspector requires the dedicated
`cop-account-erasure-worker` identity. The previous orchestration assumed this
identity had already been provisioned, so absent host configuration caused
`RELEASE_NODE_PREPARATION_FAILED` before database inspection.

The external hash-bound release launcher must call
`scripts/keycloak/install-clean-erasure-client.mjs --apply` before requesting
the PostgreSQL administrator password when both worker configuration fields
are absent. A partial configuration is an error; it must not generate or rotate
a replacement secret. This external operator helper uses the pure provisioner
and canonical host-environment parser from the verified immutable COP bundle.
It preserves the original host file bytes and ownership except the existing
three approved Keycloak preparation fields. Administrator credentials stay in
the interactive Root terminal and process memory; only the dedicated worker
secret is persisted in `/srv/cop/.env`. No account reset, application restart,
or erasure activation is performed by this preparation.

The helper accepts only the canonical parser's two existing allowed duplicate
keys; it does not normalize the host environment or broaden duplicate handling.
The original standalone installer and immutable source bundle remain unchanged.
Additional test suites were not run, per the operator's explicit cancellation;
syntax/static review is not a claim of completed production provisioning.
