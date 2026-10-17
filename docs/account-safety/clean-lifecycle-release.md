# Clean COP/SIM lifecycle release

## Current evidence

2026-10-17: owner authorized clean deletion of all test-user data, no new backup of those test data. Reset and production activation have not yet run.

Read-only COP inventory: 11 profiles, 12 devices, 7 web sessions, 4 pairing sessions, 111 calls, 9 community reports, 10 groups/15 memberships, 21 drawings/920 drawing audit rows, 18 mobility KV entries. Attachment rows and driver consent rows are empty. The database also contains 54,012,548 track-history rows and 21,468 current tracks: these are outside the blanket user reset pending source classification and must not be truncated.

Preserve configuration, service accounts, map/provider data, secrets and other applications. SIM inventory and persistent cleanup work are coordinated with its owning task.

## Configuration

`COP_ACCOUNT_ERASURE_SCOPE=cop_sim_shared_identity_v1` selects the explicit v2 web contract. `COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED=true` authorizes shared identity removal. `COP_USER_RESET_TOKENS_NOT_BEFORE` must equal the enrolled reset cutoff in Unix seconds; JWTs issued at or before it (or missing iat) are rejected even with a valid signature. This prevents an old native token recreating a test profile after reset. The new shared scope requires `COP_ACCOUNT_SAFETY_AUTHORITY_MODE=database_v2`; the uninstalled native alternative is not selected as a fallback. These flags alone do not bypass readiness or enroll a reset baseline. The v1 acceptance does not authorize v2.

## Acceptance required before activation

Two synthetic users; A deletion including identity/SIM access, B unchanged; immediate request fence; asynchronous retry after service outage and process restart; actual provider readback; removal of retained copies; data reset and epoch verified; normal login/chat/maps healthy. Report each actual test separately. A mock HTTP test or successful build is not production acceptance.

## Rollback

Disable new deletion intake if necessary; retain pending jobs, fences and original operation IDs. Deploy only a version which understands the new scope/epoch. Never restore the removed user data or silently start a v1 worker over v2 jobs.

## Implemented COP–SIM boundary

The clean adapter uses separate SIM endpoints, scope and headers. It never sends an old erasure claim to a new endpoint. `x-cop-clean-actor` is compact base64url JSON authenticated with the existing server signing secret and a 60-second HMAC. Exact claims: `iss`, `aud`, stable opaque `sub`, verified `oidcIssuer`, canonical `oidcSubject`, `resetEpoch`, immutable `operationId` and `requestedAt`, `iat`, `exp`, `jti`, `resourceId`, original signed `oidcIat`. The same assertion is attached to actual BYOK/chat writes and driver batches. Driver resource ID must match COP's existing daily HMAC derivation; raw positions are not in the assertion. No key, question, payer or model is included in these claims.

AI endpoint prefix: `/api/v1/ai-router/internal/user-lifecycle/v1`; driver prefix: `/api/v1/internal/user-lifecycle/v1`. Read-only `GET /capabilities`; durable `POST /deletions`; owner-bound `GET /deletions/:operationId`. A component `deleted` receipt is accepted only for the exact operation, epoch and component with no extra fields and `Cache-Control: no-store`. It is not a whole-account completion claim. The COP driver adapter separately fences and removes its local consent/outbox after verified SIM cleanup.

## Current local verification

- Keycloak shared-identity adapter: 12 mock-HTTP tests, including false204 and lost-response recovery. No live Keycloak identity was deleted.
- COP/SIM transport and writer assertion tests: pending receipt, exact claim/epoch/component binding, outage, no unexpected context, per-user opaque IDs and correct driver contributor. These are HTTP mocks, not production acceptance.
- Reset tool: 42 assertions on an owned Unix-socket-only PostgreSQL cluster, including a real restart, rollback after TRUNCATE failure, unexpected FK refusal, plan drift refusal, configuration/provider sentinel preservation and issuer-required new profiles. No production data touched.
- Full initial regression revealed web test fixtures still used v1; they were corrected to the explicit v2 contract, and all 11 account-deletion UI tests now pass.

