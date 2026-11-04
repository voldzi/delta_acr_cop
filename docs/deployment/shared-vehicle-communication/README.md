# Paired vehicle conversation release review

Prepared 4 November 2026. Source review artifact, **not an executable installer,
Root authorization, image build receipt or production acceptance**.

The adjacent `release.review.json` pins both published payload revisions,
contracts, observed production image IDs, the exact four configuration keys,
ordered installation and rollback conditions. Its null target image IDs are
intentional: a source SHA cannot substitute for an actual built image digest.
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

The current unprivileged invocation of COP's dedicated X5 builder verifier also
fails. It does not establish the cause (custody/mount/configuration requires
Root inspection). No build or prune is authorized by a failed verifier. Root
must first inspect that existing builder and X5 custody, without changing shared
builders or global Docker settings. Ordinary application preparation resumes
only after that exact verifier passes.

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
