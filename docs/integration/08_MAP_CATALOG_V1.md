# 08 Map Catalog v1

## Status

Authoritative COP integration contract.

This document defines the source-neutral map catalog model for COP. SIM is one provider, but not the only possible provider. Future providers can include TAK Gateway, community reports, partner systems, internal registries, object storage backed media layers, static reference datasets, and first-party map tile services.

## Goal

COP must be able to handle hundreds of map layers without hardcoding every layer in the frontend. The map UI, user profiles, native clients, permissions, cache behavior and diagnostics must be driven by a catalog.

The catalog separates user-facing map products from technical data sources:

- `layer`: what the user can choose to see on the map.
- `provider`: the system that exposes data or metadata to COP.
- `source`: the technical upstream or adapter that produced data.
- `stream`: a fetchable data channel or contract endpoint.
- `category`: feature-level subtype used for filtering, styling and detail rendering.
- `technical input`: a model input, raw source or diagnostic source, not a normal user layer.
- `style profile`: reusable rendering rule understood by COP clients.

`enabled=true` on a source only means that the provider runs that source. It does not mean that COP should show it as a normal map layer.

## Design Principles

1. Layer ids are opaque strings, not frontend enums.
2. Sources are not layers.
3. One layer can be composed from multiple sources.
4. One source can feed multiple layers.
5. Technical inputs are shown in diagnostics, not as equivalent user layers.
6. Every layer has an audience and access policy.
7. Every layer has cache and refresh guidance.
8. Dense layers must support tile-oriented delivery, not only bbox GeoJSON.
9. User preferences store catalog `layerId` and filter values, not provider-specific source ids.
10. COP clients must degrade one layer without dropping the whole map.

## Stable Identifiers

Use dot-separated namespaced ids:

```text
public.safety.warnings
public.safety.flood
public.safety.fire
public.safety.weather_alerts
public.boundary.admin
public.weather.current
public.weather.aviation
public.mobile.network
public.traffic.transit
reference.infrastructure.healthcare
reference.infrastructure.emergency
reference.infrastructure.communications
flight.public.tracks
flight.sim.tracks
flight.reference.airports
flight.reference.airspaces
user.zone.alerts
user.community.reports
partner.tak.mobile
diagnostic.mobile.coverage
diagnostic.mobile.ctu_measurements
```

Provider ids should be namespaced:

```text
sim.situation-data
sim.safety-data
sim.flight-data
sim.tak-gateway
cop.community
cop.user-profile
cop.tiles
```

Source ids remain provider-local but must be referenced through provider ids when ambiguity is possible:

```text
sim.situation-data:mobile_network_model
sim.situation-data:ctu_nettest
sim.safety-data:chmi_alerts
```

## Layer Roles

`role` controls where the item appears:

- `primary`: normal user-facing layer.
- `reference`: reference/context layer, usually less prominent.
- `overlay`: transparent thematic area overlay.
- `user`: user-owned data such as zones, location and reports.
- `partner`: non-public partner layer controlled by RBAC/ABAC.
- `diagnostic`: technical/debug layer shown only in diagnostics.

## Source Roles

`sourceRole` describes a provider source:

- `final`: source already produces a user-facing data product.
- `aggregate`: source merges multiple upstream sources into a product.
- `reference`: static or slow-changing reference context.
- `input`: raw/model input used by another final product.
- `projection`: compatibility projection of another contract.
- `mock`: synthetic test data.
- `diagnostic`: operational/debug-only source.

Examples:

| Provider source | sourceRole | Normal COP handling |
| --- | --- | --- |
| `mobile_network_model` | `final` / `aggregate` | user layer `public.mobile.network` |
| `mobile_coverage_model` | `input` / `diagnostic` | diagnostics, optional technical overlay |
| `ctu_nettest` | `input` | diagnostics and provenance |
| `osm_postgis` communications towers | `reference` / `input` | neutral reference infrastructure; never final mobile status |
| `chmi_alerts` | `final` | user layers `public.safety.weather_alerts` and `public.safety.fire` for ČHMÚ fire danger; `public.safety.warnings` remains compatibility alias |
| `nasa_firms` / `fire_hotspots` / `fire_incidents` | `final` | user layer `public.safety.fire` |
| `weather_alerts` | `final` | user layer `public.safety.weather_alerts` |
| `admin_boundaries` | `reference` | user layer `public.boundary.admin` |
| `safety_data` projection in situation-data | `projection` | compatibility only; COP should prefer safety-data |