## Reset tool boundary

`scripts/account-safety/clean-user-reset.mjs` exposes no HTTP endpoint and has no automatic apply. It lists 19 user tables and finite mobility prefixes; there is no wildcard table truncation, CASCADE, volume deletion or backup creation. It requires operator confirmation that writers are stopped and old identity admission is closed; performs a single transaction; locks planned tables; rejects changed counts or unplanned foreign keys; verifies zero user rows and preserved configuration; then records a new nonsecret reset epoch. The complete deployment controller must provide and verify those operator conditions and clear other provider/file copies before reopening admission.


Additional actual verification: 76 offline runtime/deployment tests pass, including rejection of an old v1 proof for new clean flags, mismatched epoch and missing joint acceptance. A separate Root-only proof contract (`cop-api-account-erasure-clean-config-v1`) binds the reset epoch, cutoff and reset-receipt digest to the exact runtime/profile. Existing actor secrets, networks and mounts remain outside that configuration permission.

The real COP adapter was also exercised against SIM HTTP and owned PostgreSQL (35 assertions; two lanes; A/B data, no-resource user, pending/completion/readback, outage). Business writer in that test is explicitly synthetic, not an OpenAI call. SIM separately reports actual bootstrap/business-handler tests; the joint test does not claim whole-account acceptance.

The actual independent PostgreSQL journal fixture passed 10 tests (one separate whole-service fixture skipped). It includes `cop-erasure-fence-entry-v2` and loss of the complete local job/config: the encrypted original principal resumes cleanup without another login, actually removes restored synthetic A data and preserves B. The Keycloak adapter in this case is the actual shared-identity adapter against a synthetic HTTP provider; the other domain cleanup ports are synthetic. The accepted immutable journal stores the original preflight identity fingerprint, so a missing identity after local checkpoint loss can be verified without another login, while a recreated identity is refused before DELETE. This is not Matrix or live Keycloak production acceptance.

A Keycloak reset component has four HTTP-mock tests. It enumerates native service-account IDs through clients before classifying humans, disables/removes only the approved test humans, requires actual GET404, preserves clients/realm/service accounts, and rejects inventory drift. Production credentials and users have not been used by those tests.

Final source regression after the recovery-witness fix: 2,571 tests passed, 106 skipped; typecheck/lint and build passed. The joint COP/SIM fixture was rerun against SIM 6238345 using native restricted AI/driver login roles and the actual grant migrations; 35 assertions passed. No administrator runtime or disabled privilege check was used. Production activation remains pending whole-service acceptance and the protected Root install.

## SIM operator candidate, independently checked

SIM published `52f54cee152c5b869bc8d74cc0e08802ee3fc4f4` on `codex/sim-clean-lifecycle-v1`. COP independently verified the remote ref, clean source checkout and reset manifest SHA-256 `de4548fad17c1bc978d91951f59ec5bd8648b2711f5d168f517efe332aedd09d`. COP reran its owned PostgreSQL reset test (87 assertions, one actual restart) and synthetic filesystem test (13 assertions); both passed with `productionWrites=0` / `productionFilesChanged=0` and `realRootAdmission=false`.

The runbook is SIM `docs/runbooks/21_CLEAN_COP_SIM_RESET_OPERATOR.md`. The exact known-old guard replacement and enrollment are atomic per database, with restricted finite table/file scope. Two databases plus files are not one distributed transaction: partial failure must keep all writers and producers stopped. There is no automatic apply endpoint or privileged installer in that SIM component.

File inventory covers one confirmed COP precomputed route file; the other 911 route files have different actors and must remain byte-preserved. Absence of report files or a lock is not proof that a producer is stopped. The common production controller, actual Root admission/freeze and whole-provider acceptance remain outstanding. Do not use the historical v1 `--complete-release` procedure to claim the new v2 scope is enabled.

## Additional SIM ownership gap found during final inventory

