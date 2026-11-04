# Superseded working notes

Historical only. Current state: docs/deployment/shared-vehicle-communication/README.md.

# Paired vehicle conversation release review

Prepared 4 November 2026. Source review artifact, **not an executable installer,
Root authorization, image build receipt or production acceptance**.

The adjacent `release.review.json` pins both published payload revisions,
contracts, observed production image IDs, the exact four configuration keys,
ordered installation and rollback conditions. Its target image IDs now refer to actual built artifacts; a source SHA cannot
substitute for an actual built image digest. See the adjacent productionState
for partial deployment and evidence limitations.
The source revisions precede this documentation commit and are immutable payload
pins, not instructions to build a moving branch or this directory's HEAD.

## Installation boundary

The app executor currently has passwordless access only to three fixed
`cop-reviewed-release` actions. That broker is pinned to the earlier
login/location release (COP API c06c… / web3606…); its status rejects the current
state after subsequent accepted image51a… . It is not a general application
release authority and cannot install these candidates. Do not rewrite its pins,
use OS-maintenance sudo for an application command, invoke an unrestricted
container swap or use another application's builder as an alternative.

The builder failure was subsequently diagnosed and resolved on4November: the
exact dedicated BuildKit container was absent while its reviewed definition,
local pinned image and X5 bind volume remained intact. The existing
recover-cop-builder.py passed its3 offline checks and restored only that owned
container under the application storage lock. Receipt reports runtime X5 verified,
cache preserved, no prune and no application restart. No shared builder changed.
A fresh verifier is still required before every build; the historical missing
container is no longer an unresolved Root blocker.

The **concrete missing Root work** is: verify the existing build custody; build
both exact payloads with approved resolved bases; record image/dependency/config
parity and actual tests; seal only those two images and the four declared keys
in the existing application release profile; expose a fixed action for that
sealed release if noninteractive execution is intended. General sudo, arbitrary
command/path/environment authority and weakening runtime/erasure checks are
outside this proposal. No password or token value belongs in this artifact.

Install the Messaging candidate first and COP second, both disabled. The source
Compose declarations forward the feature flags explicitly; adding .env entries
without updating the actual container is insufficient. Preserve all other
configuration, credentials, networks, mounts and account-safety controls.
Separately review the dedicated controller custody, then run live synthetic
paired acceptance before approving enabled values. Never reuse the administrator
or cop.ai.agent as the room controller. The observed production Matrix server
name is docker.home.cz; a proposed controller name must be checked for absence
and prior use, rather than adopting an existing principal by name.

This candidate requires no new business tables or broad database rights; it
uses existing internal VehicleState and Messaging JSONB store/CAS. Existing
healthy database_v2 protections and at least two Messaging pool connections are
mandatory. Do not re-run account reset, erasure installation, role grants or any
historical migration merely to release this feature.

## Return and recovery

Before **any** enrollment, the existing guard may return to the exact healthy
baseline only after proving that neither source intents nor managed room records
were created, including synthetic acceptance records. Do not infer this from a
false flag alone. Keep actual current runtime/configuration evidence.

After enrollment, the supported containment is to disable admission/UI while
keeping the new cleanup-capable writers running and retaining all pending
intents/bindings. Let exact outstanding revocations/closures finish. Returning
to an older writer, rolling back source membership, deleting managed metadata
or replacing an immutable operation to obtain success is prohibited. Already
handed-off messages, SDK transactions and APNs cannot be recalled.

A partially completed paired release needs explicit reconciliation of actual
image IDs, config, pointers and durable state through the existing guard. This
artifact is not authority for an automatic retry or older-image fallback.

## Evidence and exclusions

The current source evidence is in
[the integration contract](../../integration/36_SHARED_VEHICLE_COMMUNICATION.md).
COP77 focused tests, Messaging260 pass/41 skip, earlier isolated PostgreSQL3,
SDK39 (including4 new typed pending-response checks) and phased actual Megolm acceptance are distinct results. None supplies
live COP/COMM, APNs or physical-phone acceptance. Jízda's production gate remains
off, and no TestFlight publication is authorized.