Compatibility provider metadata:

- `compatibilityOnly=true` marks a layer/source as a fallback projection, not a normal user-facing copy of the same data.
- `preferredProviderId` tells COP which provider is authoritative. For SIM safety projections in `situation-data`, this is `sim.safety-data`.
- When the preferred provider is online and exposes the same catalog `layerId`, COP hides the compatibility layer/source from the normal catalog and uses the preferred provider query.
- When the preferred provider is unavailable or does not expose the layer, COP may keep the compatibility projection as a degraded fallback.

## Catalog API

COP exposes one source-neutral catalog endpoint to web and native clients:

```http
GET /api/v1/map/catalog
```

Optional query parameters:

```text
locale=cs-CZ
includeDiagnostics=false
includePartner=false
```

`includeDiagnostics` and `includePartner` are honored only for authenticated requests. Public-read clients receive the public catalog without diagnostic and partner layers.

Response:

```json
{
  "catalogVersion": "map-catalog-v1",
  "generatedAt": "2026-05-22T08:00:00.000Z",
  "locale": "cs-CZ",
  "providers": [
    {
      "providerId": "sim.situation-data",
      "label": "SIM situation data",
      "status": "online"
    }
  ],
  "groups": [
    {
      "groupId": "risks",
      "label": "Rizika a výstrahy",
      "icon": "alert-triangle",
      "order": 10,
      "children": [
        {
          "groupId": "risks.weather",
          "label": "Počasí",
          "icon": "cloud-sun",
          "order": 20
        }
      ]
    }
  ],
  "layers": [
    {
      "layerId": "public.mobile.network",
      "label": "Mobilní síť",
      "description": "Sjednocené občanské hodnocení dostupnosti mobilní sítě.",
      "groupId": "communications",
      "role": "overlay",
      "audience": "public",
      "kind": "vector_features",
      "defaultVisible": false,
      "selectable": true,
      "geometryTypes": ["Polygon"],
      "minZoom": 6,
      "maxZoom": 18,
      "refreshSeconds": 300,
      "cacheTtlSeconds": 600,
      "styleProfile": "mobile-network-quality-v1",
      "query": {
        "mode": "bbox",
        "providerId": "sim.situation-data",
        "streamId": "features",
        "providerLayerIds": ["mobile_network"],
        "providerSourceIds": ["mobile_network_model"],
        "maxFeatures": 250
      },
      "filters": [
        {
          "filterId": "technology",
          "label": "Technologie",
          "type": "multi_select",
          "values": ["2G", "4G", "5G"],
          "defaultValue": ["4G"]
        }
      ],
      "legend": {
        "profile": "mobile-network-quality-v1"
      },
      "provenance": {
        "sourceIds": ["sim.situation-data:mobile_network_model"],
        "technicalInputs": [
          "sim.situation-data:mobile_coverage_model",
          "sim.situation-data:ctu_nettest",
          "sim.situation-data:osm_postgis"
        ]
      },
      "legal": {
        "attribution": "Czech Telecommunication Office / CTU-NetTest; OpenStreetMap contributors where tower hints are used",
        "notes": [
          "Modelový odhad, ne garantované pokrytí ani potvrzený výpadek operátora."
        ]
      }
    }
  ]
}
```

## Layer Definition

Required fields:

- `layerId`
- `label`
- `groupId`
- `role`
- `audience`
- `kind`
- `defaultVisible`
- `selectable`
- `styleProfile`
- `query`

Recommended fields:

- `description`
- `icon`
- `geometryTypes`
- `minZoom`
- `maxZoom`
- `refreshSeconds`
- `cacheTtlSeconds`
- `offlineCachePolicy`
- `filters`
- `legend`
- `provenance`
- `legal`
- `quality`
- `statusMapping`
- `supersedes`
- `replacedBy`

