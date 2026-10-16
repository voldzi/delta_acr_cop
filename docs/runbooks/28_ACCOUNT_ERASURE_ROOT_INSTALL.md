# 28. Concrete Root installation and proof production

Status: fixed source and offline preflight tests. No production execution.
The coordinator must finish the actual shared provider/voice/restore run before
issuing a final executable release instruction to the operator.

## Final single Root entrypoint

The human explicitly approved this fixed persistent orchestration on16October
in `call_d82077a688f641bcabb2ebc58f9d13da`, answer “Ano, schvaluji tento přesný
závěrečný postup”. Its source write was then accepted by ordinary review.
This is source/test status, not evidence of production execution.

After the coordinator has staged the exact reviewed source/image, whole/restore
receipt and historical provenance inputs, the final hostRoot entrypoint is:

```sh
/usr/bin/env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node \
  /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --complete-release /srv/cop/runtime/account-erasure-install/completion-plan.json
```

The existing host Node22 is retained. PostgreSQL authentication is read once
without echo and reused only in RAM/private stdin for fixed Node24 SQL/media
helpers, whose Docker log driver is `none`. The unchanged scoped Keycloak
installer asks for its administrator username/password in its terminal. No
password is an argument, environment variable, Git file or receipt. There is
no token-paste prompt and no expansion of OIDC allowed clients or service scope.

The exact fixed `completion-plan.json` is Root0600 in a Root0700 directory:

```json
{
  "contractVersion": "cop-production-erasure-completion-v2",
  "phase": "initial",
  "releasePlanSha256": "<SHA256 of exact release-plan.json bytes>",
  "finalConfigurationSha256": "<SHA256 of exact final-configuration.json bytes>",
  "legacyProvenancePolicySha256": "<SHA256 of JSON.stringify(parsed legacy-provenance-policy.json)>",
  "legacyProvenancePlanSha256": null,
  "ownerReadinessReceiptSha256": null
}
```

`phase` is a durable recovery checkpoint: `initial`, `configuration`,
`provenance`, `media`, `media_closed`, `prepared` or `enabled`. Actual
pointer/CID/source/guard and owner readbacks are still required on each resume.
The checkpoint before final configuration prevents repeating first-enrollment
DB/Keycloak preparation after the final guard configuration has been written.
A completed provenance receipt is checked through fresh read-only whole-row and
ledger digests; a completed media closure is checked against the current
provider, credentials and independent SQL closure without rotating again.
`legacyProvenancePlanSha256=null` means that the exact live candidate has not yet
been reviewed under pause. The fixed policy digest is mandatory from the start.
Neither value is interpreted as absence of historical data.
The readiness receipt begins absent; its digest is written only after the actual
server health response is verified. The fixed final configuration manifest is:

```json
{
  "contractVersion": "cop-production-erasure-final-configuration-v1",
  "sourceRevision": "<same exact reviewed release commit>",
  "imageId": "<same immutable release image ID>",
  "expectedActive": { "<all fields>": "<same actual original release-plan active pointer>" },
  "edgeContainerId": "<actual full existing COP Edge container ID>"
}
```

## Initial Root custody and coordinator inputs

The installer does not turn a user-owned JSON file into Root authorization.
Before final invocation, the coordinator must deliver a private production
staging bundle with exactly these six input files and the one accepted whole
receipt referenced by the release plan:

- `release-plan.json`: final committed source, immutable API image, actual old
  full active pointer and the exact exported source-file SHA set.
- `completion-plan.json`: exact digests of those files, initial phase and no
  readiness digest.
- `final-configuration.json`: the same source/image/old active tuple and the
  actual **already upgraded immutable Edge** container ID.
- `database-enrollment.json`: the existing provisioner's reviewed first
  enrollment UUIDs, initial digest, current issuer/router identity evidence and
  pinned PostgreSQL CA. It has no database password or raw service secret.
- `legacy-provenance-policy.json`: reviewed fixed issuer, historical authentication
  evidence, writer CID, first-enrollment UUIDs and exact approved source pins,
  without rows. It may initially have only
  `binding.configurationFingerprint=null`; the actual row plan is generated
  privately under pause and separately reviewed by Root in its terminal.
- `media-closure-plan.json`: the exact current provider CID/image and approved
  other identity/bucket with the one actual COP writer.

This is private production metadata, not a Git artifact or public handoff.
Actual account IDs and historical row keys are not printed into a chat. No
readiness receipt or production media receipt exists before its real successful
step.

When the Root-owned folder does not yet exist, the final operator command must
include its custody step: create a new Root0700 temporary directory beneath
`/srv/cop/runtime`, copy only the seven fixed reviewed files from the private
production staging directory as Root0600, verify their coordinator-published
SHA256 values **after copying**, and atomically publish it at
`/srv/cop/runtime/account-erasure-install`. Do not overwrite an existing install
folder on retry. The exact staging path, seven hashes and source entrypoint
hash are release-specific and must accompany the final command. The Node
invocation alone does not bootstrap custody and refuses user-owned inputs.
No separate privileged service or generic command runner is used.

