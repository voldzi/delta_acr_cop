# 43. Whole COP account removal — current completion evidence

## Active implementation decision — 15 October

The completion path is now the explicit database alternative in
[ADR0055](../adr/0055_DATABASE_ACCOUNT_ERASURE_RECOVERY.md). The native signature
candidate described below remains preserved source/evidence, not a remaining
installation prerequisite for `database_v2`. Nine actual PostgreSQL cases cover
the new independent journal, key inventory, identity review and controller
replay. The joint case uses actual COP HTTP and SIM HTTP/database owners,
including observed batch/delete blocking, foreign ETA rejection and B-row
preservation. Other owners use explicit synthetic readiness/preflight fixtures
and pending effects; these are not production readiness or permission to confirm
a real account. The actual result remains HTTP202/accountDeleted=false.
See [the scoped receipt](../testing/account-safety-database-v2-joint-20261015.json).
Whole-flow acceptance,
production composition, restore acceptance and deployment are still outstanding.

### Verified production transport follow-up

The production continuity loader now preserves the actual protected Unix
business route and reads the same COP store via the already configured verified
TCP session route. Both remote connections require the existing PostgreSQL CA,
exact HAProxy endpoint and `verify-full` semantics; arbitrary overrides,
credential-encoding ambiguity and downgrade are rejected. The real production
read-only session probe succeeded as `cop_app`: the actual mobility store exists
and is readable. The public CA PEM SHA256 is
`7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a`.
SIM independently verified the actual HAProxy certificate with that CA and
hostname. An earlier ad-hoc Node TLS-only probe printed successful authorization
but exited139 during shutdown; it is not a clean process-acceptance result.
The later actual SQL client probe exited0. Production remained healthy; no
new crash-file metadata was found in the inspected `/var/crash` path.

Current targeted transport/parser tests75 pass, typecheck and scoped lint pass,
full normal COP regression2408 passes/80 optional skips, skeleton passes. These
are distinct from the earlier9 actual PG journal/joint tests; those were not
rerun or upgraded into whole-flow acceptance. Full lint still has the historical
fixture diagnostics described below. Dedicated production guard enrollment and
the unresolved owner boundaries remain required before activation.

Current checks: typecheck/build/skeleton/schema validation passed; full normal
regression2393passed/80optional-skipped; actual independent/joint PG gate9passed;
actual session/profile PG gate4passed. OpenAPI validation passed with24 existing
warnings. Public analytics guards passed. Two old session-erasure expectations
were corrected to match the already-reviewed legacy token-refresh behavior:
refresh preserves unknown issuer and original lifetime, rather than adopting an
owner or rejecting the refresh. Runtime session behavior was not changed here.
The full lint command still reports67 unused declarations in unchanged,
byte-pinned historical Linux fixture harnesses. Targeted lint of the changed
runtime/test files passes; those historical proof sources were not edited just
to suppress the diagnostics. This is not a clean full-lint release claim.

Read-only production check: COP still runs the same a06 image, erasure/retained
guard are off, Messaging's required capability URL returns404, and dedicated
SIM/Keycloak/LiveKit-admin erasure configuration is absent. No production value
was printed. The published Messaging candidate was recovered separately at
`ee3b4641962bf1a72e3709074d1ccc8a69e0ac44`; its native private-owner authority is
not an implemented provider cleanup executor. Production Synapse image/schema
was subsequently inspected through the user-supplied `comm-codex` SSH alias.
`scripts/account-safety/inspect-synapse-readonly.sh` is a prepared metadata-only
diagnostic for the actual Synapse host; it ran successfully on15October:
Synapse1.156.0, PostgreSQL18.6, connected role without superuser/CREATEROLE/BYPASSRLS.
It reads no message/user rows or credential values, and changes no service/DB.
The existing voice media credentials are configured, but an actual read-only
LiveKit admin probe at the existing public media origin returns404. A verified
server-side admin origin is still required; no public route or new port was
opened to work around it.

Subsequent Messaging work fixed a real provider mismatch: native deactivation
retains external-login bindings. Exact-user PUT and repeated GET now clear and
verify those bindings. The source passed169 Messaging tests and a disposable
actual Synapse1.156.0 API test with two synthetic accounts: A's binding was
removed while B stayed active with its binding. That test had no network,
production credentials or persistent volumes. It is not whole-account or
production acceptance. The comm access blocker is resolved; private owner
completion, namespace/restore acceptance and deployment remain open.

Two further composition proposals were rejected before application: a backup
owner completed only from journal replay without proof of restricted backup
access/expiry and full restore rehearsal; and shared stream event cleanup
without independently proven ownership of every changed item. Neither proposal
was applied or retried through another execution path. Both owners remain
unaccepted; no missing adapter was converted into a positive proof.

Source work: 2026-10-14. Production still runs accepted image
`sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f`,
application source `b13fbdc71f3d9821f8b857c3f73255a75c46fa76`.
Read-only SSH and runtime validation succeeded. Latest 15 October readback:
running, restart count 2, same image/source, profile
`206c4507-5e00-458e-b0ee-4061309aa7a8`, generation
`7a351c5cb66e45cdbb845a76206fc282`. This source work is not yet deployed or
activated. No real account was deleted.
Earlier imports and vehicle-subset gates are [archived](../archive/2026-10-13_ACCOUNT_SAFETY_SOURCE_GATES.md);
they do not establish this candidate or live erasure.

## Latest implementation and verification — 15 October

The candidate now includes signed per-day consent withdrawal, isolated request
context, a retained publication lease client/broker, fixed AI checkpoint
admission, a maintenance consumer that probes the original SQL outcome, strict
compact JWS, and host observation of the actual executed Node script/pidfs.
The native peer handle survives the reply and observes actual process exit;
neither exit nor a five-second expiry is interpreted as SQL/publication drain.
Concurrent mutation calls are queued rather than dropped before their first
execute packet. The bounded Root broker can receive control/release packets
while another request waits for a database barrier.

Permanent fence manifests remain principal-free as specified in
[ADR0054](../adr/0054_INDEPENDENT_PSEUDONYMOUS_ERASURE_JOURNAL.md).
Per-request evidence, permits and identity joins use Root-private volatile
directories. Historical contributor days are determined by Root-derived hash
candidates matched against actual retained rows, including receipts with no
accepted interval; upload time is never substituted for the measurement day.
This last Root actor/owner composition still requires its joint SQL test.