SIM reported eleven scenarios, four drafts and an audit file with mutable actor
labels; their source does not establish canonical issuer/subject ownership.
The three SIM AI history records are also potentially user-linked. They must not
be described as public/provider data or silently preserved while claiming whole
account deletion. The approved finite test-data reset must cover these legacy
user datasets; new writes require verified owner provenance and a durable fence.

COP v2 now requires `sim_user_data` in addition to the previous eleven domains.
Its source-only adapter uses SIM main `/api/v1/internal/sim-user-data/v1`,
`cop-sim-user-data-v1`, and the existing short-lived signed canonical actor format.
It requires `app_store`, `audit_and_publisher`, `router_sim_history` all `deleted`
in a fresh no-store HTTP200 readback. The three new server-only settings are
`COP_SIM_USER_DATA_ERASURE_URL`, `COP_SIM_USER_DATA_ERASURE_TOKEN` and
`COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET`. Empty settings leave the adapter absent
and block confirmation. No new credential has been created or transferred and
production has not been changed. SIM implementation and joint acceptance remain
in progress; the Root deployment configuration permission must explicitly bind
these fields before they can be activated.

The bot-specific approval was received and the fixed `cop.ai.agent` admission
implementation is published in Messaging `76f60be`; it preserves the original
service mapping and token and cannot create/reactivate a missing native identity.
Its actual owned database and synthetic HTTP tests passed. Production service
enrollment has not run. COP's additional boundary tests: 85 passed; server
composition tests: 12 passed; types and OpenAPI passed (25 existing warnings).
The updated offline runtime suite passed 77 tests; the old scope cannot authorize
the new SIM app credentials. This is source/test evidence, not whole-service or
production acceptance.

## Root reset components, not yet one production release

The current finite COP reset additionally covers optional incident/task tables
and regenerated Edge replay cursors. Live read-only inventory found those
incident/task tables empty, dead letters empty, legacy MCP usage empty, one
cursor and six audit events. Unknown nonempty dead letters or MCP billing now
block the reset instead of being silently deleted. Official track data remains
outside the reset. The updated owned PostgreSQL test passed 48 assertions,
including transaction rollback, writer-admission loss and an actual restart.

The Synapse schema94 reset component passed 177 assertions against an owned
PostgreSQL cluster compiled from the exact schema-only export. It preserves only
configured server/control state, the original bot identity/password binding and
the configured administrator credential. Messaging metadata preserves only the
original fixed bot mapping. This test did not invoke live Synapse HTTP.

Separate native-media, Edge-state and Root protocol components have 4, 5, 8 and
5 isolated checks respectively. Edge keeps node configuration, clears disposable
event copies/cursors/errors, refuses accepted fence files and uses atomic replace.
The Root private worker/controller checks exact plans, live stopped writers,
producer custody and nonreplayable leases; credentials travel only over stdin.
These components have no standalone apply CLI. The final release coordinator,
all-provider acceptance, SIM application-data production enrollment and Root
activation remain unfinished. Do not present these component tests as a
production reset or account-deletion acceptance.

A separate build-only script for API revision `6c5c9855b29644cdc6e86b5b66166c861226cdba`
was staged on the server for operator execution. It seals only the fresh public
X5 checkout and builds through the existing guarded deployment path; it does not
reset data, activate a release or enable account deletion.

The concrete Root admission now also binds the actual protected runtime-profile
pointer to the reviewed COP container/image. Its explicit `freeze_reviewed`
composition acquires the existing deployment lock, verifies all exact targets,
pauses only the known report cron and stops the finite reviewed writer set.
Unknown/replaced/paused instances block before stop; no failure path restarts
writers. Ten isolated Root protocol checks pass; no live stop was performed.

Clean business-schema preparation now reads the separate clean Root plan rather
than the historical v1 release plan. It verifies the actual database reset marker
and exact clean scope, and rechecks live admission before committing DDL. Thirteen
owned PostgreSQL tests pass, including lost-admission rollback and mismatched
reset rejection. The reset marker grants only SELECT to the existing business
owner; the test verifies that role cannot UPDATE it. The COP reset test remains
48 passing assertions with an actual restart. This does not establish a finished
production release coordinator or whole-provider acceptance.

