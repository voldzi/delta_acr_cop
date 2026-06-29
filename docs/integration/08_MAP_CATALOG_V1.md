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

## COP Public Menu Curation

The provider catalog can contain more map products than the public COP layer
menu should expose. COP is allowed to keep a layer in `/api/v1/map/catalog`
while marking it `selectable=false` for the basic public UI when the layer is a
technical variant, a low-density fallback or a future advanced product.

Current weather curation:

| Provider layer purpose | Public COP behavior |
| --- | --- |
| Current weather summary | kept as non-selectable reference `public.weather.current` for diagnostics and fallback details |
| ČHMÚ station observations | main selectable weather layer `public.weather.observations`, shown to users as `Počasí` |
| ČHMÚ weather webcams | selectable as `public.weather.webcams` with camera point icons and preview through COP proxy |
| ČHMÚ radar precipitation overlay | selectable as `public.weather.radar_precipitation` |
| Air quality station observations | selectable as `public.safety.air_quality` |
| Radar reflectivity / nowcast variants | kept in catalog, hidden from basic public selection until timeline/animation UI is ready |
| Temperature, precipitation, humidity and pressure grid layers | selectable advanced weather overlays |
| Wind vector field | selectable advanced weather overlay |
| Air-quality grid fallback | kept in catalog, hidden from basic public selection until SIM provides dense stable tiles or a documented grid endpoint |

Native clients should use the `selectable` flag for the normal user-facing
layer picker and may expose non-selectable public layers only in an explicit
advanced/diagnostic view.

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
| `gdacs_alerts` | `final` | global GDACS crisis context; `FL` maps to `public.safety.flood`, `WF` to `public.safety.fire`, other supported crisis types to `public.safety.warnings` |
| `hzs_incidents` | `final` | current HZS incidents; fires also feed `public.safety.fire`, other incident types feed `public.safety.warnings` |
| `road_srti_lod` | `final` | NDIC/ŘSD SRTI road safety events in `public.safety.warnings` with canonical `road.*` type codes |
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
- `vector_field`: dense vector field derived from sampled provider data, typically rendered as arrows/isolines/streamlines.
- `grid_field`: raster-like numeric grid or interpolated field, typically rendered as heat/contour/wind overlay.
- `mvt_tiles`: vector tiles for dense layers.
- `raster_overlay`: one georeferenced image overlay. Provider features may carry a GeoJSON polygon only as image extent; clients must render `providerProperties.raster.url` at `providerProperties.raster.boundsWgs84` and must not fill the extent polygon as data.
- `raster_tiles`: raster tile overlay.
- `track_stream`: moving objects maintained by COP stream/state.
- `user_objects`: user-owned COP data.
- `static_reference`: slow-changing reference data.
- `aggregate`: composed layer that fans out into several provider queries.

For hundreds of layers, dense public/reference layers should move to `mvt_tiles`, `raster_overlay`, `grid_field`, `vector_field` or server-side aggregation. Bbox GeoJSON is acceptable for low-volume overlays and detail inspection. Clients that do not yet support a kind must hide it from normal layer selection while preserving it in diagnostics/catalog inspection.

`query.mode` values:

- `bbox`: COP can request provider GeoJSON-like features for the current viewport.
- `grid`: provider exposes a field/grid read model; clients need a renderer that understands the layer kind.
- `tile`: provider exposes tiles.
- `stream`: COP stream/state owns moving objects.
- `internal`: COP-owned user/profile/community data.

## Universal Map Query API

COP clients should use catalog ids when requesting visible data. Provider `/layers`, `/sources` and legacy `/cop/features` endpoints are adapter details and must not be called by web or native clients.

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

### Raster Overlay Images

Catalog layers with `kind=raster_overlay` are represented in `/api/v1/map/query` as GeoJSON features whose geometry is only the raster extent. Clients must not render that extent as a filled polygon.

