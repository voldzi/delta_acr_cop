# 29. Shared vehicles and private Dispatch: server and SDK handoff

Verified 2026-10-04. **COP server deployed; public SDK published.** This is not
completed Jízda client integration or physical-device acceptance. No actual user
consent, GPS collection or personal ride sharing was activated by this release.

## Exact released identities

| Component | Source/status |
| --- | --- |
| COP API | `888f08ce46279c6c4ea5234875b3e98502802e6b`, branch `codex/shared-vehicles-dispatch` |
| Actual COP API image | `sha256:c9e3717f4205668fae8c6eeebcb4aa2023d5d422f23483ca657357f2943610d7` |
| Public CSMCommunicationKit | `c4470c846d2084901dcc560bb6e9c506ca7e3e71`, branch `codex/shared-mobility-sdk` in COP-Mobile |
| Server flags | `COP_SHARED_MOBILITY_ENABLED=true`, `COP_PRIVATE_DISPATCH_ENABLED=true` |
| Jízda client write/GPS gates | Remain false according to Jízda; COP did not modify its files |
| SIM / Web | Untouched by this delivery; no private data export to SIM |
| Driver traffic intake | Remains false; unrelated to this private feature |

The full binding OpenAPI is published on the COP release branch above and in
`/Users/voldzi/.codex/worktrees/jizda-routing-safety/01 COP/openapi/openapi.json`.
Its exact additive fragment is [shared-mobility-v1.openapi.json](../api/shared-mobility-v1.openapi.json).
Source code/docs commits after the listed revisions do not change these images.

## Public integration contract

Public source files: `CSMMobility.swift`, `CSMMobilityContracts.swift`,
`CSMDispatchEncryption.swift` in CSMCommunicationKit. No generic transport, token,
raw private key, CSMCore or private Matrix API needs to be accessed by Jízda.

- `mobilitySessionScope()` gives a stable issuer+subject hash for account-bound
  vehicle outbox. Each request also captures a distinct local session generation;
  logout/relogin to the same account rejects late responses. Credential issuer/sub
  must match the selected actor before transport. Observe `.csmMobilitySessionChanged`.
- Account UUID is assigned server-side from verified OIDC issuer+subject. Signed
  email verification is required for accepting a matching email-addressed invite.
  Existing PKCE login remains; actual IdP registration is still unverified.
- Creation/acceptance returns `CSMSharedVehicleCreationReceipt {operationId,
  confirmed,vehicle}` or `CSMDispatchGroupCreationReceipt {operationId,confirmed,
  group}`. Use the exact assigned UUID/revisions; do not invent dataRevision+1.
- Invite queued receipts are separate. Inbox is `mobilityInvitations`; acceptance
  uses invitation UUID and operation UUID. No SMTP delivery is implemented or
  claimed; say “pozvánka připravena v COP”.
- Vehicle mutations require exact data/membership/record revisions and persisted
  operation UUID. Retry identical body/operation; changed body is409. Current ACL
  governs reads and sync; a removed account cannot use an old cursor. Owner+four
  drivers, explicit capability list, original author/audit and tombstones.
- Only explicitly approved name/plate/VIN and shared summaries are sent. Personal
  rides, passengers, GPS geometry and attachments never automatically migrate.
  Money uses integer minor-unit strings; liters/kWh/odometer use decimal strings.
  Corrections require an identified observation and reason.

## Dispatch encryption, consent and recovery

Instantiate `CSMDispatchEncryption(expectedScope:)`, call `registerDevice(name:)`,
then obtain typed `dispatchReadiness`. Keys are SDK-owned X25519 in non-syncing
WhenUnlockedThisDeviceOnly Keychain, scoped by account. Registration key/operation/
name survive retries. Device revocation removes its local key after server ack.
The facade is permanently invalidated by any session-change notification.