Actual target-platform verification: **52/52 in ten separate suites**, Linux
amd64/kernel 7.0.0-38, musl/Node 24.21.0, actual kernel credentials/pidfs, Root file
custody and Ed25519. Application SQL/owner observations in the native client
fixtures are explicitly synthetic. Additional distinct local runs passed 19 pure
identity/crypto cases, 37 controller/revocation cases and 100 HTTP/SIM-adapter cases.
Typecheck, scoped lint and skeleton passed. Counts overlap earlier historical
suites and are not added to them. See the immutable
[target-platform receipt](../testing/account-safety-target-platform-20261015.json).
The disposable target test container was removed; source/logs stay on X5 staging.

A subsequent separate **12/12 actual PostgreSQL18.3** run verifies recovery of
the original registration after a Root dispatch-file write/crash, blocking on
the real in-flight registrar and rejection of body retargeting. Reconciliation
changes only original metadata, never claims an executor or repeats DELETE.
See [its separate frozen receipt](../testing/account-safety-original-registration-recovery-20261015.json).
Admission in that SQL fixture is synthetic. A second owned ARM64 container also
passed8native kernel cases for SIM's actual self-process gate; it was removed.

**Not deployed/activated:** actual shared Root owner/permit/maintenance producer,
remaining COP production owner adapters, protected installation and scoped DB
profiles, source-proof/checkpoint enrollment and native deploy/restore latch
still need their joint verification. Source ABI declarations and component
tests are not positive production authority. The current SSH account needs
interactive sudo; direct Root SSH is unavailable. This access limitation is
separate from the remaining implementation. No real account was deleted and no
OpenAI request was made by these tests.

### Subsequent actual native writer and SQL reader gates

The actual fixed COP Root executor now obtains SIM's exclusive metadata lease
using the **native receiver's actual kernel peer**. It checks the exact
registration, body digest and current owner binding, awaits every real database
session END and rechecks authority before publishing signed terminal evidence.
Unknown target END retains process HOLD and the real barrier.

A new [four-group actual Linux/TLS/PostgreSQL run](../testing/account-safety-native-writer-20261015.json)
passed. It covers a native shared publication lease versus retention writer,
original-only retry, missing peer/body mismatch, dispatch-before-registration
recovery and actual withheld TLS END. The final case observed executor COMMIT,
two committed resolver readbacks, Terminate/backend END, then HOLD at15.151s;
no terminal signed outcome was emitted. The original common22 and platform52
receipts remain frozen. Scope is **expire/retention**, not full account erasure,
revoke or ack. The UID0 child, native credentials, crypto and SQL are actual;
container/host observations, enrollment and accepted owner policy are synthetic.
Owned test containers and context were removed; teardown is not HOLD recovery.

The separate supplementary reader migrations passed
[nine actual ACL cases](../testing/account-safety-root-reader-profiles-20261015.json).
A [subsequent source-query run](../testing/account-safety-root-reader-surface-20261015.json)
executes the exact production COP consent read-surface query and rejects later
PUBLIC column write/RLS changes. The two profile roles remain NOLOGIN in those
local tests. Neither migration was applied to production.

The human has now agreed to execute the exact Root installation procedure after
joint tests. No password is requested. This resolves the operator-access
question only: the final installer, accepted owner/proof/permit producers,
remaining COP production owner bindings and pre-exposure restore/startup
enforcement still require implementation and verification. Production remains
on the same accepted image; no real account has been deleted.

### Subsequent actual retention producer — five groups

Root now derives the immutable expiry original and current context itself; the
broker no longer reads a pre-created retention delivery file. It checks actual
current authority, exact receiver peer and independently accepted `no_report`,
uses the PostgreSQL JSONB digest, stores only opaque original bindings, and
never renews an unknown UUID/cutoff. Historical originals are first reconciled
under the held actual lease with committed resolution and confirmed SQL END.

The [new five-group receipt](../testing/account-safety-retention-producer-20261015.json)
passed against immutable SIM6c6d9f2/commonb592. Actual native delivery, Root
minting, fixed expiry, no-repeat, source expiry and a real uncommitted DELETE
were exercised. A safe delayed claim was sealed before effects and its later
execute was denied. A genuinely row-locked uncommitted operation instead kept
HOLD and the exact pointer/UUID/cutoff through native/query timeouts. The
[initial failed fixture assumption](../testing/account-safety-retention-producer-initial-failure-20261015.json)
is retained separately; no SQL or authority rule was relaxed to obtain PASS.

The fixed executor's provisional result/source proves the uncommitted marker
path; no direct private SELECT grant was added to the executor. Host/container
observations and accepted owner enrollment are still synthetic; no whole-account
operation, production activation or restore was accepted. Owned containers and
private staged source were removed. These five groups do not upgrade earlier
receipts or prove the still-missing revoke/erase/ack context producer and complete
COP owner composition.

### Subsequent Root actor composition — nine groups

The [separate nine-group Root actor gate](../testing/account-safety-root-cop-actor-20261015.json)
passed with actual restricted TLS SQL profiles, signed journal and two synthetic
users. It proves alias/issuer/operation separation, no self-deadlock under an
already-held904214 barrier, historical retained-hash/outbox coverage and exact
manifest preservation via permanent fences after receipt/outbox cleanup.
RLS, inherited column writes, cross-user signatures and invalid daily-consent
ledger/fence state remain denied.

The helper now reads two matching journal observations in READ COMMITTED/READ
ONLY without taking another writer lock or refreshing the frontier. It awaits
actual SQL END. The hypothesized shrinkage after correct fenced cleanup was
ruled out; exact contributor validation was not relaxed.

This is a necessary actor component, not full authorization: calls are direct
in Root, source journal setup uses a synthetic administrator, COP consent layout
is synthetic, and no native actor endpoint, HTTP login/current-owner enrollment,
whole-account deletion, production or restore was exercised. The mutating
wrapper must still bind the original anchor/body from the actual ledger and
obtain independent actual current-owner authority. Owned fixtures were removed.

### Subsequent independent mutation-intent preparation — fourteen groups

The fixed Root-only `root-driver-mutation-intent.mjs` verifies the actual service
credential and canonical signed actor with the same pinned SIM parsers. Actual
restricted TLS readback supplies the first accepted ledger time, or the database
observation time for a new operation. The independently checked signed journal,
historical contributor-key inventory and exact manifest bind the same account.
Changing an existing request is denied. The private five-second intent binds
the receiver peer, registration, request digest, business operation, actor/request
hashes and manifest/journal references; its lifetime cannot outlive the signed
actor. Principals, credentials and daily identities stay in RAM. The transient
body deliberately contains neither a checkpoint nor publication authority.

