# ADR 0023 — Durable directional report enrichment

Status: accepted, 2026-09-21.

COP keeps original community reports, ownership, votes and audit as authority.
A PostgreSQL-backed queue reconciles active recent traffic-report versions,
leases two jobs per 15-second tick for 120 seconds and retries with bounded
exponential delay. Report-version and lease checks reject stale workers.
Changed observations hide old matching until the new version is enriched.

COP sends one point and optional reliable travel heading to the existing SIM
nearest-access adapter, without identity, free text or a ride trail. A matched
result needs versioned directed-edge/dataset evidence no older than ten minutes.
Ambiguous results stay explicit. Provider errors remain queued and degrade the
separate dependency health indicator; report submission/navigation stay usable.

Matching reports may share a cluster only for the same category, directed edge,
dataset, 10-minute interval and 50-metre neighborhood. Private/group observations
are not correlated across authors; public observations can share a cluster.
Original records are retained. Presentation groups only authorized active
results and never sums votes or promotes confidence. Operator/policy review is
still required before a routing closure; enrichment itself cannot create one.

The schema is additive. `COP_ROAD_ENRICHMENT_ENABLED=false` stops the worker.
Old binaries ignore the additional tables/columns, so rollback preserves data.
Native maneuver fields pass through COP unchanged; SIM's duration remains the
only route-time authority. No browser receives an internal endpoint or token.
