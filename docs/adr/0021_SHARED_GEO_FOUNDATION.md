# ADR-0021: Shared Geo Foundation

## Status

Accepted, 2026-08-10

## Context

COP already contains production-proven MapLibre configuration, raster fallback,
clustering, GeoJSON route presentation and viewport fitting. Other products,
especially Městem hrou, need the same generic capabilities. Copying them would
create diverging URL validation, attribution and map behaviour. Sharing the
large `CopMap` component would instead couple public products to protected COP
domains and APIs.

SIM already owns OSM/PostGIS data and Valhalla routing. COP must not become a
public routing or geocoding gateway for unrelated products.

## Decision

1. Generic, browser-safe geo helpers live in the versioned package
   `@zeleznalady/geo-client`.
2. The package has no React, MapLibre runtime, COP domain or network dependency.
   It returns serializable MapLibre-compatible specifications and neutral
   GeoJSON types.
3. The first extracted surface is:
   - basemap configuration and safe URL/template normalization,
   - mandatory OpenStreetMap attribution,
   - raster fallback style construction,
   - clustered point source and generic cluster layers,
   - safe LineString normalization and route line presentation,
   - coordinate, GeoJSON bounds and viewport fit calculation.
4. COP consumes that package through a narrow Vite environment adapter while
   preserving all current `COP_MAP_*` and `VITE_COP_*` semantics.
5. `CopMap`, COP layers, observed objects, incidents, affiliations, NATO
   symbols, warnings, drawings and operational workflows remain inside COP.
6. `tiles.zeleznalady.cz` is the stable public map asset endpoint shared by
   applications. Today it caches public raster OSM; the target is versioned
   vector styles and owned vector tiles or PMTiles/MBTiles behind the same host.
7. SIM and Valhalla remain internal. Every consumer has its own backend, which
   calls a stable internal SIM routing contract. A browser never calls SIM or
   Valhalla directly.
8. Every consumer owns its domain database and API. No game data, endpoints or
   statistics are stored in or exposed by COP.
9. COP's Nominatim adapter remains internal to COP. Městem hrou searches its
   own curated PostgreSQL place index; Nominatim may be used only by editorial
   tooling for an unknown place, not for runtime catalogue search.

## Distribution and versioning

`@zeleznalady/geo-client` starts at `0.1.0` in the COP workspace. COP uses the
workspace version. The first cross-repository release is the immutable GitHub
release asset tagged `geo-client-v0.1.0`, with its SHA-256 recorded in the
package README. Consumers must pin that versioned artifact; deep imports from
the COP repository and floating branch URLs are forbidden. When an approved
authenticated organization package registry is available, later releases may
be promoted there without changing the package name or semantic versioning
contract.

Breaking changes require a major version. Additive types and helpers use a
minor version. Behavioural fixes that preserve the contract use a patch version.
The package must stay framework-neutral so MapLibre remains owned and bundled
exactly once by each application.

## Consequences

- COP is the first consumer, not the owner of APIs for other products.
- Generic map behaviour can be tested independently of the large map component.
- A consumer can use React, native UI or another framework without importing COP.
- The internal routing and public tile service remain independently deployable.
- Publishing the first private package release and exposing a stable internal
  SIM routing v1 contract are explicit follow-up release gates.

## Rejected alternatives

- Share `CopMap` as a whole: rejected because it carries protected COP domains.
- Let public clients call Valhalla: rejected because it exposes internal
  capacity, policy and topology.
- Add Městem hrou endpoints or tables to COP: rejected because product domains
  must remain separate.
- Operate a second tile or OSM database for each application: rejected because
  it duplicates expensive data and creates inconsistent versions.

## Related documents

- [SIM routing handoff](../integration/16_SHARED_GEO_SIM_ROUTING_HANDOFF.md)
- [Městem hrou handoff](../integration/17_MESTEM_HROU_GEO_HANDOFF.md)
- [Tile cache and map tiles](../runbooks/10_TILE_CACHE_AND_MAP_TILES.md)
- [`@zeleznalady/geo-client` package](../../packages/geo-client/README.md)