The [separate actual fourteen-group fixture](../testing/account-safety-root-driver-mutation-intent-20261015.json)
includes the previous nine actor checks and five new preparation groups; these
counts must not be added together. New checks cover two accounts, service and
signature failures, expired actor and foreign manifest, minimized private signed
records, an actual synthetic existing ledger preserving its original anchor,
changed-request denial, and actual per-day consent withdrawal preparation.
PostgreSQL/TLS, restricted profiles, signatures and normal session END are real.
The fixture creates no original-operation row and performs no guarded business
mutation through this new component. Existing ledger/journal setup is synthetic.

This intent is a necessary identity condition only. It cannot authorize a write,
refresh a checkpoint, adopt a policy or replace the actual held common context.
The request lifecycle, scoped cleanup reads, original-operation producer and
ERASE-to-ACK binding still need shared integration. No native HTTP actor endpoint,
lost-END fault, production enrollment, real account erasure or restore was
accepted. All owned fixture containers and private context were removed.

Joint source review found a boundary defect in the first candidate: relative
signer TTL could exceed the actor's absolute expiry when signing I/O was delayed.
The subsequent implementation passes the absolute deadline and checks the actual
signed issuance/expiry before storing the record. Seven pure clock cases cover
the one-millisecond overshoot, expired/future/noncanonical clocks and the exact
deadline. A [new fourteen-group actual fixture](../testing/account-safety-root-driver-mutation-intent-deadline-20261015.json)
passed on the corrected source. The first receipt remains frozen on its original
source; the rerun is not fourteen additional independent scenarios. Neither run
claims a delayed-signer fault injection or unknown SQL END acceptance.

The separate [legacy ETA reproduction](../testing/account-safety-driver-eta-legacy-reproduction-20261015.json)
confirms a real defect in the old two-column batch foreign key: a mismatched ETA
contributor can survive while the old ledger reports zero batches. This is
defect evidence, not an acceptance pass. SIM's forward migration007 checks old
data before adding the exact contributor-bound foreign key; installation must
abort on an existing mismatch. Its new schema fingerprint requires independent
acceptance, not automatic policy adoption.

### Earlier Root SQL executor component

COP added the real Root-only original-operation executor and signed result
records in [scripts/account-safety](../../scripts/account-safety/README.md).
It uses SIM's published `6df9d353` schema003, actual original PostgreSQL
transaction identity, a durable one-shot dispatch and committed exact-origin
resolution. Revoke preserves its actual scalar count before COMMIT and can
recover that observation without repeating DELETE. Private body/identities/GPS
are not journaled. A missing scalar cannot become a fabricated zero.

The separate gates passed **8/8 actual PostgreSQL18.3**, **7/7 codec/signature**,
and **10/10 disposable Linux Root-file/signature/verifier unit cases**.
The SQL gate uses synthetic admission, and the Root verifier unit gate uses
synthetic metadata observations: neither proves independently enrolled current
production authority. Scope, source pins and failed initial fixture
qualification are in [the separate receipt](../testing/account-safety-root-producer-20261015.json).

This closes the executor-source gap only. Actual app delivery, Root permit and
current-frontier/inventory producers, full owner drain and journal/replay,
production `index.ts` bindings and Root installation/enrollment remain missing.
These are not missing general user permission. No production erasure activation,
actual restore acceptance or real account deletion is claimed. SIM must not
remove live direct privileges or deploy schema003 before the complete coordinated
writer/cleanup transition. Existing accepted production remains active.

The follow-up implements the native SEQPACKET Node-API carrier, fixed client and
Root broker. Separate gates passed **6/6 actual local Linux native** and
**4/4 fixed client/signature** cases; Root file/registration units now pass
**11/11**. The native gate uses two local processes; the client gate deliberately
supplies synthetic SQL terminal evidence, not production authorization. Body
drift is additionally rejected for an existing committed origin. Exact current
pins and limits are in [the channel receipt](../testing/account-safety-root-channel-20261015.json).
The original executor receipt remains frozen at its original source.

SIM subsequently published the actual opt-in store/lifecycle/route implementation
at `0f56fc0a852a5f30fddb133d03fe96fcfaaf5a17`. Its owner reports571 application
tests passed, six opt-in PostgreSQL skips, plus typecheck/build/skeleton/OpenAPI.
These are not added to COP counts or represented as a COP rerun. Read admission,
authenticated per-request context, actual Root enrollment/producer/replay and
COP's remaining owner bindings still require implementation and acceptance.

A bounded production host probe on15October verified kernel7.0.0-38, available
Node/compiler and SSH UID1000. `sudo -n true` requires interactive authentication.
This is an installation-access limitation, not the sole completion blocker:
unfinished authority/integration must not be presented as ready merely because
an operator could install files. No roles, keys or service were created and no
production helper/configuration changed by the channel work.

## Authority and scope

The human requested completion with SIM and deployment after verification on
14 October. SIM's old proposal-only instruction is superseded. The human also
approved its concrete erasure operations/limited permissions and daily cost
carry-forward without user linkage until the end of the current UTC month,
expiring after reservations settle at the start of the next month. This is not
an anonymity claim or approval of other retention, broad rights, live restoration
or deletion of a real test account. SIM independently received its direct confirmation and resumed implementation.
Earlier automatic-review scope rejection is superseded; no rejected action was
bypassed. Independent native/provider acceptance remains a separate gate.

The approved vehicle policy remains: delete own contributions/personal links,
preserve other authors' records, transfer active owned vehicles to a distinct
existing authorized member first. No automatic reassignment or blanket financial
exception. Unresolved shared group ownership or cross-author dependencies block
before a permanent fence. See [ADR 0052](../adr/0052_APPROVED_SHARED_VEHICLE_ERASURE_POLICY.md).
The existing `csm-mobile` one-account login is preserved. Chat, BYOK activation,
measurement intake and live ETA policies are not changed. Approved reporting
retention stays `cop-communication-retention-90d-30d-180d-v1`, contact
`podpora@zeleznalady.cz`.

After finding the shared `csm-sim-web` realm client, the human explicitly chose
to delete COP/Jízda while preserving the account and access to SIM. The Keycloak
owner therefore revokes only the approved COP application grants; it must never
delete the realm user, globally log out SSO sessions, or alter SIM/realm roles.
The canonical confirmation explains this scope. COP's permanent fence denies
old COP tokens independently of retained SIM identity. No real account was
changed to test this policy.

## Controller and browser

