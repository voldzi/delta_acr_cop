# COP Dispatch recovery release —2026-10-05

## Scope and current status

Narrow API/SDK correction published; API deployed2026-10-05 at14:02:48CEST. Authorized
by the user in the Jízda thread: repair and deploy COP; brief API interruption
accepted; no automatic restoration of position. No SIM measurement changes,
new accounts/vehicles/invites or activation of real shares.

Dedicated session heartbeat/recovery, generation fencing and pre-ready share
invalidation implement ADR0038. Shared vehicles remain independent of Dispatch.
Binding JSON OpenAPI adds optional serviceAvailability; old required fields and
wire-v1 contracts remain unchanged. Swift nil means unknown, not ready.

## Verification before rollout

- COP:1277 passed,3 skipped;154 passed suites,2 skipped.
- Targeted HTTP/service/lease:21 passed.
- Isolated PostgreSQL18.6:2 passed, including3 actual lease-backend
  terminations/reacquisitions, stale shares stopped and exactly one owner.
- Typecheck/lint,11 schema checks, OpenAPI validation and API build passed.
  OpenAPI has26 existing warnings.
- SDK:107 tests,106 passed,1 private replay skipped.
- COP Mobile mandatory check passed including30 app tests,107 package tests plus2
  accessibility tests, on approved Xcode27.1/27A9269/SDK27.1 simulator.
- Old-generation delayed snapshot fails503; late events cannot replace the
  current owner. Readiness503/capabilities200 independent states verified.

No production lease termination is used as a test; no real location payloads
are generated. Physical two-device, authenticated user and future production
failover acceptance remain unverified. Availability never authorizes GPS.

## Packaging and rollback

Build changed API modules locally on pinned Node24/pnpm10. Assemble a runtime
image overlay on the captured immutable production image without dependency
changes or network fetches. Copy only compiled changed modules plus binding
OpenAPI JSON files. Preserve environment, ports, mounts and network attachments;
recreate only cop-api. Capture previous image/tag and other container IDs.
Rollback retags the captured image and recreates only cop-api using unchanged
production Compose files. It does not restore sharing consent or RAM points.

## Published revisions and production evidence

- COP implementation/source: `2f4bc4dfc15bb10182e340b0ef43fde679cab8f6`,
  branch `codex/cop-dispatch-recovery-release`.
- Mobile SDK: `e8cb4d53c128f797521f1db0cf312304bfa550bc`,
  branch `codex/shared-mobility-sdk`. Clean archived published pin builds and
  passes all3 new availability tests. The full107-test SDK and mandatory Mobile
  check also ran in the existing working tree, including unrelated unpublished
  routing/China work; those changes were preserved and excluded from this pin.
- Binding fragment SHA256:
  `335ed77bbf1826d7c552ee9dd0d4b1f2dffb9684e73f60d1193d6a10cb17c547`.
- Full OpenAPI JSON SHA256:
  `fc596d4baef30a400585678adbd696922575cc04c6ff10c05348bb7906368889`.
- Image: `sha256:d4b41a0ff330bc9325bee79b599eb1efc2995a7e5cba3c108fff7c3f7285f02b`.
- Container: `e29be47e67bac1d966f149040dfa24f36d8974a63a8064311ab44b7d5a673053`.
- Start: `2026-10-05T12:02:48.998460716Z` (14:02:48CEST).
- Production source checkout remains `6583cb5ab659044cc681294ee291f9b08135a4bc`;
  the runtime image label identifies the published overlay source above.
- Inherited base: `sha256:d4f9b1f6ee9121f85640e6445a0926928a0c07271a77b617256ec1b9e200e5b8`.
  Its layer prefix and runtime configuration were verified. Runtime overlay
  has20 selected compiled/contract files, whose hashes match production.
- Package transfer SHA256:
  `10ffe211a30fe4983efe1706c9fc57c5d235afee4e2ec87b25958b6ed51f8dd3`.
- Isolated packaged image:16 checks passed with2 signed synthetic accounts,
  network disabled and no production credentials. Account isolation, unauthorized
  rejection, capability separation, private503 and ready503/recovery200 verified.
