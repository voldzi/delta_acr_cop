# Assisted planning origin: server acceptance, 2026-10-29

This record distinguishes accepted deployment checkpoints from activation and
physical-device acceptance. No credentials, response bodies or private locations
are retained here.

## Source and image

- Canonical cold-start correction: `f574359feeb5da070347cd020fda545d64a79801`.
- Minimal planning-image correction: `7c43b690edf687fefc04e17533894d118f457276`.
- Production image: `sha256:6cdf302ea305e7fa58a11a1f9139deccd9f5b70cd0982a7ce87cd6b70d9d5c30`.

The production image is a reviewed two-file overlay of the earlier planning image,
not a full rebuild of the canonical branch. Its inherited OCI source label names
the parent revision; the overlay build evidence records the actual correction.
The correction preserves per-record projection bounds and the five-second
account-erasure continuity boundary. The synthetic cold-start suite passed 55
tests across five suites; it includes 204 individually bounded records whose
combined derived representation exceeds 1 MiB, plus rejection cases.

## Accepted server checkpoints

The precise WAF exception applies only to the field name
`json.context.vehicleProfile.coverageAcknowledged` in rule 930120, for POST JSON
on the two COP planning-origin paths. A benign unauthenticated request reached
the application's 401 response; the SQL-injection control remained blocked with
403. No general rule or field-value inspection was disabled.

SIM accepted the existing `cop` service actor on its unchanged routing image.
The initial transition failed strict comparison because Docker reordered six
`HostConfig.Mounts` entries. Root independently verified the exact finite
permutation, identical actual mounts and all other configuration, preserving the
original failure and the unnormalized actual signature. This is not a general
mount-order exception. The accepted receipt SHA-256 is
`058a70b4f95d5eeea33a878a83f414d0ad9d7940d0862a301cde44722164e3b6`.

The COP V3 provisioning package passed 63 local tests and the independent Root
test run. Root provisioned only the existing server-side credential and the
default-false flag; the credential remained on the server. The first cold HTTP
regression check failed. Later complete HTTP/dependency checks recovered, and
the unchanged official pending-recovery operation committed the same running
container without another recreation or restart. Both the original cold-check
failure and the subsequent wrapper post-check failure were preserved.

Independent verification then confirmed normal installed validation, actual
credential equality, no pending operation, zero restarts and strict peer parity:

- Container: `b038ddff750b4c0c83f50c05b05928b8190eb63bd04fe580307f2040f99bdf8c`.
- Release: `release-6e2eae49d2524efe89032213eeaa8ba1`.
- Generation: `5b7a3ff934264ec0b50e8ae0a21d8158`.
- Root provision acceptance SHA-256:
  `a4e1be35ced1f8d971c41197e6803502b1bff0c193e642d3255ce71c3a4d6dd5`.

## Actual public canary: rejected previews, activation withheld

Root completed operation `6f605acd-b9fc-436f-b72e-f624fef4b0de` at
2026-10-29 16:17:32 UTC. Four API requests were conclusive, without retry:

| Public case | Candidates | Preview |
| --- | --- | --- |
| Mnichov public origin | 200, three candidates | 422, `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED` |
| Previous public control origin | 200, three candidates | 422, `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED` |

The first returned candidate was selected in each case. No second candidate,
different destination, profile fallback or restriction relaxation was attempted.
The complete native frame counted 29 of the permitted 36 calls: 15 status, two
locate, six route and six trace-attributes calls, including background activity
and both markers. No unknown native path, log rotation, engine/daemon/dataset
change or SIM process/configuration change was observed. A prior marker-only
attempt had stopped on mount-list ordering in the Root measurement collector,
before any planning API request; that failure remains separate from this result.

Actual result SHA-256:
`54a86f26ef87ecea3cffea5dd5ebb888edd68490b4f8ba85b66d468cacbb280a`.
Complete native-frame outer-end SHA-256:
`56b7b8ecab4015595455a060beb3a9a26e8706020b7d764f2c410812c337b9a3`.

SIM's source inspection of deployed revision
`41ddfaf329b52fc9ca4b821fe270ea25b4bf4e49` places this exact 422 after geometry
and known-closure validation, at the rejection of native warning 401. This is
not a schema, authentication or discovery-binding rejection. In upstream
Valhalla 3.8.3, warning 401 signals a second routing pass after the first pass
found no path. That pass changes several search/access settings together; the
warning alone does not identify which change was necessary. It does not prove
an origin/destination access prohibition or a particular bad map restriction.
See [the upstream routing implementation](https://github.com/valhalla/valhalla/blob/3.8.3/src/thor/route_action.cc).

The existing runtime report retains status/code and transport metadata, not
native response bodies or internal branch facts. It cannot establish a more
specific cause. SIM also identified that the planning-preview call does not
pass `RoutingRequestContext` to the ordinary closure-routing path, so its
existing error diagnostic cannot associate that request with a correlation ID.
This is an observability gap, not evidence that ignoring warning 401 is safe.
Six targeted local SIM regression tests passed; they confirm rejection and no
retry, not successful production routing.

## Remaining work

`COP_ROUTING_PLANNING_ENABLED` remains false; no enable-acceptance document was
created. Provisioning and successful discovery do not establish usable planning.
The exact multipass cause, an accepted preview, COP activation and actual
COP/Jízda user acceptance remain unverified. No private phone location or
physical-device navigation result is claimed. Further diagnosis needs a precise
privacy-safe evidence plan; do not waive warning 401 or silently change the
candidate, profile or destination. All maintenance holds were released.
Preserve the failure evidence and accepted images; do not rerun provisioning or
repeat a committed recovery to obtain a cleaner receipt.
