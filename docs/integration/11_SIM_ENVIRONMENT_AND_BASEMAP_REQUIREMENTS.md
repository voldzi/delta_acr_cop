# SIM Environment And Basemap Requirements

## Status

Authoritative request from COP to SIM providers.

This document describes the additional provider data COP needs for professional environmental overlays, simplified civil basemaps, localized labels and scalable cache behavior. SIM remains the server-to-server data provider. COP remains the presentation, user profile, permission and client cache layer.

## Goal

COP can already display point observations for weather and air quality. That is useful for detail inspection, but it is not enough for a professional map experience similar to Ventusky:

- heat maps for temperature, air quality, precipitation and similar fields,
- animated wind vectors,
- stable colors while panning and zooming,
- simplified map mode with country, regional and district boundaries,
- localized Czech/English user-facing labels,
- provider-side cache so thousands of COP users do not create external upstream load.

COP must not query ČHMÚ, CTU, OSM, DEM or other upstream data directly from browser clients. COP should call SIM internally and use provider catalog metadata to decide what can be shown.

## Access Pattern

COP backend should use internal provider URLs only:

```text
http://docker.home.cz:5020/situation-data/api/v1
http://docker.home.cz:5020/safety-data/api/v1
http://docker.home.cz:5020/flight-data/api/v1
http://docker.home.cz:5020/tak-gateway/api/v1
```

Public SIM provider endpoints should remain blocked except documented health/docs endpoints. Browser clients should call COP, not SIM.

## Required Catalog Additions

SIM should expose the new layers through the existing map catalog contract. Layer ids below are COP-facing stable ids; provider layer ids may stay SIM-local.

### Environmental Grid Layers

| COP layerId | Provider layer | Role | Kind | Default | Purpose |
| --- | --- | --- | --- | --- | --- |
| `public.weather.temperature_grid` | `weather.temperature_grid` | `overlay` | `grid_field` or `raster_tiles` | off | Continuous temperature heat map |
| `public.weather.wind_field` | `weather.wind_field` | `overlay` | `vector_field` | off | Wind speed/direction and particle animation |
| `public.weather.precipitation_grid` | `weather.precipitation_grid` | `overlay` | `grid_field` or `raster_tiles` | off | Rain/snow intensity or recent precipitation |
| `public.weather.humidity_grid` | `weather.humidity_grid` | `overlay` | `grid_field` or `raster_tiles` | off | Relative humidity |
| `public.weather.pressure_grid` | `weather.pressure_grid` | `overlay` | `grid_field` or `raster_tiles` | off | Pressure field |
| `public.safety.air_quality_grid` | `air_quality.grid` | `overlay` | `grid_field` or `raster_tiles` | off | Continuous air quality / pollutant map |

Point layers remain valid and should stay separately selectable:

```text
public.weather.observations
public.safety.air_quality
```

### Simplified Basemap / Boundary Layers

COP needs a lightweight civil basemap mode that does not rely on dense OSM raster details. SIM should provide generalized vector boundaries suitable for high zoom-out views.

| COP layerId | Provider layer | Role | Kind | Default | Purpose |
| --- | --- | --- | --- | --- | --- |
| `public.boundary.country` | `boundary.country` | `reference` | `vector_features` or `mvt_tiles` | on in simple map | State borders |
| `public.boundary.region` | `boundary.region` | `reference` | `vector_features` or `mvt_tiles` | on in simple map | Czech kraj boundaries |
| `public.boundary.district` | `boundary.district` | `reference` | `vector_features` or `mvt_tiles` | off | Okres boundaries |
| `public.boundary.orp` | `boundary.orp` | `reference` | `vector_features` or `mvt_tiles` | off | ORP boundaries for warnings and diagnostics |
| `public.place.settlements` | `place.settlements` | `reference` | `mvt_tiles` | on in simple map | Settlement/city labels |

`public.boundary.admin` can stay as a compatibility umbrella, but COP needs level-specific layers for a clean UI.

## Preferred Delivery Model

### Production Recommendation

For dense environmental overlays, SIM should prefer stable tiles or stable grids over viewport-generated GeoJSON polygons.

Recommended order:

1. Vector tiles for boundaries and sampled vector fields.
2. Precomputed raster or image tiles for heatmap-like overlays.
3. Binary/typed-array grid endpoint for clients that need raw values.
4. GeoJSON grid cells only for debugging or low-resolution fallback.

SIM must not generate a new grid origin from every requested viewport. Small pans/zooms must keep the same underlying cell alignment, otherwise colors will appear to jump.

### Grid Endpoint

If SIM implements a raw grid endpoint, use a stable national or WebMercator-tile-aligned grid:

```http
GET /situation-data/api/v1/grid?bbox=west,south,east,north&layers=weather.wind_field,weather.temperature_grid&resolutionM=1000&time=latest
```

Response:

```json
{
  "contractVersion": "sim-environment-grid-v1",
  "providerId": "sim.situation-data",
  "generatedAt": "2026-05-29T10:00:00.000Z",
  "validAt": "2026-05-29T09:50:00.000Z",
  "expiresAt": "2026-05-29T10:10:00.000Z",
  "bbox": {
    "west": 14.0,
    "south": 49.8,
    "east": 14.8,
    "north": 50.3
  },
  "grid": {
    "crs": "EPSG:4326",
    "width": 120,
    "height": 90,
    "resolutionM": 1000,
    "origin": {
      "lon": 13.0,
      "lat": 51.5
    },
    "scanOrder": "west-east,north-south"
  },
  "layers": [
    {
      "layerId": "public.weather.wind_field",
      "providerLayerId": "weather.wind_field",
      "sourceId": "chmi_weather_grid",
      "unit": "m/s",
      "encoding": "float32-array-base64",
      "components": {
        "uMps": "<base64-float32>",
        "vMps": "<base64-float32>"
      },
      "min": -14.2,
      "max": 17.4,
      "nodata": null,
      "confidence": 0.74,
      "dataQuality": "mixed",
      "readModel": true,
      "basis": [
        "CHMI_STATION_OBSERVATIONS",
        "INTERPOLATED_FIELD"
      ],
      "sourceRevision": "weather-grid-v1|resolutionM=1000|method=idw",
      "stale": false
    }
  ],
  "warnings": []
}
```

### Vector Tile Endpoint

For boundaries and sampled wind vectors, SIM can expose vector tiles:

```http
GET /situation-data/api/v1/tiles/{providerLayerId}/{z}/{x}/{y}.mvt
```

For `weather.wind_field`, each feature should carry:

```json
{
  "uMps": -2.1,
  "vMps": 4.8,
  "windSpeedMps": 5.2,
  "windDirectionDeg": 336,
  "windGustMps": 9.1,
  "confidence": 0.8,
  "observedAt": "2026-05-29T09:50:00.000Z",
  "validAt": "2026-05-29T10:00:00.000Z",
  "stale": false
}
```

### Raster Tile Endpoint

For low-power clients and stable heat maps:

```http
GET /situation-data/api/v1/raster/{providerLayerId}/{z}/{x}/{y}.png
```

Raster tiles must include a catalog legend with value stops, unit and opacity recommendation. COP still needs feature/metadata endpoints for details and provenance; raster tiles alone are not enough.

## Required Feature Properties

SIM should keep stable machine-readable enum values and provide localized labels separately.

### Common

```json
{
  "layerId": "public.weather.temperature_grid",
  "providerId": "sim.situation-data",
  "providerLayerId": "weather.temperature_grid",
  "sourceId": "chmi_weather_grid",
  "label": "Teplota",
  "labelLocalized": {
    "cs": "Teplota",
    "en": "Temperature"
  },
  "summary": "18 °C, měřený a interpolovaný odhad",
  "summaryLocalized": {
    "cs": "18 °C, měřený a interpolovaný odhad",
    "en": "18 °C, observed and interpolated estimate"
  },
  "observedAt": "2026-05-29T09:50:00.000Z",
  "generatedAt": "2026-05-29T09:52:00.000Z",
  "validAt": "2026-05-29T10:00:00.000Z",
  "stale": false,
  "staleReason": null,
  "confidence": 0.82,
  "dataQuality": "observed|modelled|mixed|unknown",
  "readModel": true,
  "sourceRevision": "chmi-grid-v1|interpolation=idw|resolutionM=1000",
  "basis": [
    "CHMI_STATION_OBSERVATIONS",
    "INTERPOLATED_FIELD"
  ],
  "legal": {
    "attribution": "ČHMÚ Open Data",
    "license": "according-to-source"
  }
}
```

### Weather Fields

Use SI units and normalized names:

```json
{
  "temperatureC": 18.4,
  "relativeHumidityPercent": 73,
  "pressureHpa": 1017.2,
  "windDirectionDeg": 336,
  "windSpeedMps": 5.2,
  "windGustMps": 9.1,
  "uMps": -2.1,
  "vMps": 4.8,
  "precipitation10mMm": 0.0,
  "precipitation1hMm": 0.2,
  "precipitation24hMm": 4.1
}
```

### Air Quality Fields

```json
{
  "airQualityIndex": 3,
  "airQualityLevel": "good|fair|moderate|poor|very_poor|unknown",
  "dominantPollutant": "pm10",
  "pm10UgM3": 22,
  "pm25UgM3": 11,
  "no2UgM3": 18,
  "noxUgM3": 26,
  "o3UgM3": 76,
  "so2UgM3": 4,
  "coUgM3": 180
}
```

### Boundary Fields

```json
{
  "boundaryLevel": "country|region|district|orp|municipality",
  "countryCode": "CZ",
  "adminCode": "CZ010",
  "name": "Hlavní město Praha",
  "nameLocalized": {
    "cs": "Hlavní město Praha",
    "en": "Prague"
  },
  "generalizationM": 500,
  "source": "czso|osm_postgis|ruian|natural_earth",
  "sourceName": "ČSÚ / RÚIAN"
}
```

## Localization Requirements

COP is at least Czech and English. SIM should provide:

- stable enum/code values in English-like machine form,
- `labelLocalized.cs` and `labelLocalized.en` for layer and feature labels where provider knows the user-facing name,
- `summaryLocalized.cs` and `summaryLocalized.en` for generated summaries,
- localized catalog group labels if SIM controls them,
- no UI-only English labels embedded into `label` when a Czech equivalent exists.

COP will still have its own translation table for generic UI controls, but provider-specific object names, hazard summaries and station names should come localized when possible.

## Cache And Refresh Requirements

SIM is responsible for upstream cache and read-model cache. COP adds a second short-lived server-side cache by canonical bbox/layer/filter query.

Recommended SIM TTLs:

| Data | TTL | Stale-if-error | Notes |
| --- | ---: | ---: | --- |
| ČHMÚ weather stations | 600 s | 3600 s | Point observations |
| Weather grids | 600 s | 3600 s | Precomputed from stations/model |
| Wind field | 600 s | 3600 s | Must use stable grid/tile alignment |
| Air quality stations | 900 s | 7200 s | Point observations |
| Air quality grid | 900 s | 7200 s | Interpolated/read-model |
| Admin boundaries | 86400 s | 604800 s | Static/reference |
| Place labels | 86400 s | 604800 s | Static/reference |

Every response should include:

- `generatedAt`
- `validAt` or `observedAt`
- `expiresAt`
- `stale`
- `warnings[]`
- cache headers where practical

## Observability

Extend provider observability with environment and basemap sections:

```json
{
  "environmentGrid": {
    "status": "ok",
    "generatedAt": "2026-05-29T10:00:00.000Z",
    "generatedAgeSeconds": 42,
    "gridResolutionM": 1000,
    "tileCount": 1240,
    "cellCount": 185000,
    "sourceCount": 72,
    "cache": {
      "entries": 210,
      "hits": 940,
      "misses": 31,
      "hitRate": 0.968,
      "staleHits": 2,
      "errors": 0
    },
    "warnings": []
  },
  "boundaryReadModel": {
    "status": "ok",
    "levels": ["country", "region", "district", "orp"],
    "featureCount": 230,
    "generalized": true,
    "sourceRevision": "ruian-2026-05|generalized-v1"
  }
}
```

COP will use this server-side for provider health panels. It is not a public map layer.

## Degraded Behavior

SIM should fail per layer, not per whole provider:

- missing wind grid should not hide weather stations,
- stale air quality grid should still return stale features with warnings,
- failed boundary read model should not break safety alerts,
- upstream warnings should be returned as provider warnings, not as HTTP 500 unless the contract itself cannot be served.

Use HTTP 200 with `status=degraded` and per-layer warnings when partial data is usable. Use HTTP 503 only when no usable provider contract can be returned.

## COP Rendering Expectations

COP will use these data as follows:

- heat map layers use `value`, metric fields and catalog legend stops,
- animated wind uses `uMps`/`vMps` or `windSpeedMps`/`windDirectionDeg`,
- low-power Safari/iOS mode may use static raster tiles instead of particle animation,
- simplified map mode uses boundary and place layers as a clean civil basemap,
- point station layers remain clickable detail/provenance layers,
- stale/degraded features are rendered with lower opacity and a warning in detail,
- localized label fields are selected according to user profile language.

## Acceptance Criteria For SIM

1. Public provider endpoints remain blocked; internal `docker.home.cz:5020` endpoints work for COP.
2. `/situation-data/api/v1/catalog` exposes the environmental grid and boundary layers with stable `layerId`, `providerLayerId`, `kind`, `styleProfile`, `cacheTtlSeconds`, legend and query metadata.
3. Weather and air quality grids are aligned to a stable grid or tile system and do not shift colors on small pan/zoom.
4. Wind field provides `uMps` and `vMps` or equivalent speed/direction values suitable for COP particle animation.
5. Boundary layers provide at least country and Czech kraj boundaries, preferably district and ORP as separate selectable layers.
6. Czech and English labels/summaries are available where provider generates user-facing text.
7. Observability reports cache hit-rate, generated age, source freshness and degraded warnings for grid/boundary read models.
8. Responses include provenance: `sourceId`, `basis`, `sourceRevision`, `dataQuality`, `confidence`, `observedAt`/`validAt`, `stale`.
9. Typecheck, tests, build and OpenAPI/catalog documentation are updated.

## Suggested Implementation Phases

### Phase 1: Boundaries And Localization

- Add level-specific boundary layers.
- Add localized labels and summaries to catalog/features.
- Add observability for boundary read model.

### Phase 2: Static Environmental Grids

- Add temperature and air quality grid read models.
- Add stable legends and cache metadata.
- Provide either raw grid endpoint or raster tiles.

### Phase 3: Animated Wind

- Add wind vector field with stable grid/tile alignment.
- Include `uMps`/`vMps` and confidence.
- Add low-power static fallback metadata.

### Phase 4: Extended Weather Overlays

- Add precipitation, humidity and pressure grids.
- Add time dimension when SIM has reliable forecast/nowcast data.
- Add history/replay only after cache/storage policy is explicit.