Guard, application-store and incarnation UUIDs are chosen in the reviewed first
enrollment manifest before execution. The new configuration fingerprint is not
invented in advance. After the actual existing database provisioner has checked
and applied its enrollment, under the same source/CID/deployment lock the fixed
producer seals only the policy's null fingerprint from the current production
secret and verified database binding. It preserves every policy field and
historical evidence byte and atomically updates the Root policy and completion
hash. A crash between these two metadata writes can be reconciled only by the
exact original null-template digest plus actual production DB/config readback.
A changed row/evidence/UUID or a different fingerprint is rejected.

The historical scope is separately operator-reviewed. The human confirmation
that real COP/Jízda accounts have only used the current Keycloak does not turn
arbitrary UUIDs into cryptographic proof. Original signed session JWT checks
remain mandatory; the reviewed canonical HTTPS JWKS is used without changing
runtime OIDC settings. New nullable schema attributes can be projected exactly
by the read-only inventory producer, then the actual complete post-DDL row is
checked again before enrollment. Missing historical evidence remains pending.

There are no shell commands, dynamic secret source paths or secret values in
either manifest. The fixed SIM source is existing `/srv/sim/.env`:
`AI_ROUTER_COP_TOKEN` maps only to `COP_SIM_ERASURE_ROUTER_TOKEN`, and
`DRIVER_MEASUREMENTS_COP_TOKEN` only to `COP_SIM_ERASURE_DRIVER_TOKEN`.
The fixed internal bases are `http://ai-router-api:4050` and
`http://sim-driver-measurements:4020`; no network or public port changes occur.
The existing actor/user-ID derivation secrets remain byte-equivalent. The relay
is existing `https://msg.zeleznalady.cz`, checked against COP's actual public
Messaging configuration, and the actual Edge admin token is preserved.

The fixed orchestration normalizes reviewed duplicates, selects only the
initial database authority while intake/guard remain false, prepares DB/schema
and Keycloak, composes the24-key final configuration with intake false, performs
actual paused-writer historical provenance, performs the actual candidate
Sharp/X5/DB image checks before the storage outage, then completes media closure
and reruns the attestation and Root config proof before guarded deployment. Deployment runs as
UID1000 through the existing immutable script with its own lock and exact CAS;
the hostRoot stage releases its lock before this handoff rather than deadlocking
the existing deployment lock.

It enables intake only after the existing `/health/dependencies` reports the
single `cop-account-erasure-owners` dependency `status=ok`, `checkedAt` at most30s
old, HTTP200/no-store, and unchanged actual guarded CID/image/generation before
and after the request. This is the server's real readonly owner/continuity check,
separate from the intake flag. SIM/Messaging owners must already be actually
ready before the COP guarded deployment. `unavailable` is never an accepted
new health dependency. The existing S2S client receives403 for `/me`; its scope
and allowlist are deliberately unchanged and it is not used by this workflow.

After enable the same actual owner and runtime checks repeat. Success prints
`phase=production_release_complete`, `releaseComplete=true` and
`erasureEnabled=true`; `accountDeletionPerformed=false` and
`wholeAccountComplete=false` make clear no actual account is deleted by this
installer. The separate full synthetic whole/restore acceptance remains
mandatory. Missing readiness produces `production_release_pending`, a concrete
stage/code and no enable. A post-enable failure attempts the exact guarded
pause path; if pause cannot be proven, `erasureEnabled=null` reports uncertainty
instead of falsely claiming intake is off. A failure after provider rotation
also reports `temporaryMediaUnavailable=true` until the guarded candidate uses
the new credentials successfully; three cached old API health responses alone
do not prove media availability. The guarded candidate performs a real synthetic
write/read and exact S3-version cleanup using its runtime credentials before the
prepared checkpoint and again after enable. Its exact synthetic key is first
recorded in Root0600 `media-runtime-canary.json` for interrupted cleanup. No
previous unguarded image or old-key fallback exists.

Only fixed Root metadata transitions allow retry across separate plan/checkpoint
writes: `media-plan-transition.json` binds the completed actual media receipt;
`control-plan-transition.json` binds only exact active-pointer/operation changes.
Recovery requires the exact old/new plan digests plus current provider/SQL or
protected guarded-runtime readback. Neither record authorizes new rows, model
selection, secret changes or a generic operation. Unknown results remain pending.

The historical profile/session provenance helper may still report a concrete
unresolved scope. In particular, `legacySessions.activeCount>0` without actual
signed-token provenance is pending; this installer does not infer issuer from a
current login, email or an unverified decrypted profile, and does not perform a
global logout or delete the SIM identity. No incomplete metadata/closure result
can produce release-complete.

## Fixed individual entrypoints and inputs

`/usr/bin/node scripts/account-safety/install-production-erasure.mjs --check`
followed by the one fixed absolute plan path performs a real preflight without
creating an acceptance proof. Host Node22 can run it. `--write-proof` performs
the same checks and then publishes the exact protected manifest from runbook27.
Neither operation deploys a container or enables erasure.

