# Root driver origin executor

This is a real, separately privileged SQL executor component. It is **not yet
installed or connected to either application**, and is not the whole account
erasure/restore authority. No production activation follows from these files.

## Fixed entry point

`executeRootDriver` is invoked by the fixed Root broker with its actual native
receiver peer. It accepts one transient UTF-8 body, at most16,384bytes, or probes
the original operation. It requires real/effective UID0 plus the current common
owner's exclusive lease. The former direct CLI has no authenticated receiver
peer and now remains unavailable; it cannot bypass the common guard. Callers
cannot select a database, SQL, XID, backend PID, credentials or file path.
Nothing is installed setuid; there is no application subprocess-to-Root bridge.
There is no periodic scheduler or implicit retry of effects.

The fixed installation layout is:

| Path | Meaning |
| --- | --- |
| `/opt/cop-account-safety` | Root-owned ordinary-file code and `pg` dependency tree; checked before privileged import |
| `/etc/cop-account-safety/root/{registry-probe,driver-control,driver-executor}.json` | Private Root database profiles, never supplied by an app |
| `/etc/cop-account-safety/public/{verification-keys.json,postgres-ca.crt}` | Protected Ed25519 keyring and fixed database TLS trust |
| `/var/lib/cop-account-safety/operations/<uuid>.json` | Signed immutable original operation permit |
| `/var/lib/cop-account-safety/evidence/<uuid>.json` | Signed, operation/store/schema-bound owner evidence |
| `/var/lib/cop-account-safety/authority/current-frontier.json` | Signed current frontier, at most 30 seconds, bound to actual machine boot and database cluster/timeline |
| `/var/lib/cop-account-safety/authority/signing-key.pkcs8` | Private Root-only Ed25519 signing key |
| `/var/lib/cop-account-safety/dispatches` | Private durable one-shot dispatch and revoke scalar observations |
| `/var/lib/cop-account-safety/{publication,outcomes}` | Private signed publication evidence and terminal results |

Directories must have Root custody through their full parent chain; private
state directories are0700, private files0600. Symlinks, hard-linked files,
writable parents and application-owned code/dependencies are rejected. The
component neither creates credentials/roles/keys nor enrolls/approves evidence.
It requires database TLS with certificate and server name verification.

## Input and effect boundary

The signed permit contains a `cop-driver-origin-v1` operation with exactly:
`operationId`, `storeIncarnation`, `permitId`, `kind`, `bodyDigest`,
`schemaDigest`, `cutoff` and `contractVersion`. Kind is `expire|revoke|erase|ack`.
Cutoff is canonical UTC milliseconds for expiry, otherwise null. Body hashing
uses PostgreSQL `jsonb::text`, never a JavaScript JSON serialization hash.

The executor uses SIM source `6df9d35301e6e92e54cc1e8af46354b0fefbecb7`,
specifically migration003 SHA256
`e3513a983a3b6d1bd52d46851c734dd1c3b208e2e2f6430a6f9eddd38b10d3b5`.
It uses the fixed `register_origin`, `claim_origin`, `execute_origin` and
`resolve_or_seal` functions. An actual Root executor connection supplies the
original XID8/PID/backend start. Effects and the marker share that transaction.
The Root dispatch record is fsynced before registration/effects.

Results use `cop-driver-origin-result-v1`:

- `pending` with a fixed safe reason is not completion or a user rejection.
- `origin-commit-known` requires control COMMIT and fresh exact-origin readback.
- `origin-no-effects-closed` requires the same outer commit/readback, not merely
  an inner SQL return, marker absence, connection close or cancellation.

Every previously dispatched or uncertain operation is probe-only: no new UUID,
cutoff, permit or DELETE. A missing/unavailable origin stays pending. This
conservative state can require operator recovery; no automatic re-enrollment
or replacement operation is implemented.

For `revoke`, `revokeEffect: { deletedBatchCount: <nonnegative safe integer> }`
comes only from the actual original `execute_origin` response. A Root-only
immutable observation is fsynced **before** executor COMMIT. It is exposed only
after committed-original resolution, including after a restarted producer
reads the same observation. A missing scalar on a known commit must be503 in
the SIM HTTP owner: never infer zero, count current rows or repeat DELETE. A
storage failure before COMMIT rolls back; unresolved COMMIT stays pending.
Neither a no-effects result nor an unresolved result carries this scalar.

