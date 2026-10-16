# ADR 0055 — Database-backed account erasure and recovery

Date: 2026-10-15. Status: implementation in progress, not deployed.

## Decision and trust boundary

For the production completion candidate use explicit `database_v2` authority.
This replaces the **uninstalled** native process/signature implementation of
ADR0054 for this mode. The application operators, reviewed application code and
database administrators are trusted. We do not try to defend an account from
an intentionally malicious backend by introducing a privileged signing broker.
The old source and evidence remain available; their tests are not evidence for
this alternative. The default stays `native_v1`; no failed check falls back.

Preserve verified OIDC identity, COP/Jízda scope, shared SIM access, immutable
operation/body binding, durable admission fences, transactional writer locks,
resumable jobs, explicit pending receipts and provider-specific cleanup proofs.
A missing owner must still prevent full completion. No fake positive verifier
or capability label replaces a provider's actual checks.

The shared PostgreSQL stream records per-change ownership from the actual source
ledger at publication. Erasure requires both that separate binding and the
source-generated account/operation manifest. Shared envelopes preserve all
other changes and their provenance. Publisher and notification delivery use the
same database barrier as erasure; guarded SQL failures cannot deliver a local
fallback. Existing unbound rows remain unresolved instead of being assigned to
an account from a payload string. The guard follows configured erasure state
even while new erasure intake is disabled, including during rollback.

For a same-host LiveKit deployment, an explicit Messaging relay can replace the
direct HTTPS admin transport. COP signs a new thirty-second standard LiveKit
grant for each bounded request and sends it over the existing HTTPS service
API. Messaging accepts only fixed room-list/probe/presence/remove-self actions;
mutating requests require its real persisted account/operation fence and bound
scope version. It never receives the long-lived LiveKit signing secret, selects
another participant, deletes a room or forwards an arbitrary RPC. The internal
hop is selected explicitly, without fallback: either the actual kernel default
gateway pinned to the reviewed comm bridge172.18.0.1:7880, or the protected
UID1000/mode0600 Unix socket in its mode0700 directory. The gateway path timed
out on comm. The verified Unix mode uses a constrained credential-free sidecar
whose fixed destination is the existing127.0.0.1:7880 listener. It opens no TCP
listener or public port and changes no firewall. A topology or socket protection
change fails closed. This trusts the existing same-host communication boundary;
there is no HTTP fallback in COP's direct HTTPS provider and no new public admin
port. Unknown transport or unavailable scope fails closed. Selecting both
transports is a configuration error. This relay does not establish whole-account
readiness or replace private Synapse cleanup and restore acceptance.

## Simplified completion scope — 16 October

The approved completion path does not reconstruct a missing principal from an
immutable seal, account MAC, operation inventory or provider evidence. A missing
or mismatching original identity leaves the operation pending and the affected
restore quarantined. The existing flow may resume only after a freshly verified
original actor re-establishes the exact account binding; it never adopts another
account. This narrows the implementation under review without weakening fences,
provider readback, retention or shared SIM identity preservation.

The production entrypoint binds the actual database continuity instance to the
restore owner and the media settlement verifier. The restore checkpoint proves
live suppression through the independent journal and actual SQL replay, not
physical removal of retained Proxmox/PBS copies. A trusted operator must preserve
the independent evidence and quarantine every affected dataset restore. See
[the executable restore procedure](../runbooks/26_ACCOUNT_ERASURE_BACKUP_RESTORE.md).
No change to an image label, environment flag or backup catalog can replace these
checks. Intake stays off until joint provider acceptance and production binding.

## Independent evidence

Migration `scripts/account-safety/010_database_safety_v2.sql` creates only the
`cop_safety_v2` schema in `cop_account_safety_guard`. It leaves the earlier
`cop_guard` tables intact. An administrator explicitly enrolls the guard ID,
application store ID, configuration fingerprint, incarnation and initial replay
binding. The application does not enroll itself or change those bindings.

COP appends the exact pseudonymous fence before committing its local job. The
runtime can insert but cannot rewrite/delete/truncate this evidence. Sequence,
previous digest, operation and account are immutable. Snapshot verifies the
complete canonical hash chain and its column/payload bindings. A lost commit
acknowledgement is retried using the same account and operation, preserving the
original request date. Another account/operation pairing is rejected.

The journal stores no recoverable principal, user content, location or key.
Its account MAC and operation linkage are pseudonymous, not anonymous. It has no
automatic expiry. SIM maintains its own independent per-owner tombstones with
only the final identifiers required to replay its transactional deletion.

## Startup and restore

Production transport: the independent guard uses verified TLS to
`haproxy.home.cz:5000` with the already deployed PostgreSQL CA at
`/etc/vcode-cop-pgbouncer/postgres-ca.crt`. When the business database uses the
protected Unix transaction pool, readback uses the existing verified
`COP_STREAM_BUS_DATABASE_URL` session route to the same database. The factory
does not change the business route or try TLS on the local Unix socket. It
rejects another database, missing session route, arbitrary endpoint/query
overrides and TLS downgrade. URI SSL fields are validated before removal so
they cannot override the explicit actual-CA `rejectUnauthorized=true` config.

