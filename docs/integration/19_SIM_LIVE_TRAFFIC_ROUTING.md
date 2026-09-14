# SIM Live Traffic Routing

Status: active production contract.

## Data flow and boundary

Automobile routing follows `COP web -> COP API -> SIM -> Valhalla`. Browser and
native clients call only `/api/v1/routing/*`; SIM and Valhalla addresses,
credentials and provider configuration remain server-side. COP API forwards the
SIM response without recomputing the route or its travel time.

`traffic.liveSpeeds` is optional for backwards compatibility. When present, COP
types and forwards `enabled`, `state`, `updatedAt`, `sourceObservedAt`,
`ageSeconds`, `appliedFlowCount`, `appliedEdgeCount`,
`mappingCoveragePercent`, `routingDataset` and `detail`. Unknown fields remain
preserved so SIM can evolve the object compatibly.

## Presentation rules

- `ok` means fresh live speeds with sufficient mapping coverage.
- `degraded` means routing works, while live speed coverage or quality is
  limited. It must never suppress a valid route.
- `idle` means the adaptive traffic mode is waiting for an automobile request.
- `stale`, `failed`, disabled live speeds, or `ageSeconds` above 300 seconds
  warn that part of the calculation may use ordinary map speeds.
- A missing `liveSpeeds` object does not fail a route. Vehicle route detail says
  that live traffic is unavailable and shows the same map-speed warning.

The normal route detail prioritizes state, source observation time, age and
coverage. Applied flow/edge counts, dataset and provider detail are in a
collapsed operational section. Incident, closure, restriction and warning
presentation remains additive and unchanged.

The displayed ETA is the route's `durationSeconds` exactly as returned by SIM.
COP may display `delayPenaltySeconds` as context but never adds it to ETA.

## Release verification and rollback

Before pilot release, run schema and OpenAPI validation, typecheck/lint, routing
and UI tests, production build, and a server-side automobile request through
COP API. After deployment verify `/health/live`, `/health/ready`,
`/health/dependencies`, then confirm a car route returns `durationSeconds` and
either a complete `traffic.liveSpeeds` object or a valid route without it.

Record the deployed Git revision before updating `/srv/cop`. Rollback checks out
that recorded revision on `docker.home.cz`, rebuilds/restarts the same Compose
services, and repeats the three health checks and automobile routing smoke test.