The actual COP `sim_user_data` adapter was exercised against the new actual SIM
main app, Router, restricted relay and owned PostgreSQL: 14 assertions passed.
A data disappeared while B's scenario remained; owner-bound status, wrong token,
wrong issuer, repeated deletion and fresh readback were checked. The SIM endpoint
verified actual RSA/OIDC test tokens; no actual Keycloak server was used. External
provider attempts were zero. SIM source/compiled pins were unchanged before/after
this run, but SIM was still a working candidate, so rerun after its final source
publication is required. This is component integration, not twelve-provider or
production acceptance. Evidence: `docs/testing/account-erasure-sim-app-component-20261017.json`.

The first operator build-only attempt stopped at the dedicated builder check:
its registration and X5 cache remained, but the container was absent. The scoped
recovery restored only this COP container using the already-installed pinned
BuildKit image, verified actual X5 device/restart=no, preserved the cache and did
not restart any application. The candidate build was then restarted through the
same guarded build-only path. Build completion is recorded separately; this
recovery does not activate account deletion.


### Completed candidate build and SIM reset composition (2026-10-17)

The guarded build-only run completed for API revision `6c5c9855b29644cdc6e86b5b66166c861226cdba`.
Immutable image: `sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df`.
The exact Linux image passed actual Sharp conversion and conversion-storage
source guard checks. X5 preflight and the existing health/public demo baseline
passed; the pre-existing AI gateway remains degraded. Read-only Docker inspection
confirmed the old API container/image was still running. No database reset or
account-deletion activation occurred. Evidence: [candidate build](../testing/account-erasure-api-build-20261017.json).

The Root private worker now also composes the finite SIM legacy app-file reset,
with its own `sim_app_files` reviewed digest. It can inspect only the exact stopped
`csm-sim-api` instance while that phase owns a live Root lease. Different image,
container, live PID, wrong phase and unreviewed digest are rejected. Readback
requires scenarios, drafts, publisher items and legacy audit bytes all zero.
Six controller and ten Root protocol tests pass. These isolated protocol tests
do not establish actual production Root admission or whole-account acceptance.
The remaining final coordinator still has to compose SIM continuity enrollment,
provider closure, credential provisioning, deployment and acceptance before enable.


The matching web candidate has a separate fixed build-only entrypoint
`scripts/account-safety/build-clean-web-candidate.py`. It uses the same already
sealed revision6c5c985 checkout, the verified dedicated X5 builder and the existing
deployment lock. Only the explicit public frontend build arguments are passed
to the build; the full Compose output stays in memory. The owner explicitly reconfirmed on 2026-10-17 that existing public-demo analytics
must remain unchanged. This build requires the existing enabled flag and
website ID; it cannot select another measurement scope.
It writes a candidate-only image tag and verifies that both live API/web instances
remain unchanged. It cannot deploy, change configuration or enable deletion.


### Final SIM component rerun and matching web image

The actual COP app-data adapter rerun passed all 14 checks against published
clean SIM `a337cfc1aa3dc8ef3fd49a84b6e2fb94a651ee4d`. Compiled/source pins
remained unchanged throughout; A was removed, B's scenario remained, owner-bound
status and wrong issuer/token rejection passed, external-provider attempts zero.
This replaces the earlier working-candidate evidence for this component only;
it is not whole-provider/actual Keycloak/Root production acceptance.

The matching immutable web image built successfully:
`sha256:6481b7c29d462b10e365692231c19b1b88a631693a09826003333106771b7329`,
API/web source `6c5c9855b29644cdc6e86b5b66166c861226cdba`.
Both current production API/web instance IDs and images remained unchanged.
Existing public-demo analytics was preserved after the owner's explicit current
approval. Evidence: [web build](../testing/account-erasure-web-build-20261017.json).