All eleven owners remain mandatory. Missing/unknown/unavailable owner evidence
keeps capability false and creates no new fence. HTTP202 is pending; confirmation
HTTP200/accountDeleted=true requires every actual cleanup/readback proof.
Signed auth_time must be no older than300seconds. A300-second operation-bound
plan and read capability precede confirmation; the capability is hash-only at
rest and delivered to web in a scoped Secure/HttpOnly/SameSite=Strict cookie.
The browser stores only its operation UUID in session storage, never a principal
or capability in URLs/storage. Exact receipt GET remains readable after login
removal. Its30-day technical validity is not a personal-data retention policy.

The current continuity candidate requires scope-bound configuration version4;
older versions are not silently adopted. Preflight and receipt require `deletionScope=
cop_jizda_preserve_shared_identity_sim` in the new browser. The new
`COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED` defaults false and never reuses old
identity-delete acceptance. See [ADR0053](../adr/0053_COP_ERASURE_PRESERVES_SHARED_SIM_IDENTITY.md).

New private `/account/delete` does not mount the map/producers. It shows account,
scope, blockers, an unchecked confirmation, pending owners and final receipt.
The web account is read from the existing authenticated
`GET /api/v1/me/profile` (`cop-account-profile-v1`), checked against the current
session subject and configured issuer, and kept only in RAM. The page shows the
canonical name/email, labels an unverified email, and exposes the exact subject
ID even when two accounts have the same name/email. It rechecks the displayed
identity before and after preflight and immediately before confirmation. A
changed identity clears the plan and sends no confirmation or receipt-recovery
request. The backend still binds the plan to the actual actor on the POST;
browser checks do not replace that authorization. Only the operation UUID is
stored after the non-destructive checks have passed.
Lost confirmation responses recover the same operation. Local browser credentials
clear after confirmed revocation; another phone's local deletion is not implied.
Service worker never supplies the cached map shell for this page. Analytics
rejects its page/API/receipts. Account-safety API offers the URL only when actual
deletion is ready.

Content reassessment and first global fence share actual writer admission locks.
Mobility local impact is compared inside the exact global-store transaction.
Lock order is content then global store; remote cleanup runs outside admission.
Queued writes and ownership created after initial preflight cannot slip through.

## Actual local owner source

- Sessions/profiles: every primary/fallback, exact issuer/subject and alert acks.
- Devices/pairing/mesh: immutable internal issuer, same-transaction permanent
  fences, purge/readback; provenance omitted from public DTOs. Confirmed denial
  is403, unknown/outage503; no replacement RAM store after guard acceptance.
- Voice: actual signed JWT expiry recorded before every response plus final
  actor/recipient check. LiveKit removes only exact participant and reads back.
  Unused grants still require waiting through maximum3,600seconds+30seconds
  then repeated removal. Current disabled voice is not historical zero proof.
- RAM/derived copies: actual per-state guarded collections, generation-bound
  account cache, SQL projection fences, private ownership witnesses and hydration
  without adoption. AI index/vector copies, queued writes and manual notification
  flights require actual settlement and readback. Concrete local cache ports are
  bound to the actual Situation, Safety, TAK and SIM Search instances before
  producers start. They clear reconstructible copies and wait for actual older
  fetch/body promises; timeout or cancel invocation alone is not settlement.
  Reference scans are denial checks and never assign authorship. Unknown source
  subclasses or missing external-stream owner keep readiness false. Local cache
  clearing does not acknowledge remote SIM/TAK or subscriber deletion.
- Mobility/Dispatch: routes/outbox/owner share exact guarded service. Identity,
  invitations, own records and cross-account caches are purged. Provider manifests
  survive local deletion. Claim+handoff check global fences. Future notices carry
  verified inviter identity; historical pilot attribution stays unresolved.
- Moderation: actual local evidence/reports/operations/rates and deleting-actor
  links in surviving reports are purged/read back. Matrix blocks belong to Messaging.
- Content: guarded community/sketch/incident stores, immutable provenance and
  original/derivative manifests. S3 erasure requires actual upload settlement before and after DELETE, plus
  repeated absence readback. URL expiry/HEAD404 alone are insufficient; default
  production readiness remains false without a real settlement owner. Unknown
  writes/versioned buckets remain pending. Projection owners are required.
- Keycloak: dedicated server authority and exact HTTPS realm/client identity.
  Scoped COP grants/repeated readback and an identity-generation checkpoint;
  shared SIM user and sessions are preserved. Unsupported scope, incorrect or
  service identity, false acknowledgement or generation change cannot complete.
  It runs last; no global user DELETE/logout is permitted by the selected policy.

The server-only `backupRestoreErasureAdapter` option adds only the
`backup_restore` owner to the actual local adapter composition. Its literal
owner ID is checked at runtime; combining it with a full adapter override or a
prebuilt erasure service is rejected instead of silently ignoring it. Existing
standalone overrides remain available for isolated tests. This source seam
does not implement or bind a restore authority, add an environment acceptance
flag, change local transaction fences or activate production erasure.

## Actual external/production gates

### Explicit voice erasure transport — source candidate

`COP_LIVEKIT_ERASURE_RELAY_URL` selects the new `cop-livekit-erasure-v1` adapter
through the existing HTTPS Messaging API. It is mutually exclusive with the
direct `COP_LIVEKIT_ADMIN_URL`; neither is an automatic fallback. COP signs a
new30-second LiveKit SDK grant per request and reuses only its existing
server-side Messaging token. The signing secret is not sent to Messaging. The
actual global account/operation context travels from the erasure adapter, never
from browser parameters. Messaging separately verifies the real persisted
fence and limits the provider operation to that owner in canonical COP rooms.
The existing media-grant expiry wait and repeated participant absence checks
remain in force. Another participant/room cannot be selected by this request.

Nine COP transport tests verify real SDK JWT signatures and expiry/grants,
independent A/B identity, exact account/operation headers, cancellation, invalid
responses,401/409/429/503 and absence of a direct fallback. The existing three
native LiveKit tests and twelve device/voice tests also pass. Messaging's six
HTTP tests include actual Unix socket transport. Its complete195-test Linux
suite passed after correcting one macOS-specific fixture path; the initial
194/195 run is not passing evidence.

Messaging runtime source `cc26a2016287e4ced4a5f02a8496caae930db993` is now
deployed on comm with an explicit protected Unix socket and credential-free
fixed-loopback sidecar. Existing provider container IDs, operator configuration,
APNs settings and port bindings stayed unchanged. The ordinary API readiness
passed. A real SDK30-second room-list grant signed inside the existing COP
container crossed HTTPS Messaging and the private socket to the actual LiveKit:
the fixed nonexistent-room probe returned200/ready=true, an unauthorized caller
401, an invalid grant503. Stopping only the new sidecar changed the authorized
probe to503; restarting it restored200 without restarting COP/API/LiveKit.
No room was created, real account erased, long-lived secret copied or public
port added. Six additional isolated Linux sidecar checks cover locks, restart
and unsafe filesystem objects; fixtures were removed.