- At12:03:32.813Z and12:05:14.858Z: DB primary, exactly one granted lease and
  one owner with application_name `cop-private-dispatch-lease`; live/ready/dependencies
  all200/ok, Dispatch ready generation1. Anonymous account/capabilities/vehicles/groups
  all401. Docker health healthy; logs show recovering→ready generation1.
- Environment values (sorted hash), `.env` hash, network names, Compose files
  and every other running container ID match pre-deploy evidence. No mounts;
  existing port4310 preserved. Initial combined configuration hash differed and included unsorted environment
  entries. The identical sorted environment hash is consistent with an ordering
  difference, but old raw field values/order were not retained: the exact cause
  cannot be retrospectively proven. See the explicit configuration check below.
- `COP_DRIVER_MEASUREMENTS_ENABLED=false` remains unchanged. No client GPS gate
  or actual sharing consent enabled. Production lease was never killed for testing.

Rollback image tag: `delta-acr-cop-api:rollback-before-dispatch-recovery-20261005`.
Production uses `/srv/cop/docker-compose.yml` plus
`/srv/cop/docker-compose.driver-measurements.yml`. To roll back, retag the
captured prior image as `delta-acr-cop-api:local` and recreate only cop-api
with `--no-build --no-deps --force-recreate` using those unchanged files.
Rollback procedure is prepared; no production rollback was exercised.
The isolated RAM PostgreSQL container was removed after testing.

Remaining gates: authenticated real-account loading and explicit-consent
two-phone sharing/start/stop/account-change/outage acceptance with Jízda.
No physical tests or battery/network claims. Do not enable its GPS gate from
health status alone. Chroma Mobile reindex previously timed out; fresh index
completion is not confirmed.

## Final stability observation

At `2026-10-05T12:08:55.069Z` (14:08:55CEST), over6minutes after start, the
primary still grants exactly one lease to the dedicated session. Live/ready/
dependencies remain200/ok and Dispatch ready generation1. The4 unauthenticated
endpoints remain401 and measurementsfalse. No production fault or position
publication was induced. This short observation does not prove future failover
or authenticated device acceptance.

## Configuration assertion clarification

The deployment completed API recreation, then its combined-hash assertion failed.
The old hash was `1ce1c94bfad93ad6cd3e46daddb43c394c174f66c937197fb3b65edf73ec91d1`;
the new hash was `1d72fc748d096ca92176b5d80c1aead7a8148cf07dff61151f55002bece1065e`.
That hash combined Env (unsorted), command, entrypoint, mounts, port bindings
and sorted network names. The sorted Env hash is identical before/after:
`86fc337d8dd154efeeae926ad8b5f0c03bd48aff296e4dcb1d557a7a4d816d9c`.
The original old Env order and individual raw configuration fields were not
retained, so an exact old-vs-new field/order diff is unavailable. Earlier wording
that attributed the mismatch conclusively to Env ordering was too strong.

At12:12:09Z, a fresh read-only validation performed10 explicit comparisons of
current runtime against unchanged production Compose plus captured original
image defaults. All passed: full environment map, port bindings, no mounts,
entrypoint, command, working directory, user, networks, restart policy and
healthcheck command. Environment and `.env` hashes also match the pre-deploy
record. No secrets were emitted or saved by the comparison. Exact current values:

- Port:4310/tcp→host4310, HostIp empty (unchanged Compose default).
- Mounts: none.
- Entrypoint: `docker-entrypoint.sh`.
- Command: `pnpm --filter @cop/cop-api start`.
- Networks: `cop_default`, `cop_sim_driver_measurements_internal`.

This proves current critical configuration matches its unchanged declaration and
original image defaults, with independently identical environment values. It does
not recover the missing old per-field snapshot or prove the exact hash permutation.
Protected server artifact: configuration-acceptance.json alongside before.json
and after.json. A future release preflight must record canonical per-field hashes
and sanitized non-secret settings before recreation. No further recreation or
configuration change was performed for this clarification.

Additional read-only runtime check12:10:52.792Z (>8minutes after start):
primary, lease1/dedicated1, generation1 ready, live/ready/dependencies200/ok;
anonymous account/capabilities/vehicles/groups401; measurementsfalse.
