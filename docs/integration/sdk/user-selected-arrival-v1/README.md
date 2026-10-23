# Narrow SDK candidate, not a release

Apply `sdk.patch` only to the six named files of the current Jízda vendor SDK.
`source-manifest.json` records exact before/after hashes. It preserves the newer
`prepareRoutingAuthentication()` calls and every existing HTTPClient/auth/voice
source. Do not copy an older entire SDK tree. This patch is not installed in a
production application and does not upload TestFlight.

From Jízda root: `git apply --check --directory=Vendor/CSMCommunicationKit <path-to-sdk.patch>`,
then the same command without `--check` after preserving unrelated work.

Public API:
- `CSMDriverRoutingCatalog.userSelectedArrival?.permitsUserSelectedArrival`
- `CSMCommunicationRuntime.drivingRoutes(from:userSelectedAccess:originalTarget:alternatives:)`
- `CSMDriverRoute.arrival` and `CSMDriverRouteResponse.requireValidUserSelectedArrival(at:)`
- errors `.restrictionsRelaxationRequired`, `.invalidUserSelectedArrival`, `.unsupportedUserSelectedArrival`.

Run `sh run-proof-tests.sh <candidate-SDK-directory> [fixture-JSON]` on macOS with
Xcode. The harness compiles the actual route/closure/profile/new-arrival sources,
including CryptoKit and JavaScriptCore canonical verification. Support.swift only
provides unchanged JSON primitives/date coding and network-unavailable runtime
stubs; it cannot verify login or make network calls. The shared and actual joint
candidate response fixtures both exercise the same admission code.

The patch includes an HTTPClientTests XCTest for the exact 422/code mapping,
no retry and nonmatching error preservation. Full iOS SDK/XCTest/host compilation
is a separate integration gate owned by Jízda; do not label the isolated proof
harness as full SDK, phone, or live production acceptance.

Proof validation checks every variant before selection: the full normalized
query (including original POI under arrival.target) is hashed, road target is
request.to, endpoint equals the final rendered vertex, both geometries and arrival
objects match the sole paired feature, graph/closure/costing/expiry match the
accepted known-closure proof. Snap <=25m and remaining offset <=250m are checked
independently; distance comparison tolerance is 0.01m and never widens either cap.
Remaining access is always unverified. No connecting segment, walking ETA,
automatic access selection or private-road authorization is introduced.

For current-time simulator admission, run `node build-fresh-synthetic-fixture.mjs
<new-output.json>` and use its `response` bytes (and corresponding `request`).
It generates only the fixed synthetic contract fixture with five-minute validity;
production and joint evidence cannot be refreshed by this script. The proof
harness now passes 30 checks, with legacy regressions evaluated at their own
fixed fixture times. Full host/SDK testing remains Jízda's integration gate.