The private Root worker now wires `sim_user_install` to the concrete SIM installer
module. Its reviewed plan, reset epoch and token cutoff are checked before apply;
inside the one live lease only the three exact stopped SIM instances can be
inspected. Global readback validates the exact new AI catalog from the new SIM
manifest plus zero COP request/key/audit/billing counts, while driver still uses
its unchanged manifest. Seven controller and ten Root protocol tests pass; these
are protocol/source checks, not production enrollment or whole-provider proof.
The concrete SIM install module is being completed separately before this phase
can be executed. Credentials remain private pipe input and are not test evidence.


The filesystem worker now executes on the actual docker host, through the same
private Root pipe and continuously checked admission. It uses existing host
Node22/24 solely for pure filesystem modules; the app and SQL worker remain
Node24. This fixes the real container boundary: the SQL image has neither the
host filesystem layout nor host `findmnt` UUID evidence. The host child receives
no database, Keycloak or runtime credentials. `files` and `sim_app_files` retain
separate reviewed digests and exact stopped-writer checks. SQL readback requests
a fixed host `fileReadback` operation, with no path/command parameters and no
new listener, Docker volume, host device or application mount. The Root controller
checks admission before/after the nested readback. This has protocol/syntax
verification only; actual production Root execution is still outstanding.


### Narrow host operator runtime (2026-10-17)

Automatic review rejected a proposed broad production `/srv/cop` bind and extra
container capabilities. That proposal was not applied. The narrower replacement
uses a direct child process of the existing Root operator and creates no privileged
container, secret bind, listener or application permission. Public Node24 and its
dependencies were exported from the already verified COP candidate image onto X5.
Actual unprivileged host execution passed with Node24.22.0 and pg8.23.1. No production
configuration was read. The exported tree is still UID1000 preparation and must
be independently verified and sealed by Root before privileged execution.

The Root plan now binds this exact runtime/image and binary/loader hashes. All
workers use it directly on the host; filesystem checks see the actual X5 mount.
The COP safety install phase reads its fixed Root manifest, normalizes only the
two previously inventoried duplicate keys without changing effective values, and
calls the existing bounded SQL installer. Live admission is rechecked before
secret persistence and both database commits. The actual owned PostgreSQL clean
suite passed29 checks, including rollback of both databases and role creation
when admission was lost before guard commit. This is not production enrollment.


A concrete read-only full12 gate is now in
`scripts/account-safety/clean-release-acceptance.py` (`validate_for_plan(plan)`).
It requires the actual Root0600 `whole12-acceptance.json` under the clean release
directory, matching all nine candidate images, the v2 shared scope, twelve fresh
provider readbacks, A removal/B unchanged, real identity removal, outage503,
restart/late-writer and actual restored-row cleanup evidence within24hours. The
Root freeze itself calls the gate before pausing any producer or service; a
component14 receipt cannot admit a stop. Seven parser rejection tests pass. No
actual full12 report exists yet: this source does not mint one or authorize GO.

### Remaining provider composition (source, not production acceptance)

`clean-remaining-reset.py` now provides the concrete
`prepare_remaining_reset(plan, private_config, remote)` context and
`run_remaining_reset(admission, private_config)` phase. Provider inventories,
TLS connection scopes and storage authentication are checked before the common
controller may freeze writers. The same live Root admission remains held through
metadata/native SQL commits, native-media removal, Edge reset, storage credential
rotation, media-closure enrollment and fresh readbacks. Missing or changed plans
refuse the operation. A failure does not resume application writers.

The confirmed native-media bind is `/srv/csm-messaging/matrix/data` to Synapse
`/data`. Edge uses the existing `cop_cop-edge-data` named volume. Its helper
receives only that volume, without network, Docker socket, extra capabilities or
production secret files. Docker internal filesystem paths are never opened.
Read-only inspection confirmed only `state.json`, UID0, mode0644. The selected
Synapse candidate supplies Python3.13; its isolated no-mount/no-network smoke passed.