Read-only compiled baseline checks matched production `mobility-service.js`,
`routes/mobility-routes.js` and `cop-state-erasure.js` exactly. `server.js`
differed only in comments/formatting. This limited check does **not** establish
whole-image or dependency parity for a new full rebuild; record that separately.

## 4 November deployment evidence

COP API candidate e4a94bb3… was built from dd545c2 with the official pinned
Node24.22.2 base, matching the running runtime version. All77 focused tests
passed inside the actual candidate without production secrets. Candidate Sharp,
socket/CA, runtime parity and read-only database/X5 guard probes passed; the
source-only and actual-image checks remain distinct.

Messaging e9c50077… is running healthy on COMM from50e590c, with admission off.
Its image pin changed only services.api.image. The initial full raw HostConfig
and Mounts comparison failed after recreation and the old raw object was not
retained. This is an evidence gap: do not claim full raw preservation or paired
acceptance. The supplemental declared-contract check also stops on the existing
csm-messaging_messaging-data volume, created8July without Compose labels. No
exception to that ownership check has been approved. No volume was recreated,
deleted or relabeled during this deployment.

The application-owned image-only release broker is under scripts/self-deploy.
It accepts only fixed status/prepare/activate operations and a private request
containing revision and expected generation. Code must be a published approved
branch head (initial immutable candidate separately pinned); the Root-owned
copy is checked against every Git blob. It pins the Node base and Dockerfile,
preserves the full effective environment and runtime topology, and requires
actual image tests, read-only compatibility probes and fresh health/CAS checks.
Configuration changes, other services, arbitrary shell actions and automatic
rollback are outside its authority. Installation is not deployment acceptance.

## Failed COP activation and required recovery

The application-owned broker was installed with only fixed status/prepare/activate
NOPASSWD operations. Actual status and candidate preparation passed, including
actual77-test JSON results, database/X5 probes, environment/topology and fresh
Root proof. The initial JSON output path and directory-mask installation defects
were corrected; the earlier failed attempts remain separate evidence.

Activation then encountered a real guarded startup failure:
ProviderCopiesUnavailableError during startup AI indexing. The candidate
restarts and is NOT accepted as healthy. The accepted pointer remains51a10099…
and the pending operation remains under runtime/api. Do not call activate again,
remove pending evidence, disable erasure guards or claim deployment completion.
Read-only live diagnostics verified journal snapshot(frontier2,2 fences), two
matching local jobs, configuration and dataset binding. The compiled provider,
account-erasure and PostgreSQL continuity modules match the prior image exactly;
this does not yet establish the underlying cause or a safe cold-start recovery.
A specific manual recovery approval was requested. No automatic rollback occurred.

Messaging supplemental observation now verifies current security and identity,
environment, source files, network IDs, peers and health. The user approved only
the exact historical volume exception. Legacy Docker Binds exposes no
CreateMountpoint field, so creation-time policy is explicitly unverified; the
observation does not overwrite the failed raw comparison or constitute full
paired acceptance. Admission stays off.

The user subsequently approved one manual intake-paused return to51a10099… .
Live read-only SQL showed0 COP conversation projections and0 Messaging managed
vehicle records. Exact pending/source/peer checks passed, the failed writer was
stopped, and the unchanged original recovery checks recreated the prior image
as UID1000 using a fresh Root-sealed one-operation permit. That prior image also
failed guarded cold startup. Health verification refused the commit; original
pending/active/health evidence is preserved under
/var/lib/cop-self-release/manual-return-20261104. Do not report recovery success.
The restoredContainerId in runtime/api/pending.json is now material state.

Guard snapshot, local replay data, permissions, default readonly/RLS/trigger
metadata and advisory lock counts passed read-only diagnostics. One explicitly
approved normal assertCurrent diagnostic was killed by the restarting main
container(exit137); its outcome is unproven and it was not automatically replayed.
The stable probe separates a pure read-only process from a separately approved,
O_EXCL-protected assert-once action; it never boots another API or worker.
