# COP Dispatch recovery release —2026-10-05

## Scope and current status

Prepared narrow API/SDK correction, production rollout pending. Authorized
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
- COP Mobile mandatory check passed including app and package tests plus2
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

Exact published revisions and post-deployment observations follow after rollout.
