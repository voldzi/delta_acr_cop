# ADR 0034: Immutable road-trip requirements at the COP–SIM boundary

Status: accepted for optional integration; profile activation requires joint acceptance.

Jízda needs mandatory closures, ordinary-car/truck/trailer intent and a complete
vehicle/request identity. Existing four-field vehicleAssessment and proximity
closure warnings cannot attest these requirements. COP must not drop unsupported
parameters or label an unconstrained alternative as equivalent.

Keep authenticated COP routing endpoints and add SIM's shared `trip` and
per-variant `assessment` schemas. Read optional capabilities in existing profiles.
COP validates the full outgoing snapshot, canonical request/applied hashes,
geometry, actual engine/costing, graph identity, closure coverage and expiry for
EVERY variant before any fallback filtering. Invalid input fails; no repair by
clamp or unknown-field omission. Public errors preserve machine status/code and
correlationId without upstream endpoint/content. Routing requests are not stored
or logged by this boundary.

The native SDK exposes an explicit immutable strict-trip overload. It preserves
old response decoding and old unrestricted calls, but strict trips never grant
MapKit/unconstrained fallback. Mandatory requirements and ordinary-car intent
cannot become emergency exemptions. Incomplete mapped restrictions are visible.
Unsupported trailer/axle/entrance/planned-departure capabilities remain explicit.

SIM owns approved closure truth, graph freshness and actual engine enforcement.
A reviewed both-direction polygon does not establish one-direction edge support.
The reported bridge or a screenshot is not authoritative closure/exit data.
Default-off rollout and physical iPhone acceptance remain required. No driver
measurement, secret, traffic writer or China voice behavior is changed.

Contract, units and host steps: integration/23_JIZDA_ROAD_TRIP_CONTRACT.md.

OIDC boundary completion (2026-10-03): every routing endpoint requires a usable
actor after the existing verified bearer/BFF guard. Missing/invalid subject is 401
before SIM is called. Claim types and JWT structure are checked without logging
claims or token fragments. Real HTTP JWKS tests plus signed synthetic JWTs cover
valid mobile and BFF sessions, revocation, origin, wrong signature/client/issuer,
expiry, malformed claims and all-variant response failures. These tests do not
replace production end-user login or real-iPhone acceptance.