The actual image is described by `properties.providerProperties.raster`:

```json
{
  "rendering": {
    "mode": "raster_overlay",
    "geometryRole": "raster_extent",
    "doNotRenderGeometryFill": true
  },
  "providerProperties": {
    "raster": {
      "url": "https://opendata.chmi.cz/.../radar.png",
      "boundsWgs84": [11.267, 48.047, 20.77, 52.167],
      "opacity": 0.58
    }
  }
}
```

Web and native clients must load the image through COP:

```http
GET /api/v1/map/raster-overlay?url=<percent-encoded providerProperties.raster.url>
```

COP validates the upstream host against a strict allowlist, accepts only image responses and adds cache headers. Clients must not call ČHMÚ, SIM provider URLs or other external raster URLs directly from the browser or native app. If a client does not support raster image overlays, it must hide the layer instead of drawing the extent polygon.

For ČHMÚ radar, SIM is the only data provider. Radar features are metadata
carriers for server-cleaned raster images; their geometry is only the raster
extent. COP must use `providerProperties.raster.url`, which points to the SIM
clean endpoint `/api/v1/weather-radar/clean/{productId}/{fileName}`. Fields
such as `providerProperties.raster.rawUrl` and `sourceUrl` are diagnostic only
and must not be used for normal rendering. COP accepts SIM clean relative paths
in `/api/v1/map/raster-overlay`; it resolves them server-side against the
configured situation-data provider URL.

Radar playback is exposed by COP, not directly by SIM:

```http
GET /api/v1/weather-radar/frames?product=merge1h&hours=6&limit=24
```

COP fetches the SIM frame catalog server-side and caches it for a short window
(`COP_WEATHER_RADAR_FRAMES_CACHE_SECONDS`, default 120 seconds). Clients sort
frames by `observedAt`, use `frame.cleanUrl` through `/api/v1/map/raster-overlay`
and refresh the catalog in live mode approximately every five minutes. Warnings
from the frame catalog are source-quality diagnostics, not citizen safety
alerts.

The normal user-facing weather layer is `public.weather.observations`: measured
ČHMÚ stations rendered as weather symbols with locality name, temperature and a
secondary metric such as wind or recent precipitation. If SIM provides
`weatherSymbolKey` and `weatherConditionLabel`, COP renders those values
directly. Otherwise COP may infer a conservative symbol from WMO weather code,
precipitation, cloud cover, humidity, wind and temperature.

`public.weather.current` is only a reference point summary for the center of the
current map view. It is identified by `providerLayerId=weather.open_meteo` or
`tags.mapDisplayHint=weather_observation_point` and should be labeled "Počasí
ve středu mapy" in diagnostics or fallback details. It is not a polygon, grid
or raster and should not be the primary public weather menu item. Area weather
visualization uses the grid/field layers such as
`public.weather.temperature_grid`, `public.weather.precipitation_grid`,
`public.weather.wind_field`, `public.weather.humidity_grid` and
`public.weather.pressure_grid`.

Provider-specific metadata endpoints such as SIM `/layers` and `/sources` are
legacy adapter details and must not be used by new COP integrations. Provider
catalogs are read from `/catalog`; feature queries use the provider's current
source-neutral `/features` endpoint. Deprecated compatibility aliases such as
SIM `/cop/features` must not be called by COP web, native clients or new server
adapters, and must not be stored in user preferences.

SIM taxonomy endpoints are server-side COP inputs:

```http
GET /situation-data/api/v1/taxonomy
GET /safety-data/api/v1/taxonomy
```