The directory is authenticated by COP; it is not independent manual device
verification. Readiness requires current active accounts' device keys and exact
audience hash/membership revision. Changing members or keys invalidates shares.
Cipher suite and exact bound metadata are documented in
[ADR0031](../adr/0031_SHARED_VEHICLES_AND_PRIVATE_DISPATCH.md): sender-static plus
per-recipient ephemeral X25519, HKDF-SHA256, AES256-GCM authenticated boxes.

Jízda must apply its explicit consent/local zones before calling `sealGPS` on an
actual CLLocation. SDK rejects known simulations, inaccurate/outdated/future or
out-of-order fixes. Server validates metadata and recipient set, not physical GPS
origin or the encrypted accuracy. Send `dispatchPublish` only with encrypted
boxes, never plaintext coordinates or a GPS retry queue.

Start durations900/3600/28800sec; ride_end max8h. Require explicit fresh consent,
authoritative start/share UUID and audience. Never restore consent from login,
restart, reconnect or an old operation receipt. A replayed stopped start remains
stopped. A new share cannot replace an active own share until confirmed stop.

Persist only start/stop/cancellation operation identifiers for recovery. A timed-out
start may commit after a GET: use `dispatchCancelStart(request:expectedScope:)`
with a NEW cancellation operation UUID and the persisted startOperationId. Exact
receipt returns both plus confirmed:true. The server serializes a durable account-
scoped cancellation tombstone against start, before or after commit; another
account cannot cancel it. Block new start until cancellation is confirmed.
`dispatchOwnedShares` supplements this by locating already committed own shares
for stopping; an empty GET is not a cancellation acknowledgement. Never resume
GPS from owned-share metadata. A stop remains possible after leaving/deletion.

Receive a fresh authoritative `dispatchSnapshot`, then `openPoint(_:in:now:)`.
Match activeShares, current audience/device/sequence/expiry. Clear old markers on
roster/share sequence changes or confirmed stop. Fresh<=60sec, stale60..180sec,
hide>180sec or earlier session expiry. Polling/receipt time never replaces GPS
observedAt. Local private-zone entry sends stop reason, not zone geometry.
Offline receivers cannot be erased instantly; bounded age hiding still applies.

## Existing participant chat and direct calls

`dispatchParticipantConversation(groupId:accountId:request:expectedScope:)`
resolves only a current authorized private participant and verifies an encrypted,
E2EE-required direct room with exactly both actual subjects. Wrong/unbound scope
fails503; removed participant/replay fails404. Response contains exact operation,
group/account UUID, conversationId and roomId, no provider subject or credential.
`openDispatchParticipantConversation` selects it in the existing SDK-owned native
chat surface. Explicit existing `startVoiceCall(roomID:)` may use that room; no call
starts automatically. No new group room, group voice, conferencing or PTT. Voice
retains the existing server-authorized LiveKit/native threat model; map encryption
is not a claim that voice media is server-blind E2EE.

## Actual storage and operational behavior

Existing PostgreSQL, additive `cop_mobility_v1`; no memory fallback. Domain writes
are transactionally serialized by advisory lock for this bounded pilot. Dispatch
requires one API instance with an exclusive session lease; a second fails startup.
Lost lease/dependencies fail503. Restart invalidates shares and drops RAM points.

- Coordinates/ciphertext points never enter SQL, audit, logs, backups or SIM.
  Only latest ciphertext is in API RAM, capped512 shares/32MiB. Serving age bound
  is180sec; physical RAM cleanup runs every5sec (up to185sec without another read).
- Vehicle history retained while active; deleted vehicle data purged after30days.
- Invite expires7days and is purged30days after expiry; no bearer invitation secret.
- Old share metadata purged30days after expiry. Cleanup runs at startup/hourly.
- Operation response bodies expire30days; minimal operation/hash and cancellation
  tombstones remain to reject late replay with410 rather than recreate data.
- Existing database backup retention is separate; do not promise immediate backup
  erasure. Account-wide deletion needs separate authenticated handling and cannot
  erase other authors' records.

## Verification evidence

