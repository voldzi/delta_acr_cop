# ADR 0057: Explicit user-selected road arrival

Status: accepted for compatible candidate; production rollout pending.

Valhalla restriction-relaxation warning 401 must not be presented as a navigable
route or a generic engine outage. An off-road POI does not justify automatic
selection of an access road or relaxing the 25 m snap bound.

We add an explicit, capability-gated ordinary-car request. The host retains the
original POI and obtains user confirmation of the road access. COP and the SDK
independently bind every response variant to its request, final geometry, map
build, closures, engine/costing and expiry. Remaining access is unverified and
capped at 250 m; road snap remains 25 m. Unsolicited route or feature evidence is
rejected, including strict and mapped-profile paths. Opt-in responses are not
cached. Existing endpoints, ordinary requests and safety restrictions persist.

See [contract and bounded acceptance](../integration/32_USER_SELECTED_ARRIVAL_V1.md)
and the binding JSON OpenAPI. This decision does not authorize production
activation, TestFlight upload or a claim of legal/physical entrance acceptance.