COP reads them through the configured internal provider URL, caches the response
with the provider adapter and exposes only derived provider health metadata to
clients. Clients must not call taxonomy endpoints directly. Layer and alert
meaning is determined from stable fields such as `layerId`, `sourceId`,
`typeCode`, `sourceCode`, `sourceSystem`, `hazardType`, `category`, `severity`,
`validFrom`, `validUntil`, `metrics`, `tags`, `localized`,
`providerProperties.taxonomy`, `providerProperties.presentation` and
`providerProperties.notification`; localized Czech or English text is
presentation only.

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
| `public.safety.warnings` | Krizové výstrahy | `sim.safety-data` layer `warnings`, sources `chmi_alerts`, `gdacs_alerts`, `hzs_incidents`, `road_srti_lod` |
| `public.safety.flood` | Vodní stavy a průtoky | `sim.safety-data` layer `flood`, sources `chmi_hydro`, `gdacs_alerts` |
| `public.safety.fire` | Požáry | `sim.safety-data` layer `fire`, sources `chmi_alerts`, `gdacs_alerts`, `hzs_incidents`, `nasa_firms`, `fire_hotspots`, `fire_incidents` |
| `public.safety.weather_alerts` | Meteorologické výstrahy | `sim.safety-data` layer `weather_alerts`, source `chmi_alerts` |
| `public.boundary.admin` | Správní hranice | `sim.safety-data` layer `boundary_admin`, source `admin_boundaries` |
| `public.boundary.country` | Stát | `sim.situation-data` layer `boundary_country`, source `osm_postgis` |
| `public.boundary.region` | Kraje | `sim.situation-data` layer `boundary_region`, source `osm_postgis` |
| `public.boundary.district` | Okresy | `sim.situation-data` layer `boundary_district`, source `osm_postgis` |
| `public.boundary.orp` | ORP | `sim.situation-data` layer `boundary_orp`, source `osm_postgis` |
| `public.boundary.municipality` | Obce | `sim.situation-data` layer `boundary_municipality`, source `osm_postgis` |
| `public.place.settlements` | Sídla | `sim.situation-data` layer `place_settlements`, source `osm_postgis` |
| `public.weather.current` | Počasí ve středu mapy | `sim.situation-data` layer `weather`, source `open_meteo`; non-selectable reference/fallback layer |
| `public.weather.observations` | Počasí | `sim.situation-data` layer `weather`, source `chmi_weather_stations`; primary public weather layer |
| `public.weather.webcams` | Kamery | `sim.situation-data` layer `weather_webcams`, source `chmi_weather_webcams`; samostatná kamerová vrstva používající `properties.providerProperties.camera.detailUrl` nebo `snapshotUrl` přes COP proxy |
| `public.weather.aviation` | Letištní počasí | `sim.situation-data` layer `weather`, source `aviation_weather` |
| `public.safety.air_quality` | Kvalita ovzduší | `sim.situation-data` layer `air_quality`, source `chmi_air_quality` |
| `public.weather.temperature_grid` | Teplota | `sim.situation-data` layer `weather_temperature_grid`, source `chmi_weather_stations` |
| `public.weather.wind_field` | Vítr | `sim.situation-data` layer `weather_wind_field`, source `chmi_weather_stations` |
| `public.weather.precipitation_grid` | Srážky | `sim.situation-data` layer `weather_precipitation_grid`, source `chmi_weather_stations`; hodnota je `mm/10min` |
| `public.weather.humidity_grid` | Vlhkost | `sim.situation-data` layer `weather_humidity_grid`, source `chmi_weather_stations` |
| `public.weather.pressure_grid` | Tlak | `sim.situation-data` layer `weather_pressure_grid`, source `chmi_weather_stations` |
| `public.weather.radar_reflectivity` | Radarová odrazivost | `sim.situation-data` layer `weather_radar_reflectivity`, source `chmi_weather_radar`; `raster_overlay`, geometrie je jen rozsah rastru |
| `public.weather.radar_precipitation` | Radarové srážky | `sim.situation-data` layer `weather_radar_precipitation`, source `chmi_weather_radar`; `raster_overlay`, geometrie je jen rozsah rastru |
| `public.weather.radar_nowcast` | Radarový nowcast | `sim.situation-data` layer `weather_radar_nowcast`, source `chmi_weather_radar`; `raster_overlay`, geometrie je jen rozsah rastru |
| `public.safety.thunderstorm_risk` | Bouřkové riziko | `sim.situation-data` layer `weather_thunderstorm_risk`, source `chmi_weather_radar`; `raster_overlay`, geometrie je jen rozsah rastru |
| `public.safety.air_quality_grid` | Kvalita ovzduší - plocha | `sim.situation-data` layer `air_quality_grid`, source `chmi_air_quality` |