`clean-reset-s3.py` handles only `cop-community-media`. Unknown/versioned storage,
ambiguous XML, partial inventories, traversal keys, changed plans or unavailable
services cannot become an empty-bucket result. The existing finite storage
process performs the approved same-image stop/rotation/start without calling
the superseded whole11 installer. Only the existing COP credential is rotated;
other storage identities are preserved. New credentials go only into the existing
COP and storage production secrets files, never receipts, command arguments or Git.

The actual closure result is enrolled into `cop_safety_v2.media_upload_closures`
under the current target/guard binding. The application remains SELECT-only.
Eight owned PostgreSQL assertions passed: wrong-binding rejection, rollback when
live admission disappears, restricted-role read/denied mutation, and immutable
evidence. This SQL test uses synthetic provider evidence; it is not live storage
or whole-provider acceptance. Eight S3 inventory boundary tests and five
composition configuration tests pass. The combined wrapper, credential rotation
and Root deployment have not been executed in production.

### Fresh whole12 namespace

A new network-none namespace `cop-clean-whole12-9aff26e65b74` has actual Keycloak
users A/B in realm `cop`, real tokens with `SIM_ADMIN`, and the exact erasure
service client. The holder uses COP API candidate `2e61857`; Keycloak uses the
existing immutable optimized test image `74ae260e7c0d`. No public ports are
published; previous fixtures and production identities remain unchanged.
Generated credentials exist only in private container tmpfs/server process RAM.
A scan verified they did not enter Docker configuration metadata.

Entrypoints are `prepare-clean-whole12-fixture.py` and
`clean-whole12-keycloak-seed.mjs`. This proves namespace/identity preparation,
not completed deletion. SIM's unchanged-production-bootstrap TLS composition is
running in this namespace. Full12 and production enablement remain pending.

The actual additional fixtures now include Synapse 1.156.0 with its reviewed
provider, Messaging image `9d7fc989`, PostGIS 18.6/3.6.4, SeaweedFS 4.45, Edge,
LiveKit and its Unix socket proxy. Actual Matrix startup SQL/catalog checks,
provider capability/acceptance and hydration passed. The HTTPS fixture proxy
must forward `/_synapse/client/cop/` as well as Matrix/admin paths; omitting it
returned a real 404 and correctly prevented hydration. The private Unix socket
also requires the actual Messaging process UID 1000; root without capabilities
cannot traverse its owner-only directory. Both fixture errors were corrected.

Actual S3 checks verified interruption of an admitted old-key upload, old-key
denial, new-key access and preservation of the other synthetic identity/bucket.
Actual LiveKit room create/list/delete passed. COP generated real A/B profiles,
devices, consents, mobility rows, one-hour voice JWTs, reports and guarded S3
uploads. Matrix metadata was created by six real HTTP producer calls. A helper
failure after those calls was recovered from the six unique actual records;
requests were not replayed to manufacture a successful seed checkpoint.

`fixtures/whole12-check.mjs` uses actual provider/SQL readbacks and fresh Keycloak
PKCE logins. The missing driver worker start was corrected. All twelve owners
then passed preflight; the real COP endpoint accepted operation
`b6fe7a68-d7a2-49e0-a9da-6dd7bcb01a4e` with HTTP202. Before acceptance, three
target databases were snapshotted without their independent guard. The unrelated
user retained access and could not confirm the other user's operation. Nine
domains subsequently read back zero removable A records and unchanged B state.

This case has not completed. Two unclassified native credential invalidations
already occur in its pre-deletion snapshot, which was seeded before full native
admission. The provider correctly refuses a completion claim. Messaging revision
`e2dfbf3` repairs native single-token/device-token deletion ordering; its eight
installed-upstream regression cases passed. The new fixture actions
`--bootstrap-clean` and `--seed-admitted-native` prepare an empty managed baseline
and create both accounts through the actual admitted Messaging HTTP endpoint.
They must not be used to overwrite the result of the historical-seed case.

