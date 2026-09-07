# SIM Routing Follow-up

Status: active integration request for SIM.

## Context

COP now enables the server-side routing adapter by default and calls SIM only
through COP `/api/v1/routing/*` endpoints. Local verification on
2026-07-08 confirmed:

- `GET /api/v1/routing/profiles` through COP returns SIM profiles.
- `POST /api/v1/routing/alternatives` through COP returns a Valhalla route.
- The returned route includes `quality.mode=engine_route` and
  `quality.engine=valhalla`.
- Traffic metadata is present and COP displays `traffic.limitations` and
  `traffic.warnings` as route caveats.

## SIM Actions

1. `POST /situation-data/api/v1/routing/alternatives` should return the
   requested alternatives when possible.

   Example request:

   ```json
   {
     "profileId": "emergency_vehicle",
     "from": { "lon": 17.36285, "lat": 50.12952, "label": "Moje poloha" },
     "to": { "lon": 17.37303, "lat": 50.15077, "label": "Mnichov - Cerna Opava" },
     "avoid": ["road_closure"],
     "alternatives": 2,
     "includeSteps": true
   }
   ```

   Observed response currently contains only one route. Expected response:
   `routes[]` contains the primary route with `rank: 1` and up to two
   alternatives with `rank: 2`, `rank: 3`, etc. Matching `features[]` should
   include `role` or `styleHint` that lets COP render primary and alternatives
   differently.

2. If SIM cannot produce alternatives for a request, return an explicit
   warning/caveat in `warnings[]` or `traffic.limitations[]` rather than
   silently returning a single route.

3. Keep route-level quality on every route and, if practical, mirror primary
   route quality to top-level `quality` so clients can summarize degraded
   responses before inspecting individual route records.

4. For traffic hard exclusions, keep the current count fields and add a boolean
   `hard_exclusion_applied` when possible. COP already reads both styles, but
   the boolean is easier for clients and native apps to present consistently.

## COP Side

No browser or native client should call these SIM endpoints directly. COP is the
public API boundary and will continue to render returned SIM `features[]`
without computing client-side routes.
