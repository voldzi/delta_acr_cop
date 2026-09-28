# ADR 0032 — Route-bound tunnel data for Jízda

Status: COP and SIM server contracts deployed 2026-09-28; Jízda mobile navigation acceptance remains pending.

COP continues to call SIM server-side for Jízda routes. The existing `includeRoadAttributes` opt-in may now return optional `roadAttributes.tunnels` on each Valhalla road variant. COP accepts `known` only if the nested route ID equals the enclosing route ID, both attribute and tunnel routing datasets equal the response coverage dataset, the base directed attributes are complete, and every interval is in bounds and ordered on that variant's own geometry. COP degrades malformed or mismatched tunnel data to `unknown` with no intervals. No nearby-road guess or GPS-outage prediction is converted to a confirmed tunnel.

SIM changes Valhalla route IDs when route geometry changes. Jízda must discard intervals on reroute or variant switch and use graph tunnel information only to bound a prediction anchored by a reliable GPS fix. Existing clients ignore the new optional object. Omit `includeRoadAttributes` to roll back enrichment without changing the base route. Physical iPhone acceptance is required before Jízda uses the intervals for navigation through a GPS outage.