The full deletion and post-restore cleanup tests are not yet accepted. No
production services, identities or switches were changed by these fixtures.

The reviewed native reset profile is now pinned by its complete raw SHA-256,
not only its own claimed digest and table count. A two-case boundary test proves
that reclassifying a configuration table as user data is rejected even when the
total table count and embedded export labels remain unchanged.

### Deploying after the common reset has stopped the old API

The runtime consumer must not restart the old unguarded API to capture a health
baseline. `cop-api-runtime.py` accepts the stopped-source path only for a clean
Root deployment proof. Root must capture the actual pre-stop health response in
`/srv/cop/runtime/clean-reset/pre-stop-health.json` and persist the actual common
reset result in `reset-result.json`, both Root-owned mode0640/group1000 within
the protected directory. Neither file contains credentials. The proof binds the
reset result's exact SHA256, original container/image, reset epoch and accepted
whole-test report SHA256. The health record is usable for at most one hour.

The source container must actually be exited, without a process or restart in
progress. All eleven common-reset phases and staged SIM configuration must be
present with intake still disabled. The new API still has to pass the existing
configuration, mount, network and real health checks. Normal deployments and
rollback handling retain their previous paths. Eighty-four runtime-consumer
tests passed, including the stopped-source path and rejection of mismatched or
stale proof. The final Root coordinator and production execution remain pending.

The release report retains the actual public COP states: initial HTTP202 with
`status=deleting`/`accountDeleted=false`, and final HTTP200 with
`status=deleted`/`accountDeleted=true`. Provider-local `pending`/`completed`
labels cannot substitute for those public fields. Eight parser rejection tests
cover the report, including rejection of mismatched public states and booleans.

## Composed fresh956 correction (2026-10-17)

The real accepted operation reached native Matrix completion but Messaging
rejected its own retry through the first-use preview (which correctly rejects
fenced owners). Messaging 08ca70a separates exact-operation continuation from
first-use registration; original HTTP operation completed, and a different
operation was rejected with 409. COP additionally recognized only the legacy
retention ID. The adapter now recognizes the exact published
`cop-messaging-minimal-technical-retention` identifier only under
`database_v2`; unknown or extended identifiers remain pending. This identifier
is a technical policy identifier, not a statement of production acceptance.

The independent fresh956 readbacks show zero removable Matrix and COP media
data, and preserve B. The full COP receipt is still pending the actual issued
voice token lifetime and final identity removal. Do not call this complete or
deployed. SIM's actual recovery in the separate 9aff case uses the same immutable
application bundle as fresh956; fresh956 itself did not capture a pre-deletion
SIM content snapshot and is not a SIM restoration test.

## Actual three-database restore attempt and corrections

The original pre-confirmation fresh956 dumps were physically restored into the
three isolated COP/metadata/native target databases. Current schema-only dumps
preserved original object owners/ACL; native creation also requires the original
`LC_COLLATE=C` and `LC_CTYPE=C` from the fixture's source. No unsafe-locale flag
was used. Independent COP fences, Messaging journal and first-use evidence hashes
were equal before/after; none of those databases was restored. A profile/device,
a native active account/token/devices and its original encrypted mapping really
returned. This was not a reseed. The local COP job was absent in the dump.

That actual replay exposed a receipt-access bug: the restored expired
confirmation plan caused background pruning to remove the still-valid read
capability, despite the same accepted job already being replayed. Pruning now
preserves read access only for that exact accepted operation; unconfirmed plans,
foreign operations and the existing30-day access expiry remain enforced.
Two new regression cases and the targeted account/transport suite pass62 tests.
This does not turn the pending overall restore/voice/identity check into GO.

`prepare-clean-cop-manifest.mjs` prepares only the missing public first-enrollment
input and its exact digest from existing identity keys and direct human decisions.
It performs no I/O, database inspection or enrollment and explicitly makes no
readiness claim. Its three boundary tests pass; the actual provisioner must still
validate the current database under the held Root reset admission.