ČHMÚ webkamery jsou jen vizuální kontext počasí a jsou oddělené od vrstvy
`public.weather.observations`. COP je nezapočítává jako výstrahy, neotevírá
incident automaticky a v UI je vede jako samostatné klikací ikony kamer se
stavem `KAMERA`. Klienti nesmí volat upstream ČHMÚ přímo; detail a snapshot
musí jít přes URL předané v `providerProperties.camera` a v COP webu přes
`/api/v1/weather/webcam-proxy`. Náhled musí vždy zobrazit atribuci
`Český hydrometeorologický ústav`.
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
| `user.sketch.drawings` | Zákresy | COP sketch drawing store |
| `diagnostic.mobile.coverage` | Technický odhad pokrytí | `sim.situation-data` layer `mobile_coverage`, source `mobile_coverage_model` |
| `diagnostic.mobile.ctu_measurements` | ČTÚ měření | `sim.situation-data` layer `mobile`, source `ctu_nettest` |

For `grid_field` weather/environment layers, clients must color the geometry from the numeric value, not from generic severity. Prefer `properties.rendering.valueMetric`; otherwise use `properties.metrics.value`, then the layer-specific fallback metric. Use the catalog `legend` for labels, stops and units. For `public.weather.precipitation_grid`, the unit is `mm/10min`.

For `raster_overlay` weather layers, provider GeoJSON geometry is only the raster extent. Clients must not render that geometry as a filled polygon. They render the image from `providerProperties.raster.url` with `providerProperties.raster.boundsWgs84`, opacity and attribution. If a client cannot render image overlays, it hides the layer from the normal picker.

## Safety Read Model Fields

COP consumes the current SIM safety-data read model without parsing provider-native payloads. Public safety features should carry these normalized fields when available:

| Field | Meaning in COP |
| --- | --- |
| `typeCode` | Authoritative machine type of the safety phenomenon, for example `weather.temperature.high`, `weather.fire_danger`, `hydro.flood.warning` or `air_quality.pm10.smog`. COP must prefer this field over legacy text fields such as `headline`, `event` or `hazardType` when classifying the feature. |
| `sourceCode`, `sourceSystem` | Provider-native source code and code system, for example ČHMÚ/SIVS `I.2`, `VII.1`, `SMOGSIT.PM10` or CAP fallback `AWARENESS.5`. |
| `localized.cs`, `localized.en` | Localized title, detail and recommendation text. COP uses `localized.cs` for Czech UI and notifications; `localized.en` is optional for bilingual clients. |
| `providerProperties.taxonomy` | SIM canonical taxonomy fallback for `typeCode`, `sourceCode` and `sourceSystem` when top-level fields are absent. |
| `providerProperties.presentation` | Presentation metadata. COP should use `iconKey`, `styleKey` and `detailTemplate` for map symbols, detail panels and concise UI labels. |
| `providerProperties.notification` | Notification policy metadata. COP must respect `eligible=false` as a hard block for push notification candidates, while the feature may still be displayed on the map. |
| `status`, `severity` | Current state and severity. They influence color and urgency, but they do not replace `typeCode`. |
| `validFrom`, `validUntil`, `updatedAt` | Alert validity and freshness. |
| `source`, `sourceName`, `basis` | Source/provenance summary. Raw provider URLs may stay in `basis`, but UI should translate known tokens. |
| `geometryMode` | `admin_boundary` means the alert is polygonized from an administrative boundary; `representative_point` is a controlled fallback. |
| `areaName`, `adminLevel`, `affectedAreas` | Human-readable area context. |
| `fireStatus`, `sourceIncident` | Fire-specific state and source classification. `typeCode=weather.fire_danger` or `sourceIncident=CHMI_CAP_FIRE_DANGER` means fire danger conditions, not a confirmed fire. |
| `riverName`, `stationId`, `waterLevelCm`, `discharge`, `waterTemperatureC`, `floodStage`, `trend`, `basin`, `catchmentAreaKm2` | Hydrology-specific fields for `public.safety.flood`. |
| `detailUrl`, `timelineUrl`, `forecastAvailable`, `forecastUntil` | Hydrology detail/timeline metadata. COP derives `stationId` and query from SIM `detailUrl`, calls COP proxy `/api/v1/safety/hydro/stations/{stationId}/observations`, and renders H/Q/TH history, H_F/Q_F forecast, drought and SPA thresholds. |