After current authority is rechecked, two typed Ed25519-signed outcome records
are fsynced and returned as `sqlOutcomeRef` and `effectQuiescenceRef`, each
`{recordId,digest}`. They bind the original permit, operation/store/body/schema,
state and actual revoke scalar if available. They do not prove a full owner
drain, shared identity preservation, account completion or backup replay.
Journals contain opaque operation IDs/digests/scalars, no raw body, contributor
list, actor identity or GPS. These technical records are not an anonymity claim
and acquire no automatic deletion policy from this component.

ACK additionally requires signed Root publication and report inventory records
plus a fresh locked actual SIM readback. An app-supplied context or true boolean
cannot manufacture those records. No report inventory or permit publisher is
provided here; absent evidence denies execution.

## Verified scope

Actual local PostgreSQL18.3: **8/8**, using SIM's real schema002/003 and narrow
control/executor roles. Includes original marker, probe-only repeat, deliberately
discarded executor/registration/control COMMIT acknowledgements, payload
mismatch, durable-scalar order and failure. This is controller ACK suppression,
not a network packet-loss test. Admission in this SQL harness is explicitly
synthetic; it does not establish actual deployed Root authority.

Node24.21 codec/signature tests: **7/7**. Disposable local Linux Node24.20
container, no network/host mounts: **11/11** for real Root file custody,
durable records and actual Ed25519 outcomes. Root verifier unit cases use
explicitly synthetic metadata rows and signed test evidence. Actual production
metadata/enrollment/anchor, target installation and restore are unverified.
These counts are separate and are not added to earlier COP/SIM suites.

Run codec tests with `node --test scripts/account-safety/root-records.test.mjs`.
The PostgreSQL harness is an explicitly invoked workstation-only test
`node scripts/account-safety/test-driver-origin-postgres.mjs --run`; its SIM
checkout, SQL hashes, PostgreSQL18.3 binary and owned Unix-only fixture are
fixed. The Root-files test must run only in its dedicated disposable Linux
container with three owned tmpfs mounts; it refuses an ordinary host run.

## Implemented private process channel

`root-seqpacket.c` implements an in-process Node-API addon: AF_UNIX
SOCK_SEQPACKET at the fixed `/run/cop-account-safety/driver.sock`, one bounded
packet per message, without a length prefix or STREAM fallback. Both receivers
require kernel SCM_CREDENTIALS and SCM_PIDFD on every packet. pidfs device/inode
identity is used instead of comparing PID numbers across namespaces. Unsupported
kernels fail closed. All descriptors, including unexpected SCM_RIGHTS and
truncated/oversized inputs, are closed on rejected paths. Native handle objects
carry a Node-API type tag; arbitrary JavaScript objects cannot become handles.

The Root server publishes its own actual pidfs identity into a fixed Root-owned
binary bootstrap. The client verifies a fixed Root greeting against that
identity before sending its transient request, and verifies the reply peer
again. This bootstrap is not an image/source attestation. The Root installation
must independently protect the code, public key/bootstrap and exact bind mounts;
container UID0 ownership by itself is not independent host Root custody.

`driver-root-channel.mjs` implements a Root-only broker and fixed
`createProductionDriverRootPort()` client with `execute({operation,body})` and
`probe(operation)`. Module/keyring/socket paths cannot be caller-selected.
The broker requires a current signed `driver-client-registration`, exact actual
peer/boot/runtime/dataset binding and original permit; it then calls the real
Root SQL factory. The client checks correlation plus two actual Ed25519 result
records, including original kind/store/body/schema/permit, state and scalar.
A wire error becomes pending, never a positive result or a fresh destructive
operation. The broker does not issue its own accepted peer registrations,
permits or evidence. The operation UUID is Root-delivered internal context,
never an ordinary HTTP parameter. Probe can seal and cannot be used by a GET.

The final standalone Linux Node24.20/kernel7.0.14 native gate passed **6/6**:
actual two-process traffic, actual pidfs comparison, pre-body peer rejection,
wrong handle/size rejection, repeated descriptor cleanup, SCM_RIGHTS and wire
truncation. The fixed client/signature gate passed **4/4** over actual native
traffic with deliberately synthetic SQL terminal evidence. These are local
Linux gates, not target-host/cross-container namespace/production acceptance.
The addon was built for glibc in the test fixture; Alpine consumers need their
own matching musl/architecture build. No native binary is committed.

