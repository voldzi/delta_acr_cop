# 16 Shared Geo: Exact SIM Routing Handoff

## Ownership

This is an implementation assignment for the **SIM repository and SIM owner**.
No SIM or Valhalla implementation is added to COP by this change. COP retains
its current routing proxy unchanged.

Required topology:

```text
public application client
  -> that application's backend
  -> authenticated internal SIM routing API
  -> Valhalla
```

The browser must never receive a Valhalla URL or credential and must never call
SIM directly. The new contract is consumer-neutral; it must not contain COP or
Městem hrou domain types.

## Required v1 operation

Implement one authenticated internal operation named by SIM according to its
existing API conventions. Its logical contract is `geo-routing-v1`.

Request:

```json
{
  "contractVersion": "geo-routing-v1",
  "profile": "bicycle",
  "locations": [
    { "longitude": 17.3291, "latitude": 50.1198 },
    { "longitude": 17.3358, "latitude": 50.1135 },
    { "longitude": 17.3472, "latitude": 50.1081 }
  ],
  "options": {
    "elevation": true,
    "optimizeWaypointOrder": false
  }
}
```

Rules:

- `profile` accepts at least `walking` and the general profile `bicycle`.
- `locations` contains 2 or more WGS84 points in `[input order]`; coordinates
  use explicit longitude/latitude fields at the boundary.
- all points are routed in the order supplied;
  `optimizeWaypointOrder=true` is not supported by v1 and must be rejected.
- SIM maps the neutral profiles to its controlled Valhalla costing options.
- impose documented limits on point count, body size and processing time.

Successful response:

```json
{
  "contractVersion": "geo-routing-v1",
  "profile": "bicycle",
  "waypointOrder": [0, 1, 2],
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [17.3291, 50.1198],
      [17.331, 50.117],
      [17.3472, 50.1081]
    ]
  },
  "summary": {
    "distanceM": 2380,
    "durationSeconds": 710,
    "elevationGainM": 84,
    "elevationLossM": 41
  },
  "routingDataset": {
    "version": "sim-routing-2026-08-01",
    "builtAt": "2026-08-01T03:15:00Z"
  },
  "computedAt": "2026-08-10T12:00:00Z"
}
```

Response rules:

- geometry is valid WGS84 GeoJSON `LineString`; an invalid or missing geometry
  is an error, never a nominal 200 response;
- distance is metres, duration seconds and elevation values metres;
- `waypointOrder` must equal `[0, 1, ... n-1]` and proves no optimization was
  applied;
- every response carries routing dataset version and build date, not merely the
  running service version;
- errors use SIM's existing standard error envelope and correlation identifier.

## Precomputation at publication

Consumer backends may call the same operation while publishing content and
store the complete returned route snapshot. They should serve that snapshot to
their public client until an editor explicitly republishes it. This makes a
story route deterministic and auditable even after routing data changes.

SIM should support idempotent retries of an identical request. It does not own
consumer content and must not store story/game records.

## Security and operation

- Reuse SIM's approved service-to-service authentication and authorization.
- Create a scoped identity per consuming backend; do not share Valhalla secrets.
- Rate-limit and trace by consumer identity and correlation ID.
- Provide liveness/readiness dependency state for Valhalla and dataset metadata.
- Log no user access tokens and no unnecessary precise-location history.

## Acceptance tests required in SIM

1. two-point walking route;
2. two-point bicycle route;
3. bicycle route with at least four points, returned in exact input order;
4. valid GeoJSON coordinates and non-negative distance/time/elevation values;
5. dataset `version` and `builtAt` present;
6. rejection of one point, invalid coordinates and `optimizeWaypointOrder=true`;
7. timeout/degraded Valhalla reported through the standard error envelope;
8. authenticated backend succeeds while an unauthenticated browser request is
   rejected;
9. same request can be used for publication-time precomputation without storing
   consumer domain data in SIM.

## Definition of done and return handoff

SIM returns to COP/Městem hrou owners:

- the internal operation path and OpenAPI fragment,
- service-auth scope/audience and rate limits (without secrets),
- maximum waypoint count and timeout,
- example walking and bicycle responses,
- current routing dataset version/build date and refresh policy,
- test evidence for all nine acceptance cases,
- operational owner and rollback procedure.

Until that handoff exists, other products must not call COP routing or Valhalla
as a shortcut.
