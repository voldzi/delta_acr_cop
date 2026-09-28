# Jízda: directional road attributes on COP routes

## Boundary and opt-in

Jízda calls `POST /api/v1/routing/route` on COP. COP calls SIM server-side; SIM calls Valhalla. No SIM or Valhalla URL, token, or whole-world routing dataset is sent to iOS. The route request may add `includeRoadAttributes: true` and optional `vehicle` dimensions (`heightM`, `widthM`, `lengthM`, `weightTonnes`). Existing requests and responses remain valid. `routes[].durationSeconds` remains the SIM traffic-adjusted ETA; the client must never add the separate traffic delay again.

SIM asks Valhalla `trace_attributes` with `shape_match=edge_walk` over the geometry of **each already selected route variant**. It does not ask Valhalla to calculate another route. SIM requires the same routing dataset before and after lookup and a monotonic one-metre alignment of trace coordinates with the returned route shape. If this cannot be proved, `roadAttributes.state` is `unavailable` and `speedLimits` is empty. `beginShapeIndex` and `endShapeIndex` index the corresponding `routes[].geometry.coordinates` in travel order; they are not global indexes shared by alternatives.

Only positive `edge.speed_limit` values accepted as posted limits become `status=explicit`, in km/h. Missing or implausible values become `unknown` with no `valueKph`. Valhalla's `edge.speed`, traffic flows and ETA are never converted into a legal limit. No derived legal limits are emitted yet. `knownSpeedLimitCoveragePercent` is route-length weighted, not a count of edges. An unknown limit is not zero or unlimited.

## Route-bound tunnel intervals prepared for Jízda

SIM additionally requests the directed Valhalla `edge.tunnel` flag for each already selected road variant. The optional `routes[].roadAttributes.tunnels` object repeats `routeId`, `routingDataset`, `observedAt` and `source=valhalla_trace_attributes.edge.tunnel`. Each interval has `beginShapeIndex`, `endShapeIndex` and `direction=along_route`. Indexes are inclusive vertex indexes into **that same route's** `geometry.coordinates`; they are point indexes, not metres or positions shared by alternatives. Consecutive tunnel edges are merged. `state=known` requires every directed edge to have a boolean tunnel flag, continuous shape coverage, no geometry mismatch and an unchanged routing dataset. `known` with no intervals means no tunnel-marked edge on that verified graph path. Missing or conflicting data becomes `state=unknown` with an empty interval list, which does not prove that no physical tunnel exists. The graph flag does not confirm that the vehicle has entered the tunnel.

SIM's Valhalla route ID includes the resulting geometry. COP checks the nested route ID, dataset, interval bounds and directed order before forwarding `known`; a failed check is downgraded to `unknown`. Existing clients can ignore the new optional object. A route recalculated with a different shape must be treated as a new route even if the origin and destination are unchanged.
When SIM marks a variant `status=unavailable` because its maneuver indexes do not match its shape, COP excludes that variant and its feature from navigable output.

Example response fragment with illustrative coordinates:

```json
{
  "coverage": { "state": "covered", "routingDataset": { "version": "sim-routing-example", "builtAt": "2026-09-20T03:00:00Z" } },
  "routes": [{
    "routeId": "routing:car:valhalla:example-shape-id",
    "geometry": { "type": "LineString", "coordinates": [[14.42, 50.08], [14.4205, 50.08], [14.421, 50.08]] },
    "roadAttributes": {
      "state": "ok", "geometryMismatchCount": 0,
      "routingDataset": { "version": "sim-routing-example", "builtAt": "2026-09-20T03:00:00Z" },
      "tunnels": {
        "state": "known", "routeId": "routing:car:valhalla:example-shape-id",
        "source": "valhalla_trace_attributes.edge.tunnel",
        "routingDataset": { "version": "sim-routing-example", "builtAt": "2026-09-20T03:00:00Z" },
        "observedAt": "2026-09-23T12:00:00Z",
        "intervals": [{ "beginShapeIndex": 1, "endShapeIndex": 2, "direction": "along_route" }]
      }
    }
  }]
}
```

Jízda should parse `tunnels` only after selecting its route variant and matching both `routeId` and dataset. On reroute or variant switch, discard the prior intervals. Use a recent, reliable on-route GPS fix to anchor any outage prediction and decay confidence over time. Do not infer tunnel entry from GPS loss alone; at a tunnel ramp or fork, report an uncertain position until the chosen branch is observed. Test tunnel entry/exit, a tunnel ramp, GPS outage outside a tunnel, parallel roads and switching variants on a physical iPhone. This prepared contract has not yet passed that device acceptance and is not claimed as a production result.

The shared mobile module already sends `includeRoadAttributes` and decodes `CSMRouteRoadAttributes` in `packages/CSMCommunicationKit/Sources/CSMCommunicationKit/CSMDriverRouting.swift` (COP Mobile repository). Add `public let tunnels: CSMRouteTunnelAttributes?` to that existing type; keep it optional for older COP responses. The exact new Swift model is:

```swift
public struct CSMRouteTunnelInterval: Codable, Sendable {
    public let beginShapeIndex: Int
    public let endShapeIndex: Int
    public let direction: String // "along_route"
}

public struct CSMRouteTunnelAttributes: Codable, Sendable {
    public let state: String // "known" or "unknown"
    public let reason: String?
    public let routeId: String
    public let source: String // "valhalla_trace_attributes.edge.tunnel"
    public let routingDataset: CSMRoutingDataset?
    public let observedAt: Date
    public let intervals: [CSMRouteTunnelInterval]
}
```

In Jízda's `NavigationRoute.init(source:response:)`, accept `known` only with the selected `source.routeId`, matching `response.coverage.routingDataset`, valid forward indexes and `source.roadAttributes.state == "ok"` with zero geometry mismatches. Map interval endpoints to the existing cumulative geometry distances, not to a second polyline. In `NavigationManager`, clear the intervals on route or rank change and constrain the GPS-outage projection to a reliably entered interval; show uncertainty at a ramp or fork. `CSMDriverRouteRequest` needs no change because it already opts into road attributes.

Read-only graph probe on 2026-09-28 used public points around the Strahov tunnel and ran the prepared SIM mapper locally over the production Valhalla `route` and `trace_attributes` responses. One direction matched all 71 edges to 201 route vertices with zero geometry mismatches and yielded two intervals, `[44,71]` and `[92,133]`. The opposite direction matched all 57 edges to 175 vertices with zero mismatches and yielded `[26,55]` and `[73,98]`; its tunnel-marked edges included `turn_channel` as well as `road`. Both returned `tunnels.state=known` with valid bounds and matching route ID and dataset. This proves graph availability and mapping for these sampled routes; it is not a deployed COP response, a complete map-quality survey, or a physical iPhone navigation test.

`roadAttributes.restrictions` currently contains only Valhalla trace closures and labels them `advisory`; the existing SIM `traffic.incidentsOnRoute` and `hazardsOnRoute` stay separate. Static height/width/weight limits, legal access permissions and conditional OSM tags are **not** represented as verified facts by `trace_attributes`, so `vehicleRestrictionsState=not_evaluated`. In particular, absence from `restrictions` never means that a vehicle may pass. A later source keyed by directed Valhalla edge and dataset version is needed for verified or conditional restrictions.

When actual vehicle dimensions are supplied for a road profile, SIM uses Valhalla `truck` costing and passes those values as truck options. `vehicleAssessment` reports which fields were applied and marks incomplete input `partially_evaluated`. A fully supplied profile means only that the provider used the parameters in its mapped graph; it does **not** certify legal or physical passability. If Jízda keeps sending `profileId=car` without vehicle values, the result is `not_evaluated`.

`coverage.state=outside_coverage` means no navigable graph path. SIM's historical direct-line fallback may still exist in its own response for compatibility, but COP removes that geometry, route and ETA from its public routing response. Jízda should use Apple MapKit routing for this explicit state or an empty `routes[]`; it must never display a direct line as turn-by-turn guidance. `coverage.routingDataset` supplies the version and build time when available. `roadAttributes.observedAt` is the lookup time, not the OSM source observation time; `osmChangeset` is included only when supplied by Valhalla. The dataset build time is the available source-age indicator.

## Anonymized response example

Illustrative coordinates and identifiers, not a recorded user's trip:

```json
{
  "coverage": {
    "state": "covered",
    "routingDataset": { "version": "sim-routing-example", "builtAt": "2026-09-20T03:00:00Z" },
    "sourceAgeSeconds": 291600
  },
  "routes": [
    {
      "routeId": "example-primary",
      "rank": 1,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [14.42, 50.08],
          [14.4205, 50.08],
          [14.421, 50.08]
        ]
      },
      "durationSeconds": 45,
      "steps": [{ "beginShapeIndex": 0, "endShapeIndex": 2, "instructionLocalized": { "cs": "Pokračujte rovně." } }],
      "vehicleAssessment": {
        "state": "not_evaluated",
        "providerCosting": "auto",
        "appliedFields": [],
        "limitations": ["Some vehicle dimensions were not supplied by the client."]
      },
      "roadAttributes": {
        "state": "ok",
        "source": "valhalla_trace_attributes",
        "routingDataset": { "version": "sim-routing-example", "builtAt": "2026-09-20T03:00:00Z" },
        "observedAt": "2026-09-23T12:00:00Z",
        "sourceAgeSeconds": 291600,
        "matchedEdgeCount": 2,
        "geometryMismatchCount": 0,
        "knownSpeedLimitCoveragePercent": 50,
        "vehicleRestrictionsState": "not_evaluated",
        "speedLimits": [
          {
            "beginShapeIndex": 0,
            "endShapeIndex": 1,
            "direction": "along_route",
            "valueKph": 50,
            "status": "explicit",
            "source": "valhalla_graph_osm_maxspeed"
          },
          {
            "beginShapeIndex": 1,
            "endShapeIndex": 2,
            "direction": "along_route",
            "status": "unknown",
            "source": "unknown"
          }
        ],
        "restrictions": []
      }
    }
  ],
  "features": [
    {
      "type": "Feature",
      "properties": { "rank": 1 },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [14.42, 50.08],
          [14.4205, 50.08],
          [14.421, 50.08]
        ]
      }
    }
  ],
  "warnings": []
}
```

