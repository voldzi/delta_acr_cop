# Account safety runtime guard binding

## Current database_v2 first-enrollment helper — 16 October 2026

The current completion path is **database_v2**, as selected in
[ADR0055](../adr/0055_DATABASE_ACCOUNT_ERASURE_RECOVERY.md). The native sections
below are historical source qualifications, not prerequisites to revive or
evidence for database_v2. This helper is source-only; it has not been applied to
COP production and does not establish whole-account acceptance.

`scripts/account-safety/provision-database-v2.mjs` supports only an explicit
administrator's **first empty enrollment** and exact retries of that same,
still-empty enrollment. It is not an upgrade, restore enrollment, history reset
or runtime auto-enrollment tool. Any job, fence or progressed replay cursor is
rejected without repairing or deleting it. It leaves `cop_guard`, SIM's separate
guard schema, existing roles, business connection configuration, public ports,
network and authentication rules unchanged.

The administrator must provide a private mode0600, non-symlink manifest with
contract `cop-database-safety-provision-v1`, `firstEnrollment=true`, explicitly
reviewed `applicationStoreId`, `incarnationId`, separate logical `guardStoreId`,
`restoreGeneration=1`, initial chain digest, PostgreSQL CA digest and the
`cop-existing-router-identity-v1` binding. Its evidence digest must agree with
the outer `identityEvidenceDigest`; its issuer and domain-separated fingerprint
must match the existing Router identity key. An evidence digest is a reference
to a real alias/key-history review, not a randomly generated substitute for one.
The initial digest is only a new chain seed, not evidence of historical replay.

Only the following roles are created, in the existing independent
`cop_account_safety_guard` database:

- `cop_safety_v2_owner`: NOLOGIN, no superuser/role/database/replication/bypass
  rights; owns only the new `cop_safety_v2` objects.
- `cop_safety_v2_runtime`: LOGIN, connection limit8, no memberships or elevated
  attributes. It can connect, use the new schema, SELECT its three tables,
  INSERT fences, execute the append trigger function and UPDATE only
  `dataset_replays.replay_sequence,replay_digest`. It cannot change configuration,
  identity/incarnation/generation, delete/truncate history, create objects or
  read other applications' guarded data. Unexpected effective access, including
  via PUBLIC, is refused rather than globally revoked.

Before an administrator password is requested, the coordinating installer must
run the credential-free `--dependency-check` under a fixed Node24 environment.
It requires the declared and resolved `pg 8.23.1` packaged from COP's dependency
closure; no runtime installation or `NODE_PATH`/`NODE_OPTIONS` injection is
accepted. The only credential-bearing CLI forms are `--check --manifest <path>`
and `--apply --manifest <path>`, invoked by the reviewed Root coordinator with
the password supplied only in process memory. Do not place it in argv or a
third secret JSON. Production uses only `haproxy.home.cz:5000` and the existing
pinned PostgreSQL CA with actual hostname verification. The business database's
existing Unix route is not rewritten.

Apply holds the actual mobility advisory lock and a SHARE ROW EXCLUSIVE lock on
`cop_mobility_v1`, then rechecks both metadata keys and the absence of jobs. It
holds the independent guard transaction lock before creating/verifying the exact
SQL010 schema, functions, constraints, triggers and least privileges. Existing
`COP_SIM_ERASURE_ACTOR_SECRET` and `COP_AI_CHAT_ROUTER_USER_ID_SECRET` are
preserved byte-for-byte. A new `COP_ACCOUNT_ERASURE_SECRET` is permitted only
when exactly absent, explicitly allowed by the manifest and confirmed against
the locked empty metadata. Existing keys are never rotated by this helper.

New credentials and the exact bindings are atomically persisted only to the
existing private `/srv/cop/.env`, before the independent guard commit; business
metadata is committed afterward while its locks remain held. Known interruptions
at these boundaries can retry only the exact original manifest and credentials.
Unknown or changed partial state is refused. No activation flag, authority mode
or running container is changed. A `complete_disabled` result is a bootstrap
receipt, not a claim that erasure or restore acceptance is complete.