The fixed plan path is:

```text
/srv/cop/runtime/account-erasure-install/release-plan.json
```

Root must own the plan and receipt files, mode0600, regular/singly linked.
The plan contains only public release references, never credential values:

| Field | Required value |
| --- | --- |
| `contractVersion` | `cop-production-erasure-install-v1` |
| `sourceRevision`, `imageId` | Exact reviewed40hex Git commit and immutable sha256 image ID. |
| `expectedActive` | The full actual runtime active pointer, including CID/generation/profile. |
| `fileSha256` | Exact fixed source set exported by `REQUIRED_FILES`; no arbitrary command/script path. |
| `wholeAcceptancePath`, `wholeAcceptanceSha256` | Root-reviewed actual whole receipt under this same directory. |
| `mediaClosureEvidencePath`, `mediaClosureEvidenceSha256` | Root-reviewed actual production closure receipt under this same directory. |
| `databaseEnrollmentManifestPath` | Exactly this directory's `database-enrollment.json`, for the existing provisioner. |
| `operation` | `prepare`, `enable`, `pause` or `maintain` from runbook27. |

All paths/digests and the source/image/CID must be filled from actual observations.
A missing pending or fixture-only receipt is rejected. A phase reporting online
cleanup alone cannot substitute for `whole_account_acceptance_complete`.
The whole receipt must truthfully include its source basis `sourceRevision`,
`sourceWorkingTreeDirty`, `compiledApiClosureSha256`,
`runtimeResourceClosureSha256`, `compiledWorkspaceClosureSha256`, fixture dependency
`nodeBaseImageId`, all eleven owners, two real synthetic Keycloak actors, the
provider-call metadata digest, `wholeAccountAccepted=true` and
`productionChanged=false`. `nodeBaseImageId` is not the release candidate.

Every installer mode compares all three closures to actual candidate bytes,
even if the test source basis precedes a final documentation/helper commit.
The release itself retains exact reviewed Git/image/source pins:

- `compiledApiClosureSha256`: every regular `.js`/`.json` file below
  `apps/cop-api/dist`.
- `runtimeResourceClosureSha256`: exactly `docs/api/shared-mobility-v1.openapi.json`,
  `docs/api/schemas/mapped-road-profile-v1.schemas.json`,
  `docs/api/schemas/road-trip-v1.schemas.json` and
  `docs/api/schemas/known-road-closures-v1.schema.json`.
- `compiledWorkspaceClosureSha256`: transitive `@cop/*` production dependencies
  of `apps/cop-api/package.json`; each selected workspace `package.json` and
  every regular `.js`/`.json` below its `dist`. Symlinks are rejected.

Each independent closure sorts its repository-relative paths lexicographically.
Each line is the path, NUL and SHA256 of its bytes; join lines with LF without a
final LF, then SHA256 the result. A label, dirty flag or matching API-only digest
cannot replace these byte comparisons. No test rebuild is required solely for
unrelated docs. Historical partial runs and their source pins are not the final acceptance
receipt. Use only the successful full-provider/crash/retry/restore run and its
actual matching candidate closure bytes. The Root validator also requires
`initialNormal202Verified`, `controlledMainCrashVerified` and
`retryNormal202Verified` to be true and its exact seven-field `messagingSource`
to equal the reviewed v3 scope/profile/archive/provider/client/helper/SQL pins
exported in `EXPECTED_MESSAGING_SOURCE`. Pinning that source does not assert
that a whole run has passed.

The production media receipt has contract
`cop-media-upload-closure-evidence-v1`, `production=true`, exact endpoint
`http://storage.home.cz:8333`, bucket `cop-community-media`, provider image and
actual stop/restart/old-credential-denial timestamps. It must record actual
legacy-writer termination, old-signature rejection, successful new credentials
and preservation of the other identity/bucket. Its timestamps/image are
compared to the independently enrolled current guard closure, not merely accepted
from JSON. No credential value or credential fingerprint is printed.

## Existing Node24 provisioners, without changing host Node

The candidate image contains Node24, the exact `pg8.23.1` dependency and the
reviewed scripts under `/app/scripts`. Use the **coordinator-reviewed immutable
image ID** in `cop_erasure_image`. Do not select a mutable tag.

The following container profile is restricted to this task:

```sh
cop_erasure_plan=/srv/cop/runtime/account-erasure-install/release-plan.json
cop_erasure_image='<reviewed immutable sha256 image ID>'
```

Before the strict PostgreSQL provisioner, normalize only the two observed legacy
duplicate assignments using the fixed host Root mode:

```sh
/usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --normalize-legacy-environment "$cop_erasure_plan"
```