For ČHMÚ CAP alerts COP renders `Polygon`/`MultiPolygon` as the primary representation. If SIM returns `geometryMode=representative_point`, COP may still show the point, but the detail must make clear that the original administrative geometry was unavailable.

For hydrology COP maps `floodStage=0` to info, `1` to advisory, `2` to warning and `>=3` to critical for citizen notification evaluation. `trend=rising` is displayed as a trend highlight only and must not become a critical trigger by itself. COP does not infer evacuation, routing, rescue priorities, or any operational action from those values.

For fire COP distinguishes confirmed/observed fire context from ČHMÚ fire danger. ČHMÚ `typeCode=weather.fire_danger` or `sourceIncident=CHMI_CAP_FIRE_DANGER` features are shown as official fire-risk polygons, not as confirmed incident locations.

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
COP drops `mobile_network` features from `mobile_network_model` when they are
not backed by `readModel: true`, when their feature id matches the removed
synthetic fallback shape `mobile_network:aggregate:mixed:*`, when a filtered
technology query would receive a different technology, or when geometry is
outside Czechia / implausibly large for a read-model cell.
The following provider metadata is preserved by COP:

- `readModel` - prepared read-model flag,
- `sourceRevision` - technical model/source revision for diagnostics,
- `basis` - translated into user-readable data provenance labels,
- `metrics.coverageReadModel` - secondary read-model indicator.

For the normal public map COP uses the SIM situation-data feature flow with
provider layer `mobile_network` and source `mobile_network_model`. COP does not
call deprecated provider shortcuts for this layer. When SIM returns
`operatorStatusAvailable: false` or
`btsStatus: "operator_feed_unavailable"`, COP must present the feature as a
model estimate, not as a confirmed BTS outage or confirmed operator state.
User-facing detail should prioritize `quality`, `status`, `confidence`,
`summary` and `notices`.

If `mobile_network_model` returns no public read-model cells for a requested
area, COP may fill `public.mobile.network` from `mobile_coverage_model` as a
degraded model-only fallback. The feature provenance must remain visible
(`sourceId: mobile_coverage_model`, `layer: mobile_coverage`) and the response
must carry a warning that the result is not an operator-confirmed BTS status.
This keeps the citizen layer usable while SIM rebuilds or backfills the final
read model, without presenting diagnostic cells as authoritative operator data.

If a user opens a mobile-network cell detail, COP may query the diagnostic
provider layer `mobile_coverage` with source `mobile_coverage_model` for the
same local area and selected technology. That technical detail can expose LoS
and DEM context such as `metrics.terrainPenaltyDb`,
`metrics.terrainMaxObstructionM`, `metrics.distanceToNearestTowerM`,
`metrics.towerElevationM`, `metrics.targetElevationM`, `demSource`,
`assumptions.terrainApplied` and `assumptions.propagationModel`. It remains
diagnostic evidence only.