The initial local version4 configuration includes `datasetBinding` with this
manifest's incarnation and restore generation. Runtime SQL readback requires
that same independently enrolled binding. A normal restart preserves its
completion state. After any affected owner restore, an explicit new global COP
incarnation/higher generation must invalidate old completion checkpoints and
force every real owner to be checked again before exposure; this first-empty
helper cannot perform that nonempty restore transition. See ADR0055. The
original 28-case helper receipt below is frozen; the later dataset-binding
source qualification is recorded separately.

The isolated PostgreSQL test harness is
`scripts/test-account-safety-database-provision.mjs`; its immutable execution
receipt is [the 16 October test evidence](../archive/2026-10-16_COP_GUARD_ADMIN_PROVISION_TESTS.json).
The final run passed **28/28** cases. It uses a newly owned local PostgreSQL18 cluster and synthetic data, not
production. Its constructed interrupted durable states do not simulate network
packet loss or a production restore. Standard PostgreSQL credential-log checks
do not constitute testing of an absent third-party audit extension.

For return before activation, keep erasure disabled and the already accepted
compatible application path. Do not delete the new independent evidence, reset
identities or reinstall an old writer after acceptance. Any later changed
incarnation, restore generation or nonempty history requires its separately
reviewed restore/upgrade procedure and real replay/readback before exposure.

## Historical native source proposal and qualifications

Status: source-only candidate reviewed; not installed or authority-bound in the
production native deployment helper; activation blocker.

15October source update: the real original SQL executor, signed outcome
publisher and private Node-API/SEQPACKET broker/client are now implemented in
[scripts/account-safety](../../scripts/account-safety/README.md), with bounded
actual local Linux and PostgreSQL tests. Older descriptions below of an absent
producer/transport record their earlier review boundary. Actual Root enrollment,
current-frontier and permit/inventory producers, read admission, per-request
delivery, full owner drain/replay and target installation remain unaccepted.
This update neither installs a service nor approves Root authority.

The subsequent15October implementation adds the actual independent COP
journal-before-fence, minimized pseudonymous recovery metadata, a fixed paginated
continuity client, an expiring RAM barrier and the driver read client/broker.
See [ADR0054](../adr/0054_INDEPENDENT_PSEUDONYMOUS_ERASURE_JOURNAL.md) and
[the current minimized SQL evidence](../testing/account-safety-fence-journal-minimized-20261015.json).
SIM's actual read-only SQL/Root reader is published at
`f85d2bbc294845edf412a8a18f9e3138fcc25968`. Its14PG facts and15LinuxRoot/TLS
cases are a different gate, not a combined production test. Actual Root
enrollment, per-request destructive/retention delivery, complete owner replay,
native deployment latch and installation remain required. The production SSH
account currently has no noninteractive sudo authorization; no Root service or
new LOGIN/grant was installed by these source checks.

On 2026-10-14, the human explicitly approved and the infrastructure owner
created only the empty `cop_account_safety_guard` root metadata database on
the existing PostgreSQL/Patroni primary, using migration SHA-256
`a29369e48a1380bb12ce3b40b9254d924e0d98a3b90f7cdcdc0fb7e9ba27aaba`.
Actual postconditions verified nine empty tables, seven restricted NOLOGIN
roles, exact object/column/function grants, no new membership or LOGIN, and
unchanged existing role attributes/membership. The first attempt stopped after
creating the closed database; a pinned continuation completed the same object
without repeating creation. No identity was enrolled, key/service/socket/mount
created or application pointed at this database.

