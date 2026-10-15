# Root driver origin executor

This is a real, separately privileged SQL executor component. It is **not yet
installed or connected to either application**, and is not the whole account
erasure/restore authority. No production activation follows from these files.

## Fixed entry point

`root-driver-runtime.mjs --run --operation <uuid>` accepts one transient UTF-8
body on standard input, at most 16,384 bytes. `--probe --operation <uuid>` only
resolves the original operation. Both require real/effective UID0. Callers
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
container, no network/host mounts: **10/10** for real Root file custody,
durable records and actual Ed25519 outcomes. Root verifier unit cases use
explicitly synthetic metadata rows and signed test evidence. Actual production
metadata/enrollment/anchor, Linux native delivery and restore are unverified.
These counts are separate and are not added to earlier COP/SIM suites.

Run codec tests with `node --test scripts/account-safety/root-records.test.mjs`.
The PostgreSQL harness is an explicitly invoked workstation-only test
`node scripts/account-safety/test-driver-origin-postgres.mjs --run`; its SIM
checkout, SQL hashes, PostgreSQL18.3 binary and owned Unix-only fixture are
fixed. The Root-files test must run only in its dedicated disposable Linux
container with three owned tmpfs mounts; it refuses an ordinary host run.

## Remaining implementation and deployment

Do not deploy migration003 alone: the live revoke/erase/ack and retention paths
must all use the guarded executor before direct DELETE grants are removed.
The application delivery channel, accepted Root producer of permits/current
frontiers/owner inventory, installation/enrollment, complete owner-wide drain,
Root journal before the COP fence, quarantine/replay before restore exposure,
and production entry point bindings are still missing. The empty Root metadata
database does not implement them. These are implementation/deployment gates,
not a request for another general user approval.

Production still uses the previously accepted COP image; no real account was
deleted. Never wire a positive test callback into an application, activate the
feature using an environment bit, reuse an old image's attestation, or label
this component as completion of the eleven-owner account operation.