| Check | Actual result/limits |
| --- | --- |
| Full COP suite before final additions | 1259 passed,1 skipped |
| Final mobility suite |18 passed: ACL, two-account isolation, verified inbox, idempotency/conflicts, costs filtering, cursor revocation, retention, publish-stop race, receiver scope, TTL/restart, timeout-cancel-late-start, participant scope, total group membership quota |
| Actual isolated PostgreSQL | Rollback, simultaneous writers, receipt restart persistence, exclusive Dispatch lease passed |
| Signed RS256/JWKS HTTP | Two synthetic users, exact create/accept receipts, identity/plaintext rejection and dependency503 passed |
| Packaged final production image | Network-none signed HTTP acceptance passed; includes participant room with synthetic Messaging provider. Test-only memory store; not actual production IdP/Matrix login |
| COP lint/types/API build/skeleton/schemas | Passed;11 schema files |
| Final JSON OpenAPI | Valid,26 warnings, no errors |
| Exact isolated final SDK source |70 package tests passed on approved Xcode27.1/27A9269/SDK27.1 |
| COP Mobile mandatory check | Passed app tests,89 package tests,2 accessibility tests on installed27.1 simulator; precedes final small SDK additions, separately covered by final isolated SDK run |
| Production after deployment | Actual image/health/readiness200; anonymous new endpoints401; real PostgreSQL lease1; ordinary route1variant/8maneuvers; trafficfalse; strict routingfalse |
| Real users / actual Matrix/direct call / physical iPhone | NOT performed in this delivery |
| Live rollback/outage injection | NOT performed; previous images/config retained, isolated failures tested |

Selected default27.0 simulator runtime was unavailable; the documented simulator
selection chose installed27.1. The human explicitly approved this exact pin in
Jízda turn `01a10762-dadd-7b70-bc0e-f8ba8d5ecf80`; no SDK download or minimum-OS
change. Chroma retrieval was unavailable in earlier scope discovery; selected
sources were inspected directly. No successful release-worktree reindex is claimed.

Evidence logs on workstation: `/private/tmp/cop-mobility-{full-tests,final-tests,
 lint,build,openapi,schemas,skeleton}.log`, SDK release test log and Mobile check log.
Production private journal: `/home/voldzi/cop-deployments/shared-mobility-20261004`.
Protected pre-release database dump verified present2226834678bytes; contents never
printed. Runtime images were prepared from compiled source on the pinned old
runtime, with signed packaged acceptance before each deployment. Only API changed;
web/SIM container IDs, environment except the two new flags, networks and ports
were checked. Secrets stayed in protected production storage, absent from Git/logs.

## Rollback and remaining joint acceptance

Immediate rollback image `sha256:436bc2e1eb0038b7f51e7acfb445d66fe7f33b092cbad6c3a00f0ec49f6a3348`.
Pre-feature image `sha256:5b9885798d92a1f2bb1e845ab054fd0e10bd8c1cbe91d010608ad6e18a3647e6`,
retained tag `delta-acr-cop-api:rollback-shared-mobility-20261004`. Disable both
mobility flags and restore that API image/source using the existing deployment
journal. Leave the additive table intact; do not blindly restore the entire database
or overwrite subsequent unrelated environment changes. Existing private points are
RAM-only and do not resume after restart. A live rollback roundtrip remains untested.

Jízda reports313 domain tests/61 isolated simulator assertions and typed account,
vehicle/outbox integration. It explicitly reports incomplete raw-GPS/lifecycle/
cancel recovery, some management/corrections and ride/reminder integration; gates
remain false. These are Jízda-owned remaining work, not proof of completed sharing.
Next: pin final SDK, complete those client paths, then jointly test two REAL signed
accounts/invitation/ACL/outbox plus actual Messaging, and physical iPhone consent,
account switch, network loss, late start cancellation, private zones, expiry,
foreground/background, stopped-marker hiding, storage/battery/network behavior.
Only then decide separately whether to enable Jízda's write/GPS gates. No private
Dispatch data belongs in SIM or in live traffic/ETA aggregation.