Before admitting traffic the controller reads the independent journal, installs
all local fences in its actual transaction store, and verifies the resulting
local jobs and configuration by SQL readback. Only then may it advance the
replay cursor. Runtime UPDATE rights cover that cursor only. Ordinary restart
does not require a new enrollment. Missing/foreign binding, an absent journal
prefix, an unmatched local job or a database outage deny admission.

Stop COP and the affected SIM services **before** restoring application data;
keep external exposure closed. Do not restore the independent guard database
from the application snapshot. Explicitly enroll a changed incarnation or
restore generation. Start in isolation, replay COP and SIM tombstones, verify
fences, zero counts and pending operations, then open traffic. An older image
that does not perform this startup gate is not an allowed rollback image.
This procedure and its real restore test are release requirements; the SQL
schema by itself does not enforce hypervisor or operator actions.

If local pending identity is lost, COP restores a fence and a pending job. It
does not guess a principal or claim completion. SIM can replay an already
accepted manifest independently. A pending COP job without recoverable identity
still needs verified ownership recovery before its remaining local cleanup.

### Dataset binding and copied completion checkpoints — 16 October

The database continuity snapshot now includes the actual administrator-enrolled
incarnation and restore generation. COP records that binding in its private
version4 configuration and verifies it by SQL readback before advancing replay.
The first-empty installer writes the initial binding explicitly. An empty,
unaccepted store may record the already verified database binding; existing
accepted history without a binding is quarantined, not silently adopted.

Ordinary restart in the same binding preserves completed checkpoints. An
explicitly enrolled higher generation with a new incarnation invalidates every
copied completion checkpoint and terminal timestamp, preserving the original
account MAC, operation, requested date and permanent fence. A still-present
encrypted principal must decrypt and match that exact account MAC; otherwise
fresh verified ownership or the separately verified restore inventory is
required. No identity is guessed from journal metadata. Reused incarnation,
generation rewind, missing or malformed bindings fail closed before import.

This global COP recovery binding must advance after **any** affected owner
dataset is restored, including a standalone Messaging/Synapse restore when the
COP database itself was not restored. Stop/quarantine the affected services,
perform the explicit administrator bindings, replay and verify every actual
owner again, then expose traffic. The cursor proves installed fences, not
provider cleanup. Neither a copied terminal receipt nor an unchanged operation
UUID proves current provider effects. This source is not an administrator
restore tool and does not authorize an automatic binding change.

The same verified binding is passed server-side to each domain owner; it is
not accepted from HTTP/client input. A domain's own durable sub-checkpoint
must not make the controller's replay reset ineffective. The Keycloak owner
stores this binding with its exact shared-identity/client fingerprints. Only
an explicitly higher generation with a different incarnation permits a fresh
assessment/revocation of copied COP grants. Changed shared identity or client
UUIDs, missing historical binding and ordinary same-generation recreated grants
still fail closed. Completion is re-read from the provider and bound to the
new recovery generation; shared identity, SIM grants and global SSO survive.

Current tests include actual PostgreSQL-persisted completion/reset and unchanged
journal readback, plus controller cases for same-binding restart, pending actor
recovery, copied foreign encrypted identity and invalid bindings. Provider
effects in the new PostgreSQL controller case are explicitly synthetic. They
are not a physical backup/restore or whole-provider acceptance.

## Current evidence and remaining release gates

Nine actual PostgreSQL tests cover concurrent/idempotent append, account and
operation conflicts, immutable permissions, incarnation mismatch, caller-input
snapshotting, SQL replay readback and controller recovery after local rollback.
Provider effects in the controller recovery case are deliberately pending.
The joint case exercises the authenticated COP HTTP handlers, controller,
actual COP/SIM adapters and real SIM HTTP/PostgreSQL services. It verifies local
consent cleanup, measurement deletion, key deletion, preserved SIM namespace,
fenced old bearer and unaffected second actor. Other owners deliberately stay
pending, so the response remains202 and accountDeleted=false. A first run failed
because its synthetic Router seed used the wrong hash algorithm; the fixture
was corrected to BudgetStore's actual SHA256 derivation before the passing run.

These tests do **not** establish end-to-end COP/SIM/Matrix/LiveKit completion,
production enrollment, production restore acceptance or deployment.

Remaining: actual production owner composition, shared HTTP/database acceptance,
scoped Keycloak authority, reviewed least-privilege provisioning, deployment and
isolated restore acceptance before enabling account deletion.

### Media transport source preparation — 16 October

Optional `COP_MEDIA_UPLOAD_TRANSPORT=cop_api` stops issuing new external PUT
signatures and uses the existing authenticated COP POST upload with normal
writer ownership/fencing. Default stays legacy. Descriptor POST/transport fields
are additive in the binding OpenAPI and do not introduce another credential.
This is not acceptance of legacy credential revocation, provider drain or backup
restore. Those require real independent evidence; the settlement verifier remains
mandatory and cannot be replaced by this configuration flag.

### LiveKit expiry settlement

The actual LiveKit1.13.3 probe accepted a join JWT after its nominal expiry
and first rejected it about60 seconds later. Voice cleanup therefore waits for
the one-hour maximum issuer lifetime plus90 seconds (provider tolerance plus
30 seconds clock margin), and at least90 seconds after every durably recorded
grant expiry. The shared acceptance also requires an actual401 for the original
join token; a locally decoded `exp` is insufficient.