This database is the independent root metadata registry. It is **not** the
application's `AccountSafetyGuardStore`: the permanent per-principal COP fence
must stay in the actual mobility store and the same transaction as its writers.
Do not change `COP_DATABASE_URL` to the empty root metadata database or infer
readiness from its existence/emptiness. Source-pin and receipt review are in
[the bounded foundation evidence](../testing/account-erasure-foundation-20261014.json).
Native transport, independent continuity, actual owner evidence and application
binding remain unaccepted. The infrastructure owner also identified an existing
local administrator `trust` authentication boundary; it was not changed under
the database-only approval and requires a separately scoped decision before
this becomes a trusted runtime authority.

Before accepting the first account deletion, infrastructure must bind a stable
UUID in the actual guard database to a root-owned runtime profile and exact API
image/source revision. The application cannot provision or approve this identity.
The profile must preserve the dedicated existing erasure key, configured issuer,
permanent tombstones, checkpoints and restore replay. Configured communication
and historical unlink guards/retention also use the independent safety store
when mobility intake is off; missing required domain configuration fails closed. No new production key or
permission is generated by this source change.

The native helper must check the protected declaration before deploy, finalize,
recover and rollback. After first acceptance it must reject missing declarations,
RAM fallback, a different/missing durable store ID, unsupported source/images and
an absent guard, including when all intake flags are off. It must verify effective
configuration and record only fixed public pins/outcomes, never DSNs or secrets.
A trusted restore must replay fences before exposing account APIs.

Minimum declaration metadata: contractVersion=account-safety-guard-v1,
protectedConfigId, guardStoreId, API image digest, source revision, guard contract
version and requiredAfterAcceptance=true. Approval must come from the existing
root-controlled attestation path; a string in `.env` is not approval. Actual
helper implementation, permissions, tests and accepted activation/rollback image
set remain outstanding. The legacy helper SHA starts 49ca96be and cannot claim
these checks.

COP's bounded production file readback on 2026-10-14 confirmed that
`/srv/cop/scripts/cop-api-runtime.py` matches exact source SHA-256
`49ca96be6982704d6e5ef16a0c722f59eebc40e310a28e29564e8c75645c89cb`.
The observed file is uid1000/gid1000/mode0644. Byte equality does not establish
root-controlled custody, an independent latch or native account authority.

The separate frozen 16-case synthetic deployment model checks a pending
operation UUID and membership in approved image/source pairs. It does not prove
an immutable target: with two approved guarded pairs, the same UUID can select
another target. Its original receipt remains unchanged and cannot be cited as
retarget rejection evidence. The actual native patch must require an independently
accepted immutable intent bound to the exact operation, target release, image,
source, profile, application store and registered body. Recheck this same intent
before exposure/restore, pointer commit and pending cleanup in every activate,
recover and rollback branch. A mismatch stays pending and performs no new effect;
it must not select another approved pair or mint a replacement permit. Add the
small two-target regression against the versioned native source, rather than
retrospectively upgrading the frozen model's coverage. This requirement changes
no production helper and creates no authority or installation permission.
Legitimate rollback needs its own exact action binding to the original pending
operation/target and the independently accepted previous destination. Preserve
the original pending target; an approved-pair list cannot choose that destination.

The separate native source candidate revision 2 (`dbdcd64a…acd064`) was
independently reviewed against exact baseline `49ca96be…45c89cb`; the pinned
source review is `253d9544…ddea95`. The qualification and exact pins are in
[the independent source-only review](../testing/account-safety-native-candidate-review-20261014.json).
No concrete P1/P2 defect was found in the inspected change. The **19/19** result
is the author's dedicated synthetic-file/FakeDocker run, not a reviewer rerun.
The candidate preserves the original pending operation/new target/previous
during an exactly bound rollback, checks completed pointer readback and keeps
unknown evidence. Its default authority denies; mutating CLI commands stop
before `cop-storage.py` import. Actual authority, custody, installation and
store/replay/restore acceptance remain unverified; this source review grants no
production permission.

### Driver maintenance source selection