## Pilot measurement, 2026-09-23

Seven read-only paired SIM `route` probes used public city/cross-border locations against the pilot Valhalla graph. The same request was run without and with `includeRoadAttributes`, with a cold response cache. Response bytes are uncompressed SIM JSON bytes; COP adds a small coverage normalization. A separate direct Valhalla probe measured a median `trace_attributes` call of 145 ms. These single observations are diagnostics, not a production latency SLA. Repeat with SIM's `scripts/measure-route-attributes.ts INTERNAL_VALHALLA_BASE_URL` and `scripts/benchmark-road-attributes.py INTERNAL_VALHALLA_BASE_URL`. The conditional-restriction case is a road setting, not proof that conditional tags are available.

| Scenario                          | Known-limit length | Edge mismatches | Base SIM bytes | Enriched SIM bytes | Base → enriched time |
| --------------------------------- | -----------------: | --------------: | -------------: | -----------------: | -------------------: |
| Parallel urban roads              |               100% |               0 |         12,728 |             18,902 |         514 → 584 ms |
| Motorway ramp                     |             91.55% |               0 |         15,108 |             21,862 |         275 → 264 ms |
| Roundabout                        |               100% |               0 |         11,350 |             15,834 |         258 → 267 ms |
| One-way streets                   |             91.22% |               0 |         10,589 |             14,478 |         279 → 340 ms |
| Speed changes                     |             92.24% |               0 |         60,683 |             92,540 |         335 → 503 ms |
| Conditional restriction candidate |             98.24% |               0 |         34,637 |             52,825 |         187 → 336 ms |
| Cross-border                      |              72.6% |               0 |         60,366 |             99,482 |         166 → 351 ms |

Mean known-limit coverage was 92.3% for these selected routes; the largest response grew by 39,116 bytes. A paired timing difference can be negative due to network and cache variance, so use the direct trace timing and multiple repeats for capacity planning. In every pair the SIM ETA was identical. No verified conditional restrictions were observed. The tests reject opposite-direction geometry and keep the base route when enrichment is unavailable.

## Jízda follow-up (not changed here)

1. Send `includeRoadAttributes: true` for car routes. Pass actual selected-car height, width, length and weight only when recorded and validated; do not invent defaults. Show `vehicleAssessment` without calling the route safe.
2. Parse optional `coverage` and `routes[].roadAttributes` per `routeId`/rank. Attach each speed-limit interval to that route's own geometry indexes. Display only `status=explicit` as a posted limit; show unknown data as unavailable. Stop using a nearby-road Overpass result as an authoritative current-road limit.
3. Keep traffic, incidents, hazards and the SIM ETA as separate concepts. Render `advisory` closure only as a warning, never a verified legal ban. A future directed-edge/OSM-tag enrichment is required for dimensional or conditional legal restrictions.
4. On `outside_coverage` or empty navigable `routes`, use Apple MapKit routing. On `roadAttributes=unavailable|unsupported|partial`, retain the SIM base route and make the limitation visible.
5. Validate on a physical iPhone while driving or replaying recorded GPS across parallel roads, ramps, roundabouts, one-way roads and changing limits. Check large type, VoiceOver and low-connectivity behavior. No Jízda code was changed in this task.

## Rollback

The request opt-in is optional. To disable enrichment without removing routing, stop sending `includeRoadAttributes`. If a server rollback is needed, redeploy the previous SIM and COP images/commits; COP's direct-fallback filtering should remain because it prevents false navigation.

## Production activation, 2026-09-23

The pilot on `docker.home.cz` runs SIM `7dc5aa6` (`situation-data-api` only) and COP `e447ffc` (`cop-api` only). Existing SIM `deploy/otel-collector.yaml` edits and environment backups were left untouched. Before activation, the SIM and COP ready healthchecks were 200 and the same anonymous Prague test route returned a navigable graph route through both APIs. After activation, both ready checks and public `https://cop.zeleznalady.cz/health/live` returned 200. COP returned one route with `coverage=covered`, `roadAttributes=ok`, zero geometry mismatches and 66.27% known posted-limit length. Paired basic/enriched requests each returned the same 727-second SIM ETA. A request with known vehicle dimensions returned `vehicleAssessment=provider_costing_applied`, `roadAttributes=ok` and zero geometry mismatches. Live traffic can change ETA between later calls.

Previous production images remain tagged locally as `sim-situation-data-api:rollback-20260923-route-attrs` and `delta-acr-cop-api:rollback-20260923-route-attrs`. To restore the old runtime, on `docker.home.cz` first retag the COP rollback image to `delta-acr-cop-api:local` and recreate only `cop-api` with `docker compose up -d --no-deps --force-recreate cop-api` from `/srv/cop`; then retag the SIM rollback image to `sim-situation-data-api:latest` and recreate only `situation-data-api` from `/srv/sim`. Recheck both ready endpoints and the basic route. Keep repository revisions aligned with the chosen runtime before a subsequent build, since `docker compose build` replaces those tags.