The previous dispatch's original PostgreSQL body digest is checked even for an
execute that only resolves prior work. A changed body cannot borrow an older
successful receipt. An explicit probe carries no body. Use one client instance
per process; its bounded in-memory input-digest map stores no body.

## Independent COP fence journal and read client

`root-fence-journal.mjs`, `root-record-issuer.mjs` and
`cop-root-continuity.mjs` now implement an actual separate SQL journal,
Root-signed durable manifests, immutable original-operation readback, paginated
private delivery and the production fixed client. COP's controller integrates
replay before admission, rejects version/store/configuration conflicts, expires
the RAM barrier and checks current continuity for workers/receipts/writes.
The permanent journal contains only pseudonymous metadata, **no recoverable
principal**. See [ADR0054](../../docs/adr/0054_INDEPENDENT_PSEUDONYMOUS_ERASURE_JOURNAL.md)
for the identity recovery limitation and exact activation boundaries.

The real isolated PostgreSQL18.6/Root/Ed25519 journal gate passed8/8. An earlier
encrypted-principal prototype is retained only as historical test evidence;
the current minimized gate has its own frozen receipt.

`driver-root-inspect.mjs` adds a fixed read client and broker routing to SIM's
Root reader. The broker finds a private signed `driver-read-delivery` by actual
peer and typed request digest, checks its permit digest, and invokes the actual
SIM reader. The application never supplies a Root UUID. Root must independently
produce that delivery and permit; absent evidence stays unavailable. The client
checks actual native traffic, the signed record, request/checkpoint/runtime/facts
and its own pidfs identity. `selfIdentity()` is unprivileged and takes no PID;
arbitrary process inspection remains Root-only.

The new Alpine/musl gate passed7native,4original client,3read client and4COP
continuity cases. Unlike earlier glibc-only evidence, this binary matches the
test consumers' libc/architecture; it is still ARM64workstation evidence, not
the x86_64production binary. Source compilation used a newly owned temporary
container; packages were fetched before disconnecting that container, and test
execution had no network routes, host mounts or production data. No binary is
committed or substituted for the target build.

## Remaining implementation and deployment

Do not deploy migration003 alone: the live revoke/erase/ack and retention paths
must all use the guarded executor before direct DELETE grants are removed.
The transport, original executor, COP journal/continuity and driver read client
above are implemented source. Authenticated per-request operation-context
delivery for revoke/erase/ack, destructive permit and owner-inventory producers,
complete current-frontier/runtime enrollment, installation and
enrollment, complete owner-wide drain across runtime upgrades,
quarantine/replay before restore exposure and remaining owner production entry
point bindings are still missing. The empty Root metadata
database does not implement them. These are implementation/deployment gates,
not a request for another general user approval.

Production still uses the previously accepted COP image; no real account was
deleted. Never wire a positive test callback into an application, activate the
feature using an environment bit, reuse an old image's attestation, or label
this component as completion of the eleven-owner account operation.
## Current 15 October additions

The latest component evidence is
[52 target-platform checks](../../docs/testing/account-safety-target-platform-20261015.json).
This is not Root enrollment, complete owner composition or production activation.

The subsequent original-registration recovery change has a separate
[12-case actual PostgreSQL receipt](../../docs/testing/account-safety-original-registration-recovery-20261015.json).
If Root crashes after its durable dispatch claim but before SQL registration,
resolution first reconciles only the same immutable registration tuple, commits
it and obtains two committed resolver observations. It never claims a new
executor or repeats DELETE. A real uncommitted registrar blocks reconciliation;
a conflicting body remains unavailable. A probe may close a never-executed
original; that closed original can never later authorize execution.

## Fixed production entry points

- `createProductionAiCheckpointAdmissionPort()` verifies the typed AI snapshot,
  actual signed reply, peer, policy, financial facts and source references.
- `createProductionDriverRequestScope()` supplies per-request ALS for only
  signed consent withdrawal and account erasure. GPS batches/free context never
  enter the Root packet. Invalid input preserves HTTP401/400 ordering.
- `createProductionDriverPublicationPort().withLease({kind}, work)` waits for
  accepted actual SQL and HTTP completion. Expiry denies publication but does
  not release the held Root metadata lock. Unknown release remains an error/HOLD.
- `createProductionDriverRetentionConsumer()` invokes the callback once with
  Root's original operation/cutoff and then probes that exact SQL outcome. A
  resolved callback or a future cutoff cannot establish completed retention.