COP's 14 October response selects one concrete source design for joint SIM/infra
review, recorded in [the source decision](../testing/account-safety-driver-source-decision-review-20261014.json).
This is not an accepted native ABI, policy, installed SDK or runtime authority.
The internal V2 context carries the full immutable origin; the proposed measurement
store origin channel registers a durable original transaction, serializes its fixed
executor with the Root-owned resolver/sealer, and commits both DELETE/cascade
effects with its protected marker.
Existing or uncertain origins permit probing only. A seal proves no effects
only with a non-bypassable execution gate covering every original path; metadata
or an application if alone cannot establish that. Marker absence is not abort.
The existing direct DELETE privilege on all four tables is a concrete bypass: the
source candidate must close it and preserve legitimate revoke/erasure through
bounded owner functions. The SQL fixture reviews the immutable xid8 claim;
the actual Root-controlled origin/control producer and operation-delivery patch
are not implemented or tested. Infrastructure has received these source inputs
for later review. Receipt of inputs is not an active execution channel.
Exact-origin effect quiescence is distinct from a synchronous connection release
and from complete owner-wide drain/replay.

The selected minimum is a one-shot Root-delivered operation with
`init/runOnce/close`, without the current periodic start. The fixed COP namespace
expiration plan requires an independently accepted all-scope no-retain/report
protection decision covering receipts, revocations, intervals and ETA, including
historical routing datasets. If that decision cannot be accepted, the plan stays
denied; selective filtering requires a different store-owned plan.

The proposed carrier is an in-process Node-API addon using SEQPACKET and
per-message kernel credentials/pidfd on both sides. Linux6.12 pidfs matching is
a source inference requiring actual target tests; no STREAM or peer-credentials-only
fallback is selected. Current registration/grant, fixed execution custody and
Root operation delivery remain separate unimplemented gates. No continuous
process/executable liveness proof through external SQL COMMIT is required.
Actual store/schema, restricted routines, five-method V2 ABI, consumer/producer,
keys, grants, independent anchor and restoration remain unaccepted. This source
selection performs no migration, allocation, installation or production change.

### Concrete owned PostgreSQL source candidate

The selected mechanical database portion now has a pinned
[SQL/test source patch](../testing/fixtures/driver-retention-sql-b0-20261014/SOURCE-PATCH.patch)
and [bounded review](../testing/account-safety-driver-sql-candidate-review-20261014.json).
Owned PostgreSQL18.6 fixtures passed **9/9** cases and a separate **1/1**
outer-control-transaction qualification. Parent COP reviewed the SQL and all
source/evidence pins; it did not rerun or add these cases to previous suites.
The candidate closes direct runtime DELETE/journal/role paths and checks the
original xid8, backend and start under the same executor/sealer lock. The
marker shares all four expiration effects. New transactions cannot reuse a
rolled-back claim; a durable seal denies a still-live delayed original.

A SQL function's terminal JSON remains an observation until actual outer
control COMMIT and fresh readback. The separate test showed that rolling back
that control transaction leaves the original free to execute; no terminal may
be published early. Exact-origin closure does not prove physical connection
termination or complete owner-wide drain. The ACK-loss case deliberately ignored
the controller's COMMIT response and is not a network packet-loss experiment.

Both owned containers/tmpfs fixtures were removed; Docker volumes remained29
before and after, with no ports, binds, volumes, network, pull/build/install,
context change or prune. The first startup failure is retained separately.
These simplified fixture tables/LOGIN roles are not a production migration.
The contributor revocation seam lacks actual current guard/admission and its
journal hash needs privacy/retention acceptance. Actual Root connection/custody,
SDK/native producer/delivery, policy/schema/refs, continuity and restore remain
unaccepted. SIM source and production were not changed by this fixture work.

### SIM compatibility with actual schema sources

SIM published `79acd91795902081558d95431a88d73fa81c5b6e` with the fixed expiry
candidate over unchanged `schema.sql` plus migration002. Its owned Unix-only
PostgreSQL18.3 run passed **11/11** cases with zero provider calls and removed
its cluster. COP read the complete SQL/harness/schema sources and verified all
four current pins and the proof digest; no cases were rerun or added to earlier
COP/SIM totals. The [bounded review](../testing/account-safety-driver-sql-candidate-review-20261014.json)
records the inputs and qualifications.