When a user selects one BTS / communication tower reference, COP may fetch the
interactive per-tower viewshed through the COP backend:

`GET /api/v1/mobile-coverage/towers/{towerId}/viewshed?technology=4G&radiusM=12000&azimuthStepDeg=10&distanceStepM=500`

The COP backend calls the SIM internal
`/situation-data/api/v1/mobile-coverage/towers/{towerId}/viewshed` endpoint
server-side. `towerId` is built from OSM tags as `{osmType}:{osmId}` when the
selected feature is an OSM tower, or from `tags.nearestTowerId` when the user
is viewing a coverage detail. COP must not call this endpoint for all BTS at
once. The returned sectors are a temporary map overlay for the selected tower
only. Sector color follows `properties.quality` and opacity follows
`properties.confidence`.

The detail panel must state that this is a SIM model estimate, not confirmed
operator/NOC state. It should display `tower.btsStatus`,
`tower.operatorStatusAvailable`, `summary.disclaimer`,
`properties.assumptions.sectorAware`,
`properties.assumptions.operatorRfPlanAvailable` and, when DEM is available,
`terrainPenaltyDb`, `terrainMaxObstructionM` and `lineOfSightClear`.

## Radio LoS Planning Tool

Radio LoS is an interactive analysis tool, not a selectable catalog map layer.
COP exposes it through its backend under `/api/v1/radio/*` and calls SIM
server-side through the configured internal `situation-data` URL. Browsers and
native clients must not call SIM radio endpoints directly.

COP supports three operator workflows:

- `POST /api/v1/radio/coverage` - coverage from the current or selected point.
- `POST /api/v1/radio/link-check` - line-of-sight check between two points.
- `POST /api/v1/radio/site-search` - best candidate sites inside the current
  map bbox for one or more targets.

The supporting profile catalog is:

- `GET /api/v1/radio/profiles`
- `POST /api/v1/radio/profiles`

The profile shape is a non-sensitive technical template:

```json
{
  "profileId": "pmr446_handheld",
  "name": "PMR446 ruční stanice",
  "frequencyMhz": 446,
  "txPowerW": 0.5,
  "antennaHeightM": 1.5,
  "receiverHeightM": 1.5,
  "antennaGainDbi": 0,
  "systemLossDb": 2,
  "requiredFresnelClearancePct": 60,
  "maxRadiusM": 5000
}
```

Mandatory profile fields are `name`, `frequencyMhz`, `antennaHeightM`,
`receiverHeightM` and `maxRadiusM`. Optional fields are `txPowerW`,
`antennaGainDbi`, `receiverSensitivityDbm`, `systemLossDb` and
`requiredFresnelClearancePct`.

Military-oriented profiles must remain generic templates. COP must not send
classified frequencies, COMSEC information, callsigns, crypto/key material or
operational tactical notes to SIM. COP rejects radio requests containing
sensitive field names before it calls SIM.

Every rendered result must display:

> Výsledek je modelový odhad podle DEM a zadaných parametrů rádia. Nezahrnuje
> budovy, vegetaci, rušení, reálné vytížení sítě ani utajené/operátorské RF
> parametry.

Coverage and site-search responses are rendered as temporary map overlays.
Coverage sector color follows `properties.quality` (`good`, `fair`, `weak`,
`none`, `unknown`) and opacity follows `properties.confidence`. Link-check
results show `linkStatus`, `distanceM`, `azimuthDeg`,
`maxObstructionM`, `fresnelClearancePct`,
`requiredExtraAntennaHeightM` and the SIM-provided profile/elevation metadata
when present.

COP must not expose `mobile_coverage` as a normal public layer. Diagnostic
mobile layers such as `diagnostic.mobile.coverage`,
`diagnostic.mobile.ctu_measurements`, and
`diagnostic.mobile.ctu_stationary_measurements` belong only in diagnostics or
admin views.