It removes only the earlier of exactly two `COP_DEPLOY_DOMAIN` and/or
`COP_LAB_TOKEN` assignments, preserving last-wins bytes. Any other duplicate or
third occurrence fails. It compares full resolved Compose configuration and the
same actual old CID/profile/pointer before and after. The replacement uses
metadata/content CAS, atomic0600/same-owner publication and a rollback retained
only in RAM; no secret backup is written. A concurrent unknown edit is never
overwritten. It does not rotate a token or restart a service. This mode still
requires the actual successful whole receipt and candidate/source pins.

For the actual PostgreSQL preflight and enrollment, run the host Root entrypoint,
not the inner container command:

```sh
/usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --database-check "$cop_erasure_plan"
/usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --database-apply "$cop_erasure_plan"
```

Each fixed host stage takes the existing X5/storage operation lock for its full
lifetime. Under that lock it checks the exact active pointer, CID/image,
PID/StartedAt, plan/source pins and actual runtime configuration before launching
its one allowed interactive helper and again afterward. Only the exact eight
fields generated by the already approved guard/Keycloak provisioners can differ
from the old running environment during preparation. Unrelated environment,
network, mount or host configuration drift fails before helper launch; intake,
guard-required and scoped-authority flags remain false. This read-only comparison
cannot activate the candidate or replace its separate Root config proof.

The helper uses only the immutable plan image and the fixed database worker or
existing Keycloak installer. It has Node24/`pg8.23.1`, host network, root filesystem
read-only, user0, `cap-drop ALL` plus DAC_OVERRIDE/CHOWN/FOWNER,
`no-new-privileges`, pids64/memory256MiB, existing `/srv/cop` mounted for atomic
`.env` replacement and the existing CA mounted read-only. No Docker socket,
privileged mode, new service/port or arbitrary command is passed into it.
Its container log driver is `none`. Its only password input is the controlling
terminal attached by the host wrapper; passwords never enter a Docker environment,
argument, file or shell-history entry.

After successful database enrollment, the same `--database-apply` stage calls
`prepareBusinessErasureSchema({mode:'apply',password})` before returning. Existing
provisioner database/TLS/first-enrollment/role/identity/disabled-flag/retry checks
remain in place. The schema helper creates only the nine missing tables and two
indexes from the candidate's actual exported content/community/fence SQL. It does
not start the API, backfill historical ownership, grant roles, delete rows or
infer an absent lease table is empty. It verifies actual catalog/owner/privilege,
first-enrollment guard/local bindings and no pending write lease before/after a
short transaction. Missing tables in check mode mean `schemaReady=false` and
`zeroWriteLeases=null`. Existing ownership ambiguity still blocks readiness and
requires factual resolution; empty DDL does not resolve provenance. The actual
successful whole receipt is required before any of these fixed stages.

For the scoped Keycloak preparation, use the same host guard:

```sh
/usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --keycloak-apply "$cop_erasure_plan"
```

This invokes the existing `scripts/keycloak/install-erasure-client.mjs --apply`
inside that exact restricted container while the host lock/CID/source checks
remain active. Administrator credentials are entered only in its terminal.
It preserves the shared SIM identity and leaves erasure flags false. None of
these bounded preparation steps establishes production deletion acceptance.

## Closed release ordering

1. Coordinator verifies/pins the final source, image and successful complete
   shared acceptance; Root stages the fixed plan and actual receipt files.
   Preserve the protected local production deployment-script changes.
2. Normalize only the reviewed legacy duplicates, then execute the bounded
   PostgreSQL/schema and scoped Keycloak steps above while intake
   and guard-required flags remain false. Transfer the reviewed SIM service
   credentials only between their existing production secrets files.
3. Prepare only the final24-key configuration with intake false, then complete
   the reviewed historical provenance under actual paused-writer custody.
   Missing signed session provenance is pending, not an automatic global logout.
4. Perform the separately human-approved actual storage closure procedure:
   pause COP writes, stop/restart the same shared provider image and rotate only
   `cop-production`. Other identities/configuration/data survive. The exact operator below produces the actual receipt and enrolls
   migration011/current closure. A synthetic fixture receipt cannot pass.
5. Verify the exact final `.env` and reviewed Compose merge, retaining intake
   false and selecting the real database guard, existing edge token/internal
   origin, relay, scoped Keycloak and `cop_api` media transport. This is the
   configuration reviewed by runbook27; `.env` changes after it invalidate CAS.
6. Root executes the actual fresh image/profile producer below. It verifies the
   existing accepted profile and candidate before publishing that separate
   normal attestation. It requires no pre-existing candidate attestation.
7. Run the full actual preflight:

   ```sh
   /usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
     --check /srv/cop/runtime/account-erasure-install/release-plan.json
   ```

   It checks source pins, candidate image/source, actual Node24/pg/scripts,
   current independent journal/replay/local jobs and the actual current
   media settlement/S3 versioning. The container readback is read-only, with
   `/srv/cop` and the existing CA mounted read-only and no Docker socket mount.
   Host parity includes the actual old CID, unchanged non-erasure settings,
   mounts/security/networks, existing edge credential and fresh environment CAS.
8. Only after that succeeds, the identical call with `--write-proof` performs
   those checks again and writes the Root-owned0640 manifest. Missing real
   evidence/readback produces `not_complete`; no flags or services change.
