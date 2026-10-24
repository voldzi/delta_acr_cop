# COP arrival: exact image-pair release and safe reversion

Status 24 October: SIM and COP deployed and independently verified.
[Production receipt](../testing/user-selected-arrival-production-20261024.json)
records the actual active image/CAS, protected pins, unchanged configuration and
fresh COP adapter→SIM→Valhalla acceptance. Signed-in native/iPhone acceptance is
still pending and is not implied by server readiness.

## Authorized pair and unchanged state

- Old: `sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c`, app revision `c1ca66ff49c8e250ec260bd199f0d41502d8d600`.
- New: `sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430`, app revision `333352a79cba641393e407e32d0a175867ca32c2`.
- The latter inherits the exact old image and eight allowlisted routing/source/
  schema/OpenAPI files. Image configuration is identical except revision label.
- Current data, OIDC/no-lab, roles, credentials, erasure intake/fences/jobs,
  database profile/incarnation, mounts, networks and other services stay unchanged.
  No reset, erasure operation, restored database, schema downgrade or intake pause.

Human approval in Jízda on 24 October covers both accepted and pending reversion,
following the original forward review and the separately explained recovery risk.
The historical review JSON and its hashes remain unedited; this implementation
supersedes its proposal-only state without rewriting that evidence.

## Operation

The public bundle is on X5 at
`/srv/x5-production/staging/cop/work/job-fa4230c846b54cd188c3ac75da93ff26/arrival-pair-20261024`.
The exact [bundle manifest](../account-safety/user-selected-arrival-pair-bundle-20261024.json)
pins installer, runtime, immutable authority/worker, two separate probes and the
application patch allowlist. Installer SHA256:
`105580b95a272055a1a3ed8bc568e3209c3c22ee1cd2990a9939fb318b328fec`.
Only this final installer is for execution; earlier unissued preflight installer
hashes are superseded. The exact verified-memory Root invocation was handed to
Jízda for one coordinated human-operated SSH/sudo step. The agent does not bypass
Root authentication or the rejected iTerm control surface.

`--check` is read only: image/layer/config/file checks, actual native Sharp,
imports, accepted SIM image/receipt and a new live SIM route/proof check. It does
not install the guard. It passed against the deployed SIM before handoff.

`--apply-approved-arrival-pair` rechecks everything, seals the exact immutable
helpers, atomically installs the reviewed runtime source preserving permissions,
creates a fresh <=15 minute exact-image Root review and uses the ordinary
`prepare`/`activate` guard. Historical proof files/helpers are never overwritten.
A separate immutable Root health reference preserves the pre-forward healthy
state as a comparison reference; it is not a database snapshot or renewed old
observation. Actual post-return health must be fresh.

The final smoke uses the real production COP adapter and SIM/Valhalla plus
anonymous/lab HTTP rejection. This is not a signed-in user HTTP/SDK/iPhone test.
That final acceptance uses the user's actual native session after server success;
no synthetic production JWT or new login credential is issued.

On forward failure, the installer attempts the separately approved exact return.
An explicit later `--revert-approved-arrival-pair` uses the same closed authority.
The existing generic rollback/recover-rollback prohibitions remain in force.

## Reversion and interruption

A return is a new fresh `maintain` release, retaining the current configuration
and all durable fences/jobs. A pending forward is not deleted to make the guard
pass. The closed coordinator verifies its exact digest, original source/release,
CID/CAS, image pair, profile, full runtime/peer/configuration parity and protected
Root proof. Its own private journal blocks concurrent releases. It runs the same
image, mount, overlay, health and CAS checks as ordinary release.

Only after fresh health and successful CAS does it atomically move original
`pending.json` and its health reference into a private retained history directory.
Original bytes and Root proofs are preserved. Interrupted reversion may continue
its already created, unchanged approved target after fresh actual health without
restarting it again. Any new mutation still needs unexpired Root authority.
Accepted reversion does not depend on getting healthy responses from a broken
new API: it uses the retained Root reference and requires new post-return health.

If Docker, target identity/configuration or health cannot be proved, the operation
fails closed and retains checkpoints. This is not an unconditional availability
or recovery-time guarantee. Never delete journals, use a plain Compose image
swap, restore old data or disable intake/fences as a shortcut.

## Live probe correction

The original Penny address was empirically time-dependent: it returned known
warning-401 rejection earlier, then a valid ordinary route was observed. Therefore
this address is not a deterministic negative fixture. The new separate COP probe
accepts exactly 422 `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED`, or HTTP 200 only
with full ordinary request/query/variant/feature/geometry/dataset/closure/expiry/
Valhalla-no-fallback/no-arrival/start-and-end<=25m validation. Selected arrival
has its independent 250m/25m and exact hash/feature binding checks. The immutable
SIM installer/probe `299420f8…` and its historical Root receipt are unchanged.
Deterministic warning-401 regressions remain required; no relaxed route is admitted.

Maneuver checks match current Jízda SDK `isNavigable`: contiguous begin/end shape
coverage from 0 through the final vertex, finite positive route metrics and finite
nonnegative step metrics. Arrival start==end is valid. The SDK does not consume
step.geometry or require step.index==enumerated index; the probe must not invent
these requirements. The destination maneuver may contain `[p,p]` while its route
slice has `[p]`. Traffic-current metadata must be internally consistent if present;
this probe makes no independent fresh-speed or legal-access claim.

## Evidence and limits

- 85 existing runtime tests; 14 reversion fault tests; 8 original forward and
  8 reverse authority tests; 5 installer-order/bundle tests: passed.
- 16 probe checks: ordinary 200/selected proof accepted; retarget, stale proof,
  wrong variant/hash/feature, unsolicited/null arrival, >25m snap, fallback,
  traffic dataset mismatch, maneuver gaps/negative metrics rejected.
- Actual Docker images: old→new→old and pending-new→old, all five real runtime
  parity phases passed without network/public ports; synthetic durable
  fence/job/pending bytes retained. Fixture containers removed. This is not a
  real COP application/database acceptance or a physical-device test.
- Skeleton and exact worker/authority hash pins passed.
- Actual SIM accepted image `9f0a6d78…` / revision `dd3a75b`; no-fallback
  Valhalla 3.8.3, graph `sim-routing-2026-10-18-1792292102`. Fresh routes are
  required at activation; old route timestamps are never refreshed.

The actual operator receipt is
`/srv/x5-production/staging/cop/work/job-fa4230c846b54cd188c3ac75da93ff26/arrival-pair-20261024/operator-result-dbbec9d1233247c19d09a8507a77bc8f.json`.
Independent post-deploy verification confirmed image `3f0054cb…`, release
`release-5a0826a378b54d0aaa935bb28f147d95`, generation
`6d767891c0944954a737687c178d8c94`, all three health endpoints 200/ok, exact
Root helper/guard metadata, no pending checkpoints and full env/config/profile
parity except the approved image/runtime release labels. Fresh explicit arrival
was 177m/49s, 5 maneuvers, remaining 26.79044m, snap 1.08460m, Valhalla 3.8.3
auto without fallback. This does not prove signed-in user HTTP/SDK, physical
arrival, legal access or fresh traffic speeds. TestFlight/App Review remain
unauthorized.