- Root read dispatch invokes SIM's fixed `root-owner-read.mjs` producer; no
  pre-created delivery file or application-selected Root UUID substitutes for it.

Root-only `retainPeer(connection)` retains the actual delivered SCM_PIDFD;
`peerAlive(handle)` observes kernel exit. It does not establish target SQL
quiescence. The broker handles at most 32 concurrent requests so a waiting writer
does not prevent receiving a lease release.

## Private identity profiles and volatile state

All profiles below are fixed Root-owned 0600 ordinary files under
`/etc/cop-account-safety/root`. Values are never passed by HTTP, printed or stored
in Git. A JSON profile is canonical with a final newline.

`cop-identity.json` has exactly `contractVersion=cop-root-cop-identity-v1`,
`issuer`, `identitySecret`, `routerUserIdSecret`, `applicationStoreId`,
`protectedConfigId`, `configurationFingerprint`. The fingerprint must match
the actual identity-secret derivation and independent journal binding.

`driver-identity.json` has exactly
`contractVersion=cop-root-driver-identity-v1`, `serviceToken`, `actorSecret`,
`issuer`, `hashSecret`. `driver-contributor-keys.json` has exactly
`contractVersion=cop-root-driver-contributor-keys-v1`, `currentVersion`, `keys`;
each key is `{version,secret}`. Independently accepted
`/var/lib/cop-account-safety/authority/driver-key-history.json` binds each actual
version/fingerprint and proven first/last issuance days to guard/epoch/config.
Absent history or more than 4096 candidate hashes denies inventory; nothing is
truncated. No date is inferred from receipt upload time.

Fixed TLS connection profiles use the existing `cop-root-postgres-profile-v1`:
`cop-consent-reader` targets database `cop`, user `cop_guard_consent_reader`;
`driver-inventory` targets `sim_driver_measurements`, user
`sim_driver_guard_control` and SIM's bounded read-only candidate function.
These roles/credentials have not been provisioned by component source work.

[`002-root-reader.sql`](002-root-reader.sql) is a one-shot supplementary
metadata-reader candidate for the existing closed guard database. It starts
NOLOGIN with no password, membership, DML, schema creation, database CREATE/TEMP
or guard-function execution. It grants exact metadata SELECT, an explicit
SELECT-only receipt RLS policy and the two PostgreSQL control facts functions.
Unexpected schema/roles, PUBLIC database access or effective column writes stop
the migration. It does not repair global authentication or activate credentials.
SIM common authority used these exact SQL002 bytes in its separate 22-case
TLS/PostgreSQL gate. No production application of this migration is claimed.

[`003-cop-consent-reader.sql`](003-cop-consent-reader.sql) is the separate
NOLOGIN candidate for database `cop`, after the reviewed consent schema exists.
It grants only the ten columns needed for exact issuer/pending-day/fence/secret
fingerprint readback. It refuses unreviewed RLS that could hide rows, effective
PUBLIC column writes or executable user-defined definer functions. It changes
no existing PUBLIC grants or other applications. Actual Root actor reads also
recheck the fixed role, absence of memberships/writes and the live non-RLS table
surface before treating an empty result as an inventory.

Both supplementary candidates passed a separate
[nine-case actual PostgreSQL ACL run](../../docs/testing/account-safety-root-reader-profiles-20261015.json).
The subsequent [exact production read-surface query gate](../../docs/testing/account-safety-root-reader-surface-20261015.json)
also executes the actual source SQL, rejects later PUBLIC column writes and
RLS enablement, and preserves the original nine-case receipt.
Restricted disposable LOGIN wrappers prove denied escalation; a superuser's
`SET ROLE` cannot prove that property. The profile roles themselves stay NOLOGIN
in this gate. It does not establish production credentials, TLS, nonempty receipt
coverage or the complete Root actor/owner composition.

Root request evidence and identity joins live only beneath Root 0700
`/run/cop-account-safety/private`, on explicit volatile storage. Subdirectories
include `owner-authority`, `read-evidence`, `read-permits`, `ai-read-permits`,
`request-contexts` and `runtime-observations`. Retention no longer reads a
pre-created `maintenance-deliveries` file; its context is issued in RAM by the
fixed Root producer.
Apps mount only the public bootstrap and socket file, never the whole private
tree. Durable original operation/effect/fence evidence stays separately under
the protected state directory on X5; no internal-disk fallback is allowed.