9. Execute the reviewed existing immutable deployment with that exact proof
   path, source/image/profile and original generation, as deployment UID1000.
   Root must not run the UID1000-owned runtime journal writer as UID0. Perform
   production synthetic acceptance, then a separate exact `enable` manifest
   and activation. Physical Jízda acceptance remains a distinct final check.

The root proof includes true checks only after the actual pinned whole receipt,
actual production media record/readback and full host parity succeeded during
this invocation. It is not a generic acceptance-flag generator. It does not
claim production TLS was tested by the local fixture.

If any prerequisite is missing, stop before the next step. Do not present
credential preparation or proof creation as whole deletion completion. The
coordinator must provide the final media/secret-transfer/deployment commands
and current pins as one closed release instruction; this draft is not a command
to execute an incomplete release.



## Actual fresh image/profile attestation

After the final `.env` is prepared, and before config proof creation, host Root
runs this fixed operation:

```sh
/usr/bin/node /srv/cop/scripts/account-safety/install-production-erasure.mjs \
  --write-image-attestation /srv/cop/runtime/account-erasure-install/release-plan.json
```

This uses the existing runtime store's normal attestation schema and actual
current accepted profile, not manually prepared `checks=true` JSON. Under the
same X5/deployment operation lock it rechecks exact source/image, the old active
CID/generation, full current configuration and private file metadata. It runs:

- Actual candidate Sharp1x1 conversion and source guard validation.
- Actual fixed X5 UUID/device/mount contract and the candidate conversion guard
  against that real read-only mount; an accepted synthetic conversion reaches
  the intentional read-only write failure, while wrong UUID/device or a missing
  mount fail before writing. No actual X5/media object or metadata is written.
- Read-only profile database probes through the actual approved Unix transaction
  route and existing session routes with `verify-full` CA validation. Each uses
  `BEGIN READ ONLY`; no application startup, DDL or new rights are involved.

Only after the real probes and final unchanged-CID/profile/configuration CAS does
it publish Root:GID1000 mode0640 `attestation-<actual-image-sha>.json` beneath the
existing protected profile. It uses `kind=candidate`,
`acceptedBaselineRollback=false` and null legacy witnesses. It never copies
acceptance bits from an old image. An existing different proof, symlink, file
race or any failed probe refuses publication; cleanup never removes a foreign
replacement. Proof creation leaves the old container running.

Source-level validation included five focused tests for exact route/mount input
validation and actual protected writer custody/CAS races. Separate scoped drills
verified the real guard code against owned RAM fixtures and four actual
production profile read-only database transactions. The final producer reruns
these checks in the actual release image; those drills are not a completed
production release or substitute for full whole-account acceptance.

## Fixed production media closure and secret transfer

The implementation is
`scripts/account-safety/install-media-upload-closure.mjs`. It is source with
twenty-six offline fault tests, not evidence that a production outage has run.
It never creates a Root daemon, modifies the storage Compose project, changes
networks/mounts, clears leases or returns to a previous credential.

After the complete shared test and candidate build are pinned, Root creates
`/srv/cop/runtime/account-erasure-install/media-closure-plan.json`, owned by
Root with mode0600, exact fields:

```json
{
  "contractVersion": "cop-production-media-closure-v1",
  "providerContainerId": "<actual full current Seaweed container ID>",
  "providerImageId": "<actual immutable Docker image ID, not the manifest digest>",
  "otherIdentity": "sim-dem-production",
  "otherBucket": "sim-dem",
  "writerContainerIds": ["<exact release-plan expectedActive.containerId>"]
}
```

The production read-only inventory on16October found shared `seaweedfs` CID
`3ad6e0a4deef1b6105727914f00672a835c00b418afc18af2bc01c77563c6c7b`,
pinned reference `chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5`,
and `/srv/seaweedfs/config/s3.json` mode0600 UID/GID1000. These are observations
for an actual final recheck, not authority to use a changed instance. Pin the
actual `.Image` separately in the Root plan; the script verifies that Docker
image has the accepted reference in `RepoDigests`. The database/receipt use the
actual Docker image ID, not the manifest/reference digest. Its only
COP identity is `cop-production`. `sim-dem-production` has one credential and
access to existing `sim-dem`; its key is read into Root RAM solely for HEAD of
that bucket before/after. The script does not read its objects or change it.

Add this exact script to the release plan's exported `REQUIRED_FILES` source
pin set. The script independently verifies the complete whole-test receipt,
actual candidate compiled closure and both host/image source bytes. The main
release plan's `mediaClosureEvidencePath` must name a new file; a previous
receipt is never overwritten. Its initial digest is not accepted as evidence;
only after actual execution does the stage replace that one public plan digest
with SHA256 of the actual Root-owned receipt. No other plan field changes.

The bounded commands on **docker.home.cz as host Root** are:

```sh
/usr/bin/node /srv/cop/scripts/account-safety/install-media-upload-closure.mjs --check
/usr/bin/node /srv/cop/scripts/account-safety/install-media-upload-closure.mjs --apply
```

The second command is executable only after the first succeeds and the shared
storage outage is scheduled. PostgreSQL administrator authentication is entered
only in its terminal. It is sent to the pinned Node24 helper through process
stdin into RAM; it is never in Docker environment/inspect, a shell argument,
history, artifact or log. The helper disables its own container log driver (`none`) because its private
control stream includes the old short-lived presigned canary URL; that stream
is captured only in host RAM. It has root filesystem read-only, no Docker
socket, only `/srv/cop` and the existing CA mounted read-only, no new port and
`cap-drop ALL` plus `DAC_OVERRIDE` to read existing private production files.

The CLI holds the existing `/srv/cop/.storage.lock` for its full lifetime,
using the same kernel `flock` as deployment and the pinned existing X5 preflight
before/after acquisition. It cannot race the normal deployment. A second fixed
operation lock prevents duplicate closure invocations.

The actual fixed stage does this:

1. Verify the current runtime CID/image, exactly one COP API writer instance,
   disabled intake and existing source/configuration. The same actual DB/session
   route validator used by runtime chooses the current verified TLS session
   route for Unix transaction-pool deployments; it never changes that route.
   Check independent store/incarnation/generation, the whole journal chain and
   current replay/local jobs/configuration fingerprint. Any nonzero persistent
   media write lease blocks the stage; no lease is removed.
2. With the old production credential, create only two small synthetic COP
   canaries under random `community-reports/<uuid>/<uuid>/closure-*.txt` keys.
   HEAD the existing other bucket, then `docker pause` the exact original COP
   API CID. This preserves its initialized process and RAM state. Start one
   actual old presigned1MiB request and withhold all but64KiB after100Continue.
3. Through pinned-host SSH, storage Root verifies the exact existing provider
   CID/image/arguments/mounts and current configuration in RAM. Stop that same
   shared container and verify `Running=false,Pid=0` and termination of the
   admitted incomplete request. This is a real provider stop, not a pause.
4. Generate the new key in RAM and atomically replace only the two COP media
   credentials and `COP_MEDIA_UPLOAD_TRANSPORT=cop_api` in existing
   `/srv/cop/.env`, preserving owner/mode and all unrelated bytes. Transfer that
   credential through SSH stdin to replace only `cop-production.credentials`
   in the existing storage secret file, preserving owner/mode and all other
   identities/actions/configuration. No credential backup or Git file exists.
5. Start the **same** provider CID/image, recheck its complete container spec,
   verify the unexpired old signature returns403, new credential PUT/read,
   survival of the second synthetic COP object, existing other-identity bucket
   access and unversioned COP bucket. Enumerate bounded `ListObjectVersions` for each exact synthetic key; reject
   any prefix neighbour, truncated or ambiguous inventory. Delete each exact
   version/delete-marker by its explicit `versionId`, then require a fresh empty
   listing and HEAD404. No crosstalk or source/bucket guessing is accepted.
6. Still with COP paused, the pinned Node24 helper uses the entered PG admin
   password and fixed migration011. It checks actual ownership, immutable
   triggers and SELECT-only runtime privilege, locks the same content admission
   transaction and independent journal, rechecks empty leases/current binding
   and frontier, then inserts the one immutable closure. Exact new/old credential
   fingerprints stay only in RAM/independent DB, and the receipt digest is read
   back. The normal Root producer later compares the actual receipt bytes with
   that independently stored digest as well as provider timestamps/image.
7. Unpause that exact original COP process, without rerunning its old
   `media.init()`. It retains an unusable old credential for the brief remainder
   of the release and cannot issue a valid new external presign. Actually check
   its `/health/live`, `/health/ready` and `/health/dependencies`; all must be200.
   A failure produces no complete media receipt or activation proof. Finish the
   candidate deployment promptly with new server-only `cop_api` credentials.
8. Only after those readbacks publish the Root0600 production receipt and
   update that receipt's SHA in the existing Root plan by CAS. This is media
   closure completion, not whole-account activation. Normal fresh image/profile
   attestation, final config proof, deployment and production acceptance remain.

If anything fails, the stage prints a fixed error code, never subprocess logs
or secret values. It does not restore an old credential, force-start an
uncertain provider or age/delete an unknown lease. Before attempting provider stop, or after successful actual provider verification,
cleanup can unpause only the original COP process after rechecking provider
spec/configuration. A failed/unknown stop or verification leaves it paused for
Root review. Do not repeat a
partial outage blindly: inspect the same CID/process and both existing secret
files in RAM, restore service only with the new matching credential, and retain
all independent fences. A new actual closure run can be reviewed if necessary;
no pending result authorizes account deletion. Synthetic test objects from a
failed or interrupted canary step must be identified by their exact generated
keys before cleanup; there is no bucket-prefix deletion.

## Preserve the protected production deployment script

