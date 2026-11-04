# Controller and configuration review — 4 November 2026

Prepared, not executed. No identity, configuration or admission changed.
The exact machine-readable scope is [controller-config.review.json](controller-config.review.json).
The 13-case [live acceptance plan](live-acceptance-plan.json) was copied byte-for-byte
from Jízda's prepared plan; results remain empty.

## Verified facts

A live read-only Synapse administrator GET at 19:26:53 UTC returned404/M_NOT_FOUND
for `@csm.vehicle.controller.v1:docker.home.cz`. Messaging was healthy, zero
restarts, exact accepted image, admission=false and controller unset. No token
was printed or saved. This proves absence then, not future custody. Creation
must recheck absence and refuse adoption/overwrite if a competing user appears.

The proposed localpart is outside the closed `cop_..._<hash>` human namespace.
Reviewed source `deploy/synapse/first_use_native_inventory.py` scopes that
inventory explicitly to the managed human namespace. No baseline rewrite or
human identity exception is proposed. The installed Synapse UserRestServletV2
source confirms that admin creation with password=null leaves password_hash=None
and supports user_type=bot, admin=false, empty external IDs and threepids.
However PUT is an upsert and is **not** the selected create path: a concurrent
creator could enter its update branch. The executor uses shared-secret POST
registration, whose deployed store uses INSERT and rejects duplicate user IDs.
That endpoint requires a password: an unpredictable transient password remains
only in process memory, inhibit_login prevents login/device creation, then the
supported immediate deactivate/reactivate path removes the hash before custody
and configuration. A timeout or unacknowledged create cannot authorize updates.
Deployed activate_account does not drain pending deactivation. Therefore the
executor keeps the controller deactivated while waiting (max10seconds) for
users_pending_deactivation to reach zero. The deployed background loop deletes
that row only after _part_user completes; timeout cannot reactivate or configure.
Custody checks include this queue. Before publishing custodyReviewed it explicitly
executes a <=60second device-less admin impersonation, exact whoami and logout
in finally, followed by token/device/crypto/queue-zero SQL/API readback. This
dynamic proof is not inferred from the admission-disabled capability endpoint.
A recognized token from a successful login always enters try/finally before
validating unexpected device/whoami response; logout is attempted even on those
failures. Tokens in non-successful login responses are never used. The test clock
is fixed and verifies an exact60000ms validity request with no requested device.
The original password=null PUT proposal is superseded, not silently reused.

The deployed Messaging adapter verifies controller name/admin/bot/active state,
empty devices and device keys on each managed operation; it obtains a temporary
device-less impersonation token valid for60seconds, verifies whoami and logs out.
Custody review must additionally prove no password, SSO bindings, cross-signing
keys or outstanding credentials. The existing runtime check alone does not prove
all these properties. No controller token is to be stored in environment or Git.

The exact three flags plus one identity are listed in the JSON. Controller
identity/custody can first be configured with both admission flags=false.
**Neither admission flag is an account allowlist.** Enabling both makes the
server path available to all otherwise eligible members, even with Jízda UI off.
The proposed30-minute/3-human/1-vehicle test budget bounds the test workload;
it does not isolate general server admission. A synthetic-only public pilot
would require a separately implemented admission restriction. The current plan
therefore requires an explicitly accepted general admission window, with immediate
containment on the first unproven permission/revocation or timeout.

## Concrete remaining execution boundary

Fresh `cop-self-release status` reported healthy runtime, generation
`55190b1dc87f4bf59dec02d3396c41a3`, zero restarts and
`canChangeConfiguration:false`. `sudo -n -l` exposes only the fixed COP release
operations; broader sudo requires an attended password. COMM has existing
noninteractive sudo. No automatic approval rejection occurred in this review.

The controller-only phase needs no Docker configuration change. Its fixed
executor and bootstrap are now implemented at `scripts/vehicle-controller/`.
Existing COMM sudo can perform this exact action without installing a new
sudoers grant, general Root session or administrator handoff. Default bootstrap
is read-only; `--apply` freezes only the digest-pinned source as Root400 and
runs it once, bound to exact current Messaging CID/runtime/config hashes and
peer IDs. COP status/source/image/generation is rechecked before and after;
COP itself is never modified. This is not an atomic two-host transaction.

The only allowed Messaging runtime change is the two controller identity/custody
keys, with admission remaining false. Actual custody must pass before pin
publication. Full runtime and resolved Compose output are kept only in memory;
private evidence records their hashes, not tokens. The original protected pin
is retained. Journal and parent directories are fsynced before provider writes.
Every collision, unknown custody result, changed source or parity failure stops
without automatic adoption, retry or rollback. A partial technical account may
remain unused and requires explicit recovery; it is not silently deleted.

32 deterministic boundary/protocol tests passed. The actual default bootstrap
also passed read-only against current COP and Messaging (404, SQL readback
availability, exact CAS, current declared environment and planned pin hash).
No provider write, installation or runtime change has been performed. Exact
source/bootstrap hashes and evidence are in controller-config.review.json.
A subsequent general admission window still requires a distinct COP config
operation; the code-only broker remains unable to perform it.

## Acceptance and containment

Use only3new synthetic humans (A/B members, C outsider) and1private test vehicle;
preserve original persistent native stores for history/key-denial checks. Prove
stable binding, explicit join, outsider denial, pending202/exact retry/restart,
joined removal, cancelled invitation, stale epoch/actor rejection, history/key
denial, actual notification handoff, vehicle closure and lifecycle/privacy.
Record each actual result separately; physical APNs/phone and TestFlight remain
outside this acceptance. Do not report planned cases as PASS.

Before enrollment, a return requires fresh proof of no source intents and no
managed rooms, then an exact guarded configuration return. After any enrollment,
disable both admission flags and UI while retaining the same images, controller,
custody and cleanup-capable writers. Preserve all durable operations/leases and
complete revocation/closure. Never delete pending records, restore an older writer
or remove/deactivate the controller while any room needs cleanup. Failed token
logout remains pending. Health failure must not disable erasure protections.