## Query Kinds

`kind` defines how COP obtains and renders data:

- `vector_features`: bbox-based GeoJSON features.
- `mvt_tiles`: vector tiles for dense layers.
- `raster_tiles`: raster tile overlay.
- `track_stream`: moving objects maintained by COP stream/state.
- `user_objects`: user-owned COP data.
- `static_reference`: slow-changing reference data.
- `aggregate`: composed layer that fans out into several provider queries.

For hundreds of layers, dense public/reference layers should move to `mvt_tiles` or server-side aggregation. Bbox GeoJSON is acceptable for low-volume overlays and detail inspection.

## Universal Map Query API

COP clients should use catalog ids when requesting visible data:

```http
POST /api/v1/map/query
```

Request:

```json
{
  "bbox": [13.85, 49.65, 15.35, 50.45],
  "zoom": 10,
  "layerIds": [
    "public.safety.warnings",
    "public.mobile.network",
    "reference.infrastructure.healthcare"
  ],
  "filters": {
    "public.mobile.network": {
      "technology": ["4G", "5G"]
    }
  }
}
```

Response:

```json
{
  "contractVersion": "cop-map-query-v1",
  "generatedAt": "2026-05-22T08:00:00.000Z",
  "query": {
    "bbox": { "west": 13.85, "south": 49.65, "east": 15.35, "north": 50.45 },
    "layerIds": ["public.mobile.network", "public.safety.warnings"],
    "limit": 250
  },
  "situation": {
    "contractVersion": "cop-situation-source-v1",
    "type": "FeatureCollection",
    "features": [],
    "warnings": []
  },
  "safety": {
    "contractVersion": "cop-safety-source-v1",
    "type": "FeatureCollection",
    "features": [],
    "warnings": []
  },
  "flight": {
    "contractVersion": "cop-flight-reference-v1",
    "type": "FeatureCollection",
    "features": [],
    "warnings": []
  },
  "community": {
    "contractVersion": "cop-community-map-v1",
    "type": "FeatureCollection",
    "features": [],
    "warnings": []
  },
  "summary": {
    "featureCount": 0,
    "layerCount": 2,
    "warningCount": 0
  },
  "warnings": []
}
```

COP may internally fan out to SIM, TAK, COP database, tile services or partner APIs. Clients should not need to know those provider details for normal map rendering.

The response may contain provider result buckets such as `situation`, `safety`, `flight`, `community` and `tak`. A bucket is present only when the requested catalog layers require that provider family. A public catalog layer with `query.kind=vector_features`, `static_reference`, `user_objects` or `aggregate` must be backed by `/api/v1/map/query`; it must not appear as selectable in the normal map menu if COP cannot fetch and render it.

Provider-specific metadata endpoints such as SIM `/layers` and `/sources` are
legacy adapter details and must not be used by new COP integrations. Provider
catalogs are read from `/catalog`; feature queries use the provider's current
source-neutral `/features` endpoint. Deprecated compatibility aliases such as
SIM `/cop/features` must not be called by COP web, native clients or new server
adapters, and must not be stored in user preferences.

## Feature Requirements

Every rendered feature should carry:

```json
{
  "properties": {
    "layerId": "public.mobile.network",
    "providerId": "sim.situation-data",
    "sourceId": "mobile_network_model",
    "category": "mobile_network",
    "label": "4G mobile network assessment",
    "observedAt": "2026-05-22T08:00:00.000Z",
    "stale": false,
    "confidence": 0.72,
    "severity": "info"
  }
}
```

For communications infrastructure references, providers should explicitly mark the feature as a reference and avoid implying operational BTS status:

```json
{
  "properties": {
    "layerId": "reference.infrastructure.communications",
    "providerId": "sim.situation-data",
    "providerLayerId": "mobile.osm_postgis.communications",
    "sourceId": "osm_postgis",
    "category": "communications_tower",
    "status": "unknown",
    "btsStatus": "unknown",
    "operatorStatusAvailable": false,
    "disclaimer": "Reference infrastructure only; BTS operational status is unknown."
  }
}
```