Build the release candidate from the normal verified `/srv/cop` checkout before
Root enrollment or `.env` changes. `--build-only cop-api` uses the existing
`cop-x5` builder; it does not depend on a media/config activation proof or a
separate Root-only external build context. Final runtime closure comparison
then binds that actual immutable image to the successful whole test.

Before changing the production checkout, invoke the existing X5 preflight and
verify UUID `2f93f595-b61b-4eea-9054-7afa9b275b5b`. Archive only the actual
modified `scripts/deploy-production.sh`, its base from the current production
HEAD and their SHA256 under a protected current-release directory in
`/srv/x5-production/archives/cop`. Do not copy `.env` or credentials there.
Perform a three-way `git merge-file` using modified host file / host HEAD base /
reviewed target release. The result must be conflict-free and byte-identical
to the reviewed target, or separately reviewed as an exact merged artifact.
The read-only observed host HEAD was
`f84fe6f6177d70a533620ea86dd154376bfe7c3a`, with only that tracked file modified.
Verify that again at release time. No reset, force checkout or silent replacement
of the operational patch is part of this procedure.

## Recovery and test limits

Post-guard operational return is intake `pause` while retaining the guard-capable
image, fences and pending jobs. An unknown media write remains pending. Never
return to an old unguarded image or restore the independent journal together
with business data. Use runbook26 for quarantined restore/replay.

Forty-three Root-producer offline tests cover the exact schema, fixed source and
receipt paths, source/owner completeness, pending and wrong-build rejection,
actual media facts/time order, all three canonical runtime closures, embedded
Python syntax, the two-key normalization byte/CAS/rollback boundary and fixed
DB/Keycloak host-stage lock/CID/PID/source/environment fault rejection, fixed
completion order, fresh actual owner-readiness/response/CID validation and honest
unknown intake state when pause cannot be verified, finite fingerprint-seal
recovery, exact media/control-plan transitions, deployment-success crash
recovery through its protected predecessor and interruptions after configuration,
provenance, media, proof or deployment. The five
image/profile tests, twenty-seven media-closure fault tests and five existing-profile transport tests are separate (80 total targeted Node tests).
These tests do not execute a production Root operation, storage closure or proof
write. The business schema helper additionally passed twelve tests on an owned
real PostgreSQL18.6 fixture, including actual lock-timeout/transaction rollback,
lease preservation and catalog/role/binding drift. The real old-API pause/media
regression is recorded in
`docs/testing/account-erasure-old-api-media-pause-20261016.json`; it proves the
same initialized API process survives provider rotation and keeps all three
health checks200, while its cached old key returns403. It does not claim that a
production rotation or final deployment has already occurred.


## Storage transport decision before any outage

Read-only checks on16October established:

- Existing Mac → `storage.home.cz` authenticates as UID1000; `sudo -n id -u`
  returns0 without a prompt.
- Existing docker-host UID1000 → `storage.home.cz` fails public-key/password
  authentication in BatchMode. No storage command or sudo operation ran.
- The operator subsequently checked hostRoot → storage using the already verified
  ED25519 record; authentication was denied. This did not create an alternate
  key, change known-host trust or execute a storage operation.

The complete-release preflight first opens one existing-account SSH master
**on docker.home.cz itself** from its operator terminal. SSH, not Node, reads
the existing `voldzi@storage.home.cz` password from `/dev/tty`, at most once. It
uses the already verified ED25519 public host record, strict host checking,
password-only authentication and a new Root0700 `/run/cop-storage-transport`
directory with one local control socket. No SSH key, authorized_keys entry,
agent forwarding, new right, public listener or cross-host socket proxy exists.
`ControlPersist=15m` is an idle timeout, not a replacement for cleanup.

The initial fixed remote command must return exact UID0 through existing
`sudo -n`; then the **same fixed actual storage inspection** verifies Root,
hostname, provider CID/image/mount/configuration and current COP credential
binding before any production or Root-checkpoint mutation. The later mutation
stage separately requires the actual sole COP writer CAS. An `id -u` check by
itself is never accepted as a provider proof.

All subsequent fixed remote commands require the same local socket and existing
user, `ControlMaster=no`, BatchMode and `ProxyCommand=/usr/bin/false`; a lost
master cannot reconnect through another authentication method. Exact owned
socket/directory identity is checked before/after. Normal completion, failure
and interruption close that master and remove only the owned temporary paths.
A replaced foreign socket is not removed or used. Offline fault tests cover the
actual argv, rejected password/sudo output, cleanup and replaced-socket case.
No actual password login or production storage change was performed by those
tests; the operator must prove that the existing password and sudo still work.
If they fail, the command stops before normalization, DB, Keycloak, provider
outage or token rotation and asks for no alternate delegation automatically.

A ControlMaster socket forwarded **from the Mac** is not a working alternative:
new multiplexed sessions need `SCM_RIGHTS` descriptor passing, which stream-local
forwarding cannot transport. Its alive check would be insufficient. No such
forwarded master, forced-command key or new delegation has been created.


## Existing runtime-profile routes for the one-shot operators