The fixture preserves actual FK cascades, original table ownership/receipt
guard and exact permanent erasure evidence. Its expiry origin has no contributor,
account/day, manifest or GPS columns. The author's during-run unchanged-source
check covers the three SQL inputs; the harness hash was captured at completion.
This establishes compatibility with those schema sources, not the installed
production schema. It implements no live writer/provisioning transition, native
Root connection/delivery, accepted policy, store continuity or actual restore.
Do not install it while those gates remain unresolved or remove existing
physical cleanup without an accepted replacement.

### Coordinated measurement privilege transition

The [source boundary review](../testing/account-safety-driver-role-transition-review-20261014.json)
pins the actual SIM writer/provisioning sources and current COP HTTP boundary.
SIM provisioning both grants and verifies broad SELECT/INSERT/UPDATE/DELETE on
all four tables. Its grant and verification must change together with the actual
consent-revoke and account-erasure paths, which currently issue direct receipt
DELETE under their existing locks and guards. Removing DELETE first would break
legitimate removal. Bounded owner functions must preserve those locks, current
intake/fence checks, immutable operation manifest and both receipt cascades.
Receipt UPDATE must be limited to the actual writer field; no generic UPDATE
policy is inferred from the simplified fixture.

Do not import the contributor-revocation fixture seam. Besides absent real
admission/locks and unaccepted contributor-linked journal retention, its CHECK
allows a NULL contributor through SQL UNKNOWN; the target NOT NULL later
rejects the operation. Historical SQL/proof pins remain unchanged and do not
establish production revocation correctness.

Current COP account-erasure HTTP handling already keeps 503 or service-permission
failures unavailable/pending and preserves the original UUID/accepted manifest.
Existing tests cover the shared client's failed statuses, immutable accepted
retry, and service 403-to-503 mapping; this read-only review ran no new tests.
The legacy `DELETE /contributions` carries no operation UUID and retries the same
contributor-day DELETE. Its pending day clears only after a valid `200` receipt.
That HTTP behavior is not proof of the internal Root origin/probe-only contract;
SIM must enforce original-origin settlement inside its new execution path.
Missing role/function must never be labelled `DRIVER_CONSENT_REVOKED`.

This is source coordination, not actual production ACL/schema inspection,
migration, grants, native installation or restore acceptance.

Application configuration proposals (all disabled/empty by default):

- COP_ACCOUNT_SAFETY_GUARD_REQUIRED: retained after first acceptance;
- COP_ACCOUNT_SAFETY_STORE_ID: UUID independently prepared in the actual store;
- COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION: account-safety-guard-v1 only after the
  native owner validates the protected profile.

The guard-only pool is registered as mobility with max=1 and has no Dispatch
lease. Reusing an enabled mobility store does not add a pool. The guard-only
profile needs its own reviewed budget and exact readiness/witness; do not reuse
current production main=53 evidence as proof for this alternative configuration.

This document is a concrete infrastructure proposal, not a deployment receipt.

## Read-only managed backup catalog — 16 October2026

The fixed Root inventory collector `scripts/account-safety/inspect-backup-catalog.py`
queries only VM101/104/108/111/112 metadata through the existing Proxmox API.
The actual run found three PBS backups each and zero additional VM snapshots.
It emits no backup volume identifiers, names/descriptions, credentials or content.
It was passed through SSH stdin, not installed as a scheduled service, and makes
no retention, permission or restore change. Its JSON is operator evidence only;
it cannot be treated as a runtime authority or accepted `backup_restore` owner.
The previously human-confirmed off-server/X5 coverage is not re-requested.
See [the source-pinned receipt](../testing/account-erasure-backup-catalog-20261016.json).