COP renders those points with a neutral reference BTS icon. Green/yellow/orange/red status colors belong to `public.mobile.network` polygons according to `quality`, not to reference tower points.

Provider-native fields may be preserved under:

```json
{
  "properties": {
    "providerProperties": {
      "sim.situation-data": {}
    }
  }
}
```

## Current Layer Mapping

| Catalog layerId | User label | Provider query |
| --- | --- | --- |
| `public.safety.warnings` | Veřejné výstrahy | `sim.safety-data` layer `warnings`, source `chmi_alerts` |
| `public.safety.flood` | Povodně a voda | `sim.safety-data` layer `flood`, source `chmi_hydro` |
| `public.safety.fire` | Požáry | `sim.safety-data` layer `fire`, sources `chmi_alerts`, `nasa_firms`, `fire_hotspots`, `fire_incidents` |
| `public.safety.weather_alerts` | Meteorologické výstrahy | `sim.safety-data` layer `weather_alerts`, source `chmi_alerts` |
| `public.boundary.admin` | Správní hranice | `sim.safety-data` layer `boundary_admin`, source `admin_boundaries` |
| `public.weather.current` | Počasí | `sim.situation-data` layer `weather`, source `open_meteo` |
| `public.weather.aviation` | Letištní počasí | `sim.situation-data` layer `weather`, source `aviation_weather` |
| `public.mobile.network` | Mobilní síť | `sim.situation-data` layer `mobile_network`, source `mobile_network_model` |
| `public.traffic.transit` | Doprava | `sim.situation-data` layer `traffic`, source `pid_gtfs_rt` |
| `reference.infrastructure.healthcare` | Zdravotnictví | `sim.situation-data` layer `ground`, source `osm_postgis`, categories `hospital`, `clinic`, `doctors`, `pharmacy` |
| `reference.infrastructure.emergency` | Záchranná infrastruktura | `sim.situation-data` layer `ground`, source `osm_postgis`, categories `fire_station`, `police`, `ambulance_station`, `shelter` |
| `reference.infrastructure.communications` | BTS / komunikační stožáry | `sim.situation-data` layer `mobile`, source `osm_postgis`, category `communications_tower` |
| `flight.public.tracks` | Veřejné lety | `sim.flight-data` tracks |
| `flight.sim.tracks` | Simulace | COP current track stream, synthetic SIM air objects |
| `flight.reference.airports` | Letiště | `sim.flight-data` airports |
| `flight.reference.airspaces` | Letecké prostory | `sim.flight-data` airspaces |
| `partner.tak.mobile` | Partnerské jednotky | `sim.tak-gateway` layer `mobile` |
| `partner.tak.ground` | Partnerské body | `sim.tak-gateway` layer `ground` |
| `partner.tak.traffic` | Partnerský provoz | `sim.tak-gateway` layer `traffic` |
| `user.zone.alerts` | Uživatelské zóny | COP user profile/community store |
| `user.community.reports` | Hlášení uživatelů | COP community report store |
| `diagnostic.mobile.coverage` | Technický odhad pokrytí | `sim.situation-data` layer `mobile_coverage`, source `mobile_coverage_model` |
| `diagnostic.mobile.ctu_measurements` | ČTÚ měření | `sim.situation-data` layer `mobile`, source `ctu_nettest` |

## Safety Read Model Fields

COP consumes the current SIM safety-data read model without parsing provider-native payloads. Public safety features should carry these normalized fields when available:

| Field | Meaning in COP |
| --- | --- |
| `hazardType`, `status`, `severity` | User-facing risk type and current state. |
| `validFrom`, `validUntil`, `updatedAt` | Alert validity and freshness. |
| `source`, `sourceName`, `basis` | Source/provenance summary. Raw provider URLs may stay in `basis`, but UI should translate known tokens. |
| `geometryMode` | `admin_boundary` means the alert is polygonized from an administrative boundary; `representative_point` is a controlled fallback. |
| `areaName`, `adminLevel`, `affectedAreas` | Human-readable area context. |
| `fireStatus`, `sourceIncident` | Fire-specific state and source classification. `fireStatus=risk` with `sourceIncident=CHMI_CAP_FIRE_DANGER` means fire danger conditions, not a confirmed fire. |
| `riverName`, `stationId`, `waterLevelCm`, `discharge`, `floodStage`, `trend`, `basin`, `catchmentAreaKm2` | Hydrology-specific fields for `public.safety.flood`. |

