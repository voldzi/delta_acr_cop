# 0036. Explicit vehicle profiles using incomplete mapped restrictions

Date: 2026-10-04. Status: accepted and server release deployed; mobile acceptance pending.

## Decision

Add a typed optional `vehicleProfile` to the existing authenticated routing
boundary. Keep `sim-road-trip-v1` unchanged: ordinary mapped costing is not
completion of mandatory legal, vehicle-limit and closure coverage.

Use the exact shared SIM schema for vehicle intent, units, supported parameters,
capabilities and route-bound assessment. COP forwards the selected profile only
server-side and verifies the response before removing or rendering variants.
Queries, geometry, indexed maneuvers, expiry, source and map dataset retain their
existing checks. Unsupported parameters or inconsistent assessment fail without
retrying as a passenger car or switching to a direct provider.

Whole-combination dimensions and loaded weight may use auto costing for a car
with trailer; commercial truck costing applies its supported axle fields.
Mapped restrictions are incomplete. Trailer-specific bans and articulation are
not silently claimed as assessed. Explicit coverage acknowledgement does not
turn incomplete data into a guarantee of legal or physical passability.

The 4x4 intent prefers a road route and permits mapped unpaved access without
inventing an off-road graph. Preserve the requested target separately from the
actual routed endpoint. A remaining target-guidance segment is not navigable
road geometry, a maneuver or a promise of arrival. A driver authorization must
not be implemented as blanket disabling of access restrictions. If the engine
cannot support the scoped request, declare that limitation and reject it.

Existing driver measurements, strict-route gates, known-closure enforcement and
unrelated AI, voice and dispatch functions are unchanged.

## Verification and release

Publish schema, examples and exact server revisions jointly with SIM and Jízda.
Test all supported profiles and conflicting inputs, changed identity/geometry,
unsupported fields, source/graph/expiry failures and preserved upstream errors.
Verify actual costing and representative mapped restrictions in SIM before
claiming profile enforcement. Build and server acceptance do not establish
physical navigation acceptance on an iPhone.