The production host `.env` has no lease or stream-session DSN. The accepted API
profile supplies them; its main database route also differs from the host
configuration. The database readback, business-schema, legacy-provenance and
media-closure factories therefore use `operator-profile-environment.mjs`. It
reads only the existing protected `runtime.env` selected by the exact reviewed
`expectedActive.profileGeneration`. These are operator-carrier read-only binds,
not additional production API mounts.

Before and after each fixed carrier, the host under the existing storage lock
re-reads `Store.profile()`, compares its three routes and pool mode with the
actual active container environment, and verifies the full active pointer, CID
and profile-file metadata. The media stage inherits the already held storage
lock descriptor; no carrier receives the Docker socket. Only the three profile
routes enter operator RAM. Guard authority, guard DSN and secrets continue to
come from the existing production `.env`; no configuration key, route, TLS
setting or production file is added by this transport.

The active-pointer CAS `generation` is a32hex release generation. The separate
`profileId` and `profileGeneration` select the same existing UUID directory;
they must not be compared with the active CAS generation. Tests include the
actual observed formats. The read-only host parser applies the same finite
last-wins interpretation as the normalizer only to the two reviewed duplicate
keys `COP_DEPLOY_DOMAIN` and `COP_LAB_TOKEN`, with exactly two occurrences each.
Other duplicates or invalid syntax fail. Parsing itself does not write or
normalize `.env`, and no route value or secret-derived digest is printed.


### Fresh provenance versus a live legacy writer

A row inventory gathered while the old API runs is not a final enrollment plan:
new sessions and other writes can make its full-row CAS stale. The final Root
sequence must prepare a fresh private candidate while the exact sole writer is
paused under the existing storage lock, verify the original signed session
claims, show only category counts and the candidate digest in the operator
terminal, and obtain explicit Root confirmation of that exact digest. Apply and
actual readback must use the same paused writer and unchanged candidate; no
automatic row rehash or history approval is permitted. The existing unpause
occurs only after that readback. The fixed completion flow implements this
sequence through `LEGACY_FRESH_HOST_STAGE_PROGRAM`; its pure candidate/TTY
fault checks pass, while the new generator still requires its actual isolated
integration evidence. A static pre-staged row plan cannot substitute for this
stage or its actual production checks.

The media stage retains its separately tested pause/closure/unpause sequence,
then immediately rolls forward to the guarded image. The old API may create a
new row or session between these stages. Final actual owner-readiness before
enable must reject any new unowned data and keep intake disabled; that outcome
is pending, not a successful one-shot release. Never bypass the existing live
health gate or silently regenerate a new enrollment plan to hide this race.

The private legacy host receipt retains `sqlEnrollmentReceipt` as the unchanged
raw SQL apply result. Host custody fields and `provenanceComplete=true` belong
to the outer wrapper. Recovery passes only the original nested SQL object to
the strict verifier; it never reconstructs a receipt by rewriting completion
flags. A missing original raw receipt remains unproven.

The fresh stage writes `legacy-provenance-candidate.json` privately and, only
after the exact terminal confirmation, `legacy-provenance-review.json`. The
review binds the policy, candidate, source/image, full active pointer and actual
paused-process witness. A restart or changed candidate invalidates it. A crash
during publication can only complete that same previously confirmed candidate;
it cannot silently generate or approve a replacement. Once the final plan hash
is recorded, a row-CAS failure remains pending and never causes automatic
regeneration. The original raw SQL receipt is persisted after actual readback
and before unpause.

After SQL apply returns, the unchanged original receipt is immediately stored
as private `pending_readback` evidence before invoking the separate verifier.
A transient verifier or host-readback failure therefore leaves a recoverable raw
receipt; a retry runs read-only verification and does not repeat encryption or
apply. Only actual verifier success and unchanged host custody atomically
promote that same receipt to complete. The Root review also retains the actual
guard/local SQL binding digest, compared with schema preparation and subsequent
apply/readback; it is not a hash of declared policy fields.

If apply has started and its receipt/readback is not fully verified, the exact
writer remains paused. The final report explicitly includes
`temporaryApiUnavailable=true` when the read-only host inspection confirms this
state. On the next fixed invocation, only the exact Root pending raw receipt,
review, source, active tuple, profile, PID and StartedAt can select the existing
read-only SQL verifier. Successful verification persists the completed receipt
first and only then unpauses the same process. Standard live, image and health
gates run afterwards. Unknown/missing proof stays paused with intake off; there
is no inferred recovery, reapply, new row hash or deploy-health exemption.

The actual PostgreSQL regression for this verifier retains the exact original
signed-session receipt, removes the fixture JWKS keys and proves that read-only
verification preserves the encrypted session bytes. An additional active
unowned session is rejected while the original ciphertext remains unchanged
(`enroll-legacy-erasure-provenance.test.mjs`, test "verifies unchanged
signed-session ciphertext by digest and blocks any additional active unowned
session"). This is included in the60 isolated legacy tests; no extra production
read or account change is represented by that test.
