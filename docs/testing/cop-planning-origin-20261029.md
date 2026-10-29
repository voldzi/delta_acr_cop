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

## Remaining acceptance at this checkpoint

`COP_ROUTING_PLANNING_ENABLED` is still false. Provisioning does not establish
that planning works. The bounded public SIM canary, complete native-request
counting, subsequent COP activation and real COP/Jízda user acceptance remain
separate steps. No private phone location or physical-device navigation result
is claimed. Preserve the existing failure evidence and accepted images; do not
rerun provisioning or repeat a committed recovery to obtain a cleaner receipt.
