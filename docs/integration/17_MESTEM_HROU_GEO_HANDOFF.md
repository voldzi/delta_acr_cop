# 17 Shared Geo: Exact Městem hrou Handoff

## Scope and ownership

Městem hrou remains a separate public product with its own backend, database,
authorization and release cycle. It must not become a client of protected COP
APIs and it must not store game content in COP.

## Implementation assignment

1. Add the released `@zeleznalady/geo-client@0.1.0` artifact using its immutable
   release URL and verify the SHA-256 documented in the
   [COP release manifest](18_GEO_CLIENT_RELEASES.md). Do not deep-import the COP
   repository, use a floating branch URL or copy `CopMap`.
2. Own MapLibre in the Městem hrou client and use the shared package only for:
   basemap validation/fallback, mandatory attribution, clustered point sources,
   route line presentation and bounds/fit calculation.
3. Use the stable public assets under `https://tiles.zeleznalady.cz` for tiles,
   versioned style and fonts. Do not create a game-specific tile proxy.
4. Build catalogue search from a Městem hrou PostgreSQL index containing only
   its curated public places and content. Do not call COP Nominatim at runtime.
5. If an editor enters an unknown location, editorial tooling may query an
   approved Nominatim service with policy-compliant rate limiting and then store
   the reviewed coordinates in the game's own database.
6. Add a server-side SIM routing adapter matching
   [geo-routing-v1](16_SHARED_GEO_SIM_ROUTING_HANDOFF.md). The public browser
   calls only the Městem hrou backend.
7. On publication, precompute and store the full route response snapshot:
   GeoJSON, distance, duration, elevation and routing dataset version/date.
8. Preserve story-stop order exactly. Never request or perform automatic
   waypoint reordering.

## Release prerequisites

- `@zeleznalady/geo-client@0.1.0` (or newer compatible version) is available as
  an immutable released package artifact; consumers pin the explicit release
  until an authenticated organization package registry is introduced;
- SIM has delivered and documented the authenticated `geo-routing-v1` operation;
- the target public style/font URLs exist or the documented raster fallback is
  intentionally accepted;
- the age and coverage of the OSM/Valhalla dataset are visible to editors.

## Acceptance criteria

- the client bundle contains one MapLibre runtime only;
- a missing/invalid vector style produces the safe raster fallback with visible
  OpenStreetMap attribution;
- clustered catalogue points and a published LineString render without COP
  domain types;
- a route with four story stops keeps order `0,1,2,3`;
- ordinary users never call SIM, Valhalla, Nominatim or COP from the browser;
- game tables, endpoints and statistics exist only in the Městem hrou domain;
- a published route shows or exposes its dataset version/date to editorial
  diagnostics and can be republished deliberately after a dataset refresh.

## Return handoff

The Městem hrou owner returns dependency versions, public map configuration,
server-side SIM adapter tests, bundle duplicate check, search-index migration
and one end-to-end publication example with fixed waypoint order.