Host `root-runtime-watch.mjs --watch` observes three fixed containers using
Docker GET only and actual `/proc`/pidfs/executable facts. It rejects eval/print,
unreviewed Node flags/options, wrong entry/source/mounts or a consumer older than
the current broker cohort. Its signed five-second host records are factual
observations, not enrollment or policy acceptance. Actual source-proof JWS,
linked replay/checkpoint acceptance and independently accepted owner policy
remain required. These components are still under joint integration testing.

## Actual native writer integration — 15 October

The separately frozen [new four-group receipt](../../docs/testing/account-safety-native-writer-20261015.json)
uses the actual fixed Root broker, native receiver credentials, child pidfs,
Ed25519/JWS, PostgreSQL18.6 over verified TLS and SIM common authority484289.
The writer holds the same exclusive two-argument metadata904214 barrier that
publication consumers hold shared. It validates the actual native receiver peer,
exact registration/current owner, original body digest and all target session
END acknowledgements before signing terminal records. Missing peer/wrong body
cannot create an origin or mutate the target.

The test executes an **expire/retention original**, not a complete account
erasure/revoke/ack. A held native publication callback prevents effects. Repeating
the same committed original leaves later inserted expired rows untouched. A
durable dispatch without SQL registration resolves only that original and
never starts DELETE.

The final actual TLS proxy observes the executor COMMIT acknowledgement and two
resolver JSON/readback COMMIT acknowledgements, forwards the original Postgres
Terminate, observes backend END, then withholds frontend TLS close/FIN. The native
client returns pending after five seconds while the common barrier is still busy.
At15.15seconds the actual END watchdog retains global HOLD and the metadata lock;
no terminal signed records are published. No HOLD reset/TTL unlock occurs.

This is Linux ARM64/musl/Node24.20.0 evidence with an owned UID0 child. Container
identity, enrollment, accepted owner policies and host observation are explicitly
synthetic; production isolation/custody, whole-account erasure and restore are
not accepted. All owned containers and staged private context were removed.
Do not add these four groups to historical test totals or reassign older receipts
to the new wrapper. The separate runtime CLI stays deliberately unavailable.

## Actual Root retention original producer

`root-driver-retention-producer.mjs` now supplies the existing retention broker
entry point directly. It obtains the actual exclusive current-owner lease from
the receiver peer, accepts only the independently reviewed `no_report` policy,
computes the fixed body digest through actual PostgreSQL and chooses a server UTC
cutoff. No HTTP input selects a cutoff, Root UUID or positive authority. The
Root-owned `maintenance-active/driver.json` points at the immutable signed
operation and its four typed evidence records. It contains only opaque IDs,
bindings and digests; no contributor/body/account inventory.

A still-current original retains exactly its UUID and cutoff. After original
source/permit/runtime expiry, Root first reconciles that same historical
registration and performs two actual committed resolver observations. Only a
known terminal original and confirmed END of every real SQL connection permit
a new Root original. Missing/foreign namespace, unknown outcome/query/END or
changed authority denies or retains HOLD; none can renew an unknown operation.
The signed five-second context is returned only after the real lease closes.

The separate [five-group actual Linux/PostgreSQL/TLS/native receipt](../../docs/testing/account-safety-retention-producer-20261015.json)
uses immutable SIM6c6d9f2/commonb592 with its stricter current-target checks. It
exercises actual Root minting/delivery/expiry, same-original no-repeat, historical
reconciliation, safe sealing before effects with rejected delayed execution,
and an actual uncommitted DELETE/marker retaining its row lock. The last case
keeps the pointer/UUID/cutoff unchanged through the five-second native timeout,
then requires global HOLD at the real ten-second query deadline. The executor
role gains no extra SELECT permission: provisional marker evidence comes from
the actual fixed SQL result/source, not a direct same-transaction private SELECT.

An [initial failed fixture is qualified separately](../../docs/testing/account-safety-retention-producer-initial-failure-20261015.json):
it incorrectly treated every claimed in-progress transaction as unsealable,
even before effects acquired the origin row. The SQL and producer were not
weakened. Historical signed state, accepted enrollment and host/container
observations in both runs are synthetic. No real account, complete erasure,
production installation, new authority enrollment or restore was accepted. All
owned contexts/containers were removed. Existing native4/common22/lineage8
receipts keep their own original source pins and scope.