The production COP image and its voice adapter configuration have not yet been
changed. Whole-account deletion remains disabled; this concrete transport
acceptance does not replace Messaging whole-owner/private-state composition,
Keycloak authority, independent enrollment or actual restore acceptance.

### Shared PostgreSQL stream owner, 15 October 2026

The COP stream now has an implemented local database owner when the actual
account-erasure secret is configured. Publication records each community report
change against the real authenticated `cop_community_erasure_ownership` row in
`cop_stream_bus_projection_ownership`; a JSON subject or a matching identifier
does not establish ownership. The same shared transaction lock covers source
readback, persistence and local delivery, and notification consumers take this
barrier before reading or delivering retained envelopes. Guarded publication
fails without a local delivery fallback on database/ownership failure. The
ordinary unguarded deployment retains its previous behavior.

Erasure first checks the exact source-generated durable projection manifest
and account/operation fence for **every** requested resource, before installing
stream fences or modifying rows. Only a matching separately bound change can
be removed. Mixed envelopes preserve other changes, their order, sequence and
timestamps; remaining ownership indexes are adjusted in the same transaction.
Old envelopes without publication bindings, foreign sources, unexpected owner
text or unexplained references remain intact and pending. This deliberately
does not adopt historical ownership based on text searches. Bounded scans are
limited to 10,000 resources/envelopes and fail closed beyond that limit.

The real bus owner participates in projection readiness, preflight and startup
frontier hydration. It covers this PostgreSQL bus only; configured remote edge
subscribers still require their own erasure owner. This does not implement
private Synapse cleanup, LiveKit administration or backup/restore acceptance.
There is no whole-account production activation in this source change.

Verification: 13 actual PostgreSQL projection tests passed, including two real
queued advisory-lock races (publish before erasure and erasure before publish),
mixed A/B envelopes, forged foreign manifests, unbound historical rows and no
local fallback. Six stream transform tests and the 17 existing stream lifecycle
tests passed. The full COP regression passed 2,414 tests, with 86 optional tests
skipped in that run; the six new PostgreSQL tests were run separately on a fresh
owned PostgreSQL18 cluster and are included in the 13 above. Production data,
runtime and activation flags were not changed by these tests.

