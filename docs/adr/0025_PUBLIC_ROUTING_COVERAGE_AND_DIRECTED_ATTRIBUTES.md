# ADR 0025 — Public routing coverage and directed attributes

Status: accepted 2026-09-23.

COP retains its public routing endpoint and server-to-server SIM dependency. An optional request flag asks SIM for directed attributes of the selected Valhalla route; optional vehicle dimensions remain server-side. COP forwards optional per-variant attributes, dataset version and coverage state without recomputing ETA or speed limits.

SIM historically returns a straight connector with `quality.mode=direct_fallback` when no graph path exists. That connector is not a navigable route. COP now removes such routes and their features from public routing responses and exposes `coverage.state=outside_coverage` when none remain. Old callers may still use the same endpoint and parse an empty route array. Native clients can select MapKit routing explicitly outside coverage.

Road attributes fail independently of routing. Missing attributes are not a legal speed or a vehicle passability guarantee. Rollback of enrichment is to omit `includeRoadAttributes`; direct-connector suppression should stay in place for safety. No SIM or Valhalla address or credential is sent to browsers or iOS clients.