For ČHMÚ CAP alerts COP renders `Polygon`/`MultiPolygon` as the primary representation. If SIM returns `geometryMode=representative_point`, COP may still show the point, but the detail must make clear that the original administrative geometry was unavailable.

For hydrology COP displays flood stage and trend as informational context. It does not infer evacuation, routing, rescue priorities, or any operational action from those values.

For fire COP distinguishes confirmed/observed fire context from ČHMÚ fire danger. ČHMÚ `fire_weather`/`CHMI_CAP_FIRE_DANGER` features are shown as official fire-risk polygons, not as confirmed incident locations.

COP reads SIM safety operations only server-side through `GET /safety-data/api/v1/observability`. The response is sanitized operational metadata, not a user map layer. COP maps it into provider health: stale feature counts and source-cache errors become operational warnings, while `status=degraded` is displayed as reduced external data quality rather than a map or SIM outage. Public clients must keep using `/api/v1/map/catalog` and `/api/v1/map/query`; they must not query SIM `/observability` or `/metrics` directly.

## Provider Catalog Requirements

Providers should expose metadata that COP can translate into the map catalog.

Minimum provider layer metadata:

- stable provider layer id,
- label,
- description,
- geometry types,
- expected cadence,
- categories,
- recommended role,
- recommended audience,
- recommended style profile,
- default visibility,
- access constraints,
- cache TTL,
- legal attribution.

Minimum provider source metadata:

- source id,
- label,
- enabled state,
- source role,
- audience,
- upstream base URL or redacted backend class,
- license,
- update cadence,
- technical inputs,
- superseded/replaced-by relation.

Providers should expose a provider catalog endpoint such as `/catalog` and keep
feature delivery behind the provider contract. COP translates provider metadata
into this source-neutral catalog and keeps provider-specific contracts behind the
server boundary.

## Migration Rules

1. Existing COP preferences using provider layers are migrated to catalog layer ids.
2. `mobile` and `mobile_coverage` in public profiles map to `public.mobile.network`.
3. `warnings`, `flood`, `fire`, `weather_alerts` and `boundary_admin` should map to `public.safety.warnings`, `public.safety.flood`, `public.safety.fire`, `public.safety.weather_alerts` and `public.boundary.admin`, preferably through `safety-data`.
4. Source ids such as `ctu_nettest`, `osm_postgis` and `mobile_coverage_model` must not remain in normal user layer preferences.
5. Diagnostic layers are available only when the user has diagnostic/admin capability.

## Acceptance Criteria

- COP web can render a layer tree only from `/api/v1/map/catalog`.
- A newly added provider layer can appear in diagnostics without frontend code changes.
- A newly added public layer can appear in the layer tree by catalog metadata and style profile.
- User preferences contain catalog `layerId` values.
- Technical SIM inputs are visible in source health but not as normal map checkboxes.
- Mobile network user view resolves to `mobile_network_model`, not raw `mobile`, `ctu_nettest` or `mobile_coverage`.
- Degraded provider state affects only dependent layers.

## Mobile Network Read Model Metadata

The public mobile network layer remains `public.mobile.network`, backed by the
SIM provider layer `mobile_network` and source `mobile_network_model`.

When SIM returns mobile network features with `readModel: true`, COP treats them
as a prepared coverage read model and labels the detail as precomputed coverage.
The following provider metadata is preserved by COP:

- `readModel` - prepared read-model flag,
- `sourceRevision` - technical model/source revision for diagnostics,
- `basis` - translated into user-readable data provenance labels,
- `metrics.coverageReadModel` - secondary read-model indicator.

COP must not expose `mobile_coverage` as a normal public layer. Diagnostic
mobile layers such as `diagnostic.mobile.coverage`,
`diagnostic.mobile.ctu_measurements`, and
`diagnostic.mobile.ctu_stationary_measurements` belong only in diagnostics or
admin views.