SIM's initial published implementation was
[`68e96e7`](https://github.com/voldzi/delta_acr_sim/tree/68e96e7ec19cbbd99b08c0eac865016082521186).
Its subsequent tested application source is
[`7bd5a63`](https://github.com/voldzi/delta_acr_sim/tree/7bd5a6381006810c7a4bf3ffa51d13e3b63a61ed),
with the earlier compatibility receipt published at
[`fe0eec5`](https://github.com/voldzi/delta_acr_sim/tree/fe0eec57f7a3b5266b6b88d6b8498b180114b16c).
SIM reported 591 application tests, 41 actual PostgreSQL18.3 cases and 70
contract cases passed; six unrelated legacy PostgreSQL cases were skipped in the unit run.
Typecheck, build and skeleton passed. It is not deployed: actual independently
owned per-principal admission/drain/commit and completed-history restore replay
are still required. A healthy runtime or signed TTL document cannot replace
those operations. COP now accepts the HTTP no-store directive with other legitimate cache
directives, rather than comparing the whole header text. Actor control characters
and measurement operation UUIDs match SIM. New intake/preflight requires
enabled service readiness; continuing a durable accepted COP job additionally
requires its own actual existing SIM receipt, current protected authority,
identity and immutable manifest/first acceptedAt. Missing or foreign operations
never receive the disabled-only resume exception. Controller capability and
new preflight never call accepted-operation readiness.
The controller now first checks ordinary readiness for a durable confirmed job:
enabled intake must allow its first provider handoff even though the provider
operation does not exist yet. Only a false ordinary readiness result invokes
the own-existing-operation resume check. An exception/timeout remains
unavailable, not an alternative admission. Two actual COP controller/adapter
HTTP tests cover the first Router and Driver handoff against an explicitly
synthetic provider; the earlier ten actual-SIM-handler pair cases did not test
this controller ordering.
COP strict adapters use dedicated server-only erasure origins
and credentials, actual existing-alias review and complete retained/outbox/key
inventory; no normal Router token fallback or guessed retained-day completeness.
Exact existing Router aliases, all retained measurement days/key versions,
scoped readiness and actor preflight must be accepted; health is insufficient.
No OpenAI call is needed for erasure tests.
The actual `sim_measurements` owner now also includes COP's local consent store.
New consent rows receive the server-verified issuer; historic null-issuer rows
are never adopted from the current login. Local consent mutation, batch
admission, ordinary cleanup and the permanent consent fence share one subject
lock. The fence compares the actual local preflight version under that lock;
a changed row cannot authorize handoff with stale evidence. Cleanup snapshots
are rechecked before the provider call, and admitted local calls are awaited.
This does not prove external SIM drain/commit. The normal cleanup worker waits
for the actual global account guard initialization before its first sweep.
The erasure-only store initializes and closes even when ordinary measurement
intake/cleanup flags are off; it enables neither collection nor a new worker.

The application database migration adds nullable
`cop_driver_measurement_consents.owner_issuer` and the private
`cop_driver_consent_erasure_fences` table. It changes no root metadata tables,
grants or secrets. Actual production schema permissions/history still require
acceptance. A pending operation retains the consent and minimal day inventory.
On the unchanged production image/source, COP performed a bounded counts-only
readback through its existing session/direct database route in a read-only
transaction: the actual table has zero rows and no active RLS filtering; the
new issuer column has not been applied. Thus this particular current COP store
has no historic null-issuer row to migrate. This does not establish zero SIM
history, complete offline outboxes/key versions or accepted native authority.
No identifiers, user rows or content were read. See
[the separate production counts evidence](../testing/account-erasure-consent-production-counts-20261014.json).
After the actual completed SIM proof, one local transaction verifies absence,
deletes the consent and clears all stored day dates. Completed retries compare
a fresh authenticated GET-only SIM proof and fresh local absence with the
durable checkpoint; they never reconstruct or POST a smaller contributors
manifest. The internal proof is now
`cop-measurements-completed-operation-proof-v2`, bound to issuer, existing
opaque alias, operation and immutable completed receipt; normal erase still
verifies full canonical contributor coverage before issuing it. Public OpenAPI
and mobile contract shapes did not change. This source feature remains
unactivated; no production job/configuration was migrated.
The remaining keyed fence, issuer, operation and proof/inventory digests are
technical pseudonymous protection, not anonymous data or account content.
Production continuity/retention acceptance is still required; no automatic
expiry for pending work or permanent fences was invented.
Messaging published source
[`ee3b464`](https://github.com/voldzi/csm_messaging/tree/ee3b4641962bf1a72e3709074d1ccc8a69e0ac44)
adds strict whole-owner v2, targeted mobility effects and actor namespace scope.
166 isolated tests, production compilation without warnings and binding
validation (six paths/nine schemas/33 references/13 negative cases) passed.
COP adds a strict server-only adapter; 70 targeted controller/HTTP cases passed.
Both preflight versions include the independently verified scopeVersion, so
namespace changes invalidate the confirmation plan even if provider readiness
version stays constant. Actual native resolver, Matrix
identity/devices/keys/media, protocol retention and restore acceptance remain
required; published source is not a production proof.
The new actor-specific scope boundary additionally requires an actual native
`cop_jizda_exclusive` witness for Matrix, notifications, conversations, devices
and policy metadata. Shared/unknown/matrix-only bindings block before the first
permanent provider fence. The exact scopeVersion is pinned in that fence and
rechecked through cleanup/readback. A changed scope stays pending; it never
authorizes global deactivation. COP exposes separate typed configured-owner and
actor-scope verifier ports; absence is unavailable, with no env boolean shortcut.
Local SQL/cache removal cannot stand in for external subscribers/copies.

Production safe metadata readback: no effective erasure secret/storeID/runtime
binding, dedicated Keycloak authority, explicit LiveKit admin URL or moderation
evidence config. No secret values were printed. Native guard binding, old-image
rollback rejection and restore quarantine/replay remain required; env labels
alone are not proof. Activation also requires OIDC-only account authentication
and an explicitly disabled lab token; current hybrid/lab compatibility cannot
prove all account writers fenced. No production authentication change was made.
Human-confirmed Proxmox off-server/X5 backup coverage is
accepted, but is not account erasure/replay acceptance. Do not ask again for a
backup-point identifier to repeat that confirmation. See [runbook25](../runbooks/25_ACCOUNT_SAFETY_GUARD_BINDING_PROPOSAL.md).
The human separately approved only the empty root metadata database and seven
restricted NOLOGIN roles. Infrastructure completed that exact migration on
2026-10-14 at08:26:39UTC and verified all nine tables empty, exact restricted
grants, no new LOGIN/member mapping and preserved existing role attributes.
COP independently reviewed the pinned execution receipt and exact SQL source;
it did not rerun the mutation. No enrollment, native service, credentials,
application binding, activation or restore acceptance follows from this step.
The actual COP per-principal fence stays in the existing shared mobility
transaction; the metadata database is not substituted as its store. See
[the separate foundation receipt](../testing/account-erasure-foundation-20261014.json).
Keycloak's discovered shared realm has been resolved by the explicit COP-only
human policy above; its narrowly scoped authority still requires acceptance.

Infrastructure also prepared an offline SQLite/flock state machine for durable
grant/revoke, admission, permit, fence and terminal order. COP independently
reviewed the source and ran the exact pinned corrected fixture: **47/47 PASS**,
all six owned children exited and zero owned fixtures remained. The review found
and the owner fixed a principal drain that omitted pending owner-wide work;
the regression preserves pending across unknown outcome and a new runtime
generation until the original terminal evidence. This remains an explicitly
synthetic source gate: actual owner evidence, independent anchor, native
transport, provider settlement, SIM login preservation and restore were not
verified, and every actual/production authorization flag is false. It supplies
no positive application callback or production wire ABI. Existing COP local
transaction guards remain its local authority. Exact scope and pins are in
[the separate dormant-core review evidence](../testing/account-safety-dormant-core-review-20261014.json).

A separate v5 byte/DTO candidate fixes the v4 schema URI references, permits
only a narrow new-generation own-origin current/settlement/drain channel, and
checks response permit/lease and drain/scope relations. COP independently
reviewed the exact unchanged source pins and executed **34/34 offline cases**,
with zero remaining owned fixtures. Existing COP Node24.21/AJV2020 8.20 also
compiled both candidate schemas and structurally validated four emitted
synthetic request/response pairs (eight DTO validations). The original failed
v4 compilation receipt is retained. Structural JSON Schema does not establish
lexical numbers/duplicates, cross-field relations or digest/actor authority;
Node consumer conformance and actual transport remain separate. No native
Linux producer, actual ownership/anchor/provider, application import/wiring or
production acceptance was established. The v3 state machine, its epoch/fences
and earlier v4 source remain unchanged. See
[the separate v5 boundary evidence](../testing/account-safety-boundary-v5-review-20261014.json).

SIM subsequently published the V5 Node companion at source `6e73a303`, with
its own exact-source **88/88 offline PASS** receipt at documentation HEAD
`3691cea7`. COP independently reviewed the four pinned client/helper/bridge/
runner files before and after review, and rechecked their hashes on the clean
SIM checkout. No concrete P1/P2 finding remained. The review checked lexical
limits before lossy parsing, descriptor/proxy-safe canonicalization, response
lease/scope/CAS/correlation relationships, and preservation of in-flight unknown
until the injected exchange promise actually settles. There is no inferred
abort, settlement or fallback. These files remain scripts only, with no
application entrypoint import or positive runtime verifier. COP did not rerun
or add SIM's 88 cases to its application count. This closes the selected source
review; actual transport, identity, owner evidence, anchor, settlement and restore
acceptance remain open. See [the companion source review](../testing/account-safety-sim-v5-companion-review-20261014.json).

## Isolated administrator authentication follow-up

COP ran **8/8 actual isolated authentication cases** on an already available
PostgreSQL18.6 Linux Alpine image, with only an owned container and tmpfs data.
The narrow candidate inserts `local all postgres peer` and
`local replication postgres peer` before the existing corresponding trust rows.
OS postgres could authenticate as DB postgres with verified `peer:postgres`;
OS root and nobody were denied without falling through to trust. Physical
`IDENTIFY_SYSTEM` succeeded for postgres and was denied for root. A synthetic
ordinary LOGIN retained trust, and the first FoodKnowledgeCollector reject
remained effective for both tested OS users. The root reviewed proof, raw command
results and all three source/HBA/raw pins without rerunning the cases.

The container and its temporary database were stopped and removed. No host
ports, bind mounts, persistent volumes, network, pull/build/install or production
changes were used; existing Docker volumes remained28 before and after. The
container used the default logging driver with synthetic data only. This closes
only the isolated behavior check. Actual production caller compatibility,
Patroni/config owner binding, TCP authentication, fresh DCS comparison and a
separate human authorization remain required before any HBA application.
No technical LOGIN, grant, key, deployment or activation follows from these tests.
See [the bounded authentication evidence](../testing/account-safety-narrow-peer-auth-20261014.json).

## Verification / release

SIM's Driver retention follow-up is source `25de85ab`, with documentation and
evidence published at `57302f4b`. COP independently reviewed all seven pinned
implementation/test files and the 37 focused test cases, then verified the
unchanged pins and clean SIM checkout. No concrete P1/P2 finding remained.
Construction dispatches no cleanup; the explicit lifecycle uses one immutable
cutoff and transaction, and close awaits actual local cleanup/COMMIT/release
even if its injected consumer resolves or rejects early. Permanent erasure
ledger/fences remain untouched. The fixed standalone path has no PG/env fallback.

The production lifecycle factory and standalone path reject UNBOUND before
pool/secrets/SQL. Ordinary measurement route registration may still read its
existing intake settings and create a lazy pool; unbound retention start refuses
before store.init SQL. The application catches this refusal and preserves
unrelated Search/Feature registration. This is a source claim, not live API
acceptance. SIM's 37 focused cases are included in its 628 workspace passes;
six older opt-in PostgreSQL cases were skipped. COP did not rerun or add these
counts to its own tests. The local owner/cutoff callback is not a native/replay
proof. Actual PostgreSQL retention, maintenance authority and restore remain
unverified, and the image remains nondeployable even with intake flags off.
See [the bounded retention source review](../testing/account-safety-sim-retention-review-20261014.json).

Full-suite baseline verification on 2026-10-14 used clean documentation HEAD
`4a1154146b1cd99daedb7e18956fd1c65fc2021b`, with unchanged application
implementation `898cd5132f513259b226d5beff5c3876156b56e7`:
**2,429 reconciled passed cases, zero remaining failures, eight older opt-in
PostgreSQL skips** across 247 files / 2,437 cases. This is not one green full run:
the original complete run had 2,412 passed, four environment failures and 21
skips because the owned PostgreSQL18.3 environment lacked PostGIS. Only the 17
blocked cases were then rerun on an already available actual
PostgreSQL17.5/PostGIS3.5.2 image; all 17 passed. Reconciliation preserves exact
file/name/parameterized occurrence and replaces only these 17 original results,
without duplicate pass summation. Both original reports and hashes are retained.
The new consent PostgreSQL cases passed on the separate actual PostgreSQL18.3
cluster. Both owned database environments, the container and temporary synthetic
credential were stopped/removed; source remained clean. No installation,
production mutation, real account, phone or restore was involved. See
[the final bounded regression evidence](../testing/account-erasure-final-regression-20261014.json).
Do not add the overlapping 99-, 72-, 44- or pair-test counts below to this count.

Earlier wider verification before the latest follow-ups:

- Full suite: **2,393 passed, zero failed, eight skipped**, 243 test files.
  Skipped cases use seven separate legacy test database configurations (profile,
  driver consent, mileage, mobility, receipt details, vehicle audit and safety
  notification). New account-erasure PostgreSQL/PostGIS and signed HTTP cases
  ran on the isolated actual database without skips.
- The actual local erasure lanes cover PostgreSQL17/PostGIS3.5 and a separate
  PostgreSQL18.3 cluster. Fences, late writes, immutable provenance, duplicate
  publication, recovery and the unaffected second user are exercised.
- The complete unit/contract/HTTP suite includes scoped Keycloak18, provider
  cache93, new actual four-instance server wiring/503 cases, strict SIM HTTP
  adapter37 and changed Messaging namespace impact. Counts overlap and must
  not be added to the full suite count.
- API/web typecheck, all changed code ESLint, skeleton,11 JSON schemas,
  OpenAPI JSON and generated YAML passed. OpenAPI retains24 existing warnings.
- All16 workspace builds passed. Bundle budgets, actual local static-runtime
  smoke and public-demo analytics release/privacy checks passed. Vite retains
  its existing Cesium large-chunk advisory; the separate bundle budget passed.

The first published source/test boundary is
[testing/account-erasure-20261014.json](../testing/account-erasure-20261014.json);
the subsequent compatibility/resume and X5 build-only corrections are recorded
in [testing/account-erasure-resume-20261014.json](../testing/account-erasure-resume-20261014.json).
The technical COP–SIM loopback pair was also independently run by COP with
actual COP adapters from `a0c6fd683ab51fa677c485e22c9f9e83621a188b`
and actual SIM Express handlers from compatibility source
`7bd5a6381006810c7a4bf3ffa51d13e3b63a61ed`: **10/10 PASS**. It covers
200/202,401/503, complete historical retained/outbox days with two key
versions, pending publication and accepted-only feature-off resume; unknown or
foreign operations stay blocked. Store, identity/continuity authority and
publication dependencies are explicitly synthetic. No PostgreSQL, physical
phone, actual Root proof, provider or production acceptance is inferred from
this runner. External/model/matcher calls were zero. Exact handler/adapter
hashes and the separate technical acceptance boundary are in
[testing/account-erasure-cop-sim-http-20261014.json](../testing/account-erasure-cop-sim-http-20261014.json).
Do not add these cases to the full unit suite count or relabel the earlier e2
verification as this corrected pair.

Provider mocks do not establish actual provider permissions, root resolver
coverage or production account removal. Actual shared SIM login/refresh after
scoped revoke, physical whole-account use, native restore quarantine and
completed-history replay acceptance remain unverified. No real account was
used or removed; no OpenAI call was needed.

The separate web identity follow-up passed 44 targeted transport/DOM/service
worker cases, with no failures or skips; web typecheck, scoped lint/format,
web production build, bundle budgets, skeleton and public analytics checks
passed. The build retains the existing Cesium chunk advisory. API behavior,
OpenAPI, native SDK and production were unchanged by this follow-up. This is
not a real-browser login or real-account deletion acceptance. Exact source file
hashes and commands are in
[testing/account-erasure-web-identity-20261014.json](../testing/account-erasure-web-identity-20261014.json).

The subsequent local-consent/controller follow-up passed 99 focused cases,
including four actual PostgreSQL18.3 cases and strict COP-SIM HTTP regression,
with no skips. Its own Unix-only cluster was stopped and the previous cluster
was not used. Root separately reran 72 controller/web cases with no skips,
reviewed the exact source/test receipt pins and passed API typecheck/build.
These gates overlap earlier counts; they are not a new full-suite run and
cannot relabel the original2,393-case or ten-handler-pair evidence. No real
provider, native authority, human account or production deletion was tested.
Exact source, SQL/lifecycle and verification boundaries are in
[testing/account-erasure-consent-followup-20261014.json](../testing/account-erasure-consent-followup-20261014.json).

COP also independently ran the new orchestration pair against clean published
COP source `898cd5132f513259b226d5beff5c3876156b56e7` and the exact actual
SIM handler bytes from application source `7bd5a63`, with frozen runner
SHA-256 `5aba43cc6bac09b98a3ffb01b830037eb019784ea9037efc7b89ef5851698088`:
**8/8 PASS**, 53 loopback HTTP requests. It uses the actual COP controller,
local in-memory consent implementation/composition and SIM Express handlers.
It covers first handoff, pending202, complete old local day inventory,
feature-off own-operation resume, interruption after local purge and a
restarted controller's fresh GET-only completed proof, plus foreign actor/op
and missing identity/authority denial. Stores, identity/native authority,
publication and other owners are explicitly synthetic. PostgreSQL, physical
restart/login/iPhone, actual Root/provider/backup and production acceptance are
not inferred. Provider/matcher/forbidden network calls were zero. The old ten
adapter/handler pair receipt remains unchanged. Exact new scope and source
pins are in
[testing/account-erasure-cop-sim-controller-http-20261014.json](../testing/account-erasure-cop-sim-controller-http-20261014.json).
The new runner requires a clean exact898 checkout; a later documentation-only
HEAD cannot be substituted without a separate reviewed pin.

The X5 build-only source option now supports a separately provisioned, clean
root-owned read-only detached COP checkout with an explicit exact source pin.
Seventeen actual Git/argument tests and53 existing runtime fault regressions
passed. It changes only the API build context/revision label, preserves current
operational helpers/locks/health baseline, and does not reset `/srv/cop`. This
source option has not built a production image or changed the accepted script.
See [runbook24](../runbooks/24_COP_API_RUNTIME_PROFILE.md).

### Dormant BFF compatibility for existing sessions

The legacy web session format from accepted source `b13fbdc` contains no issuer.
Ordinary refresh now requires the same verified subject and requires issuer
equality only for a previously known issuer. It rotates credentials in the
existing row without adopting historical ownership: absent profile issuer and
SQL `owner_hash=NULL` stay unknown; cookie, session ID and original lifetime
remain unchanged. Such history still blocks erasure preflight until its legacy
session expires or is revoked. A new login records its own verified issuer;
it does not adopt the older row. Known ownership mismatches, any legacy fence, revoked
or missing rows remain rejected; the signed-actor global guard is unchanged.
PostgreSQL uses owner → legacy → row lock ordering, with the any-fence recheck
after acquiring the legacy lock. No new schema, configuration or public API is
introduced by this compatibility correction.

The focused combined gate passed **44/44** cases in seven files, including five
actual PostgreSQL18.3 cases seeded with the old encrypted payload and old table
without `owner_hash`. It checks migration, NULL preservation, restart, identity
mismatch, concurrent revoke and a real advisory-lock wait with a successful
control `FOR UPDATE NOWAIT` before fence recheck. A session that expires while
waiting is rejected after the lock without changing its encrypted credentials.
Existing account controller, BFF outage and additive restore composition
regressions are included. API
typecheck/build and scoped ESLint passed. The first sandbox initdb attempt
failed on shared-memory EPERM; the separately authorized isolated Unix-only
cluster completed and was stopped and removed with its fixtures. The prior
cluster and production were not used. These cases overlap earlier gates and
must not be added to old full-suite counts. No real login, provider, native
authority, physical device or production acceptance is inferred. Exact source
pins and commands are in
[testing/account-erasure-legacy-bff-refresh-20261014.json](../testing/account-erasure-legacy-bff-refresh-20261014.json).

The combined follow-up is published at application source
`b5c154b8a492d4f5578f4a369677c6c693160494`. COP root independently reviewed
the implementation, verified all ten frozen source/document pins, checked the
actual 44-case console report hash and summary, and observed the owned cluster
directory absent after cleanup. It did not rerun these tests. The older
2,429-case reconciled full-suite result belongs to `898cd51`, not this new
source; counts are not added. See [the release review](../testing/account-erasure-legacy-bff-release-20261014.json).

Before first acceptance, a dormant staging deployment must keep intake false,
add no erasure secret or required-guard/runtime binding, and verify there are
no previously accepted jobs or guard markers. Intake false alone does not
disable recovery workers when an erasure service is configured. After first
acceptance, preserve the existing secrets and guard bindings even with intake
false; never use this initial dormant profile as a rollback bypass.
Activate only after
actual two-synthetic-account owner/readback/restore acceptance and native binding
of exact source/image/store. After first accepted deletion preserve keys/fences/
checkpoints through rollback. Never run an old unguarded binary or expose restored
services before replay. No actual account erasure/production activation is claimed.

### 15October — implemented independent journal and private consumers

[ADR0054](../adr/0054_INDEPENDENT_PSEUDONYMOUS_ERASURE_JOURNAL.md) defines the
actual journal-before-local-fence path and version4 controller. It restores the
fence before admission, checks continuity on writes/workers/receipts, expires RAM
admission and rejects foreign/stale replay. Permanent manifests contain no
recoverable principal. A lost local pending identity needs a fresh matching
signed actor or verified restore inventory; background workers cannot invent it.

Actual Root journal:8Linux/PostgreSQL18.6/Ed25519 cases. COP controller and
loopback regression:54cases. Signature/consumer tests:13cases. Alpine/muslNode24.20
transport:7kernel,4original-operation client,3driver-read client and4continuity
client cases. Channel SQL/owner facts are synthetic; overlapping scopes are not
added to historical suites. Exact pins and limitations:
[continuity evidence](../testing/account-safety-continuity-source-20261015.json),
[minimized journal receipt](../testing/account-safety-fence-journal-minimized-20261015.json).

SIM publishes its actual read-only facts/Root reader at
`f85d2bbc294845edf412a8a18f9e3138fcc25968`. COP's fixed read client/broker verifies
native identity, signature, request/reference/checkpoint/runtime bindings and
private Root delivery. The application never selects a Root permit.
Independent on-demand permit/context production, complete owner wiring, restore
quarantine, deployment latch and target installation remain unfinished. The
production SSH account cannot run sudo noninteractively. No production service,
new LOGIN/grant, image/flag or real account was changed by these checks.
