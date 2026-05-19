import React from "react";
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CopLayer, CopObject } from "./cop-data";
import type { UserLocation } from "./proximity-alerts";
import { predictPosition, type PredictionMethod, type PredictionMode, type TrackHistory } from "./track-history";
import type { MapViewState } from "./user-preferences";
import {
  createNatoSymbolSvg,
  getAffiliationPresentation,
  getNatoIconKey,
  resolveCopObjectSymbol,
  type AffiliationDisposition
} from "./symbology";

const trackSourceId = "cop-live-tracks";
const trackHistorySourceId = "cop-track-history";
const trackPredictionSourceId = "cop-track-prediction";
const userLocationSourceId = "cop-user-location";
const userAlertRadiusSourceId = "cop-user-alert-radius";
const trackHistoryLayerId = "cop-track-history-line";
const trackPredictionLayerId = "cop-track-prediction-line";
const userAlertRadiusFillLayerId = "cop-user-alert-radius-fill";
const userAlertRadiusLineLayerId = "cop-user-alert-radius-line";
const userLocationAccuracyLayerId = "cop-user-location-accuracy";
const userLocationLayerId = "cop-user-location-point";
const trackSelectedHaloLayerId = "cop-live-track-selected-halo";
const trackSymbolLayerId = "cop-live-track-symbol";
const trackLabelLayerId = "cop-live-track-label";

const tileUrl = import.meta.env.VITE_COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_COP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
const defaultCenter = parseMapCenter(import.meta.env.VITE_COP_MAP_CENTER);
const defaultZoom = parseFiniteNumber(import.meta.env.VITE_COP_MAP_ZOOM, 8);
const earthRadiusKm = 6371.0088;

export interface TrackFeatureProperties {
  objectId: string;
  objectType: string;
  affiliation: string;
  confidence: number;
  status: string;
  synthetic: boolean;
  selected: boolean;
  symbolCode: string;
  symbolKey: string;
  label: string;
  symbolColor: string;
  symbolDisposition: AffiliationDisposition;
}

export interface TrackFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: TrackFeatureProperties;
}

export interface TrackFeatureCollection {
  type: "FeatureCollection";
  features: TrackFeature[];
}

export interface TrackLineFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
  properties: {
    objectId: string;
    color: string;
    selected: boolean;
    method?: PredictionMethod;
  };
}

export interface TrackLineFeatureCollection {
  type: "FeatureCollection";
  features: TrackLineFeature[];
}

interface CopMapProps {
  objects: CopObject[];
  emptyMessage: string;
  selectedLayer: CopLayer;
  selectedObjectId?: string;
  showHistory: boolean;
  showPrediction: boolean;
  trackHistory: TrackHistory;
  predictionMinutes: number;
  predictionMode: PredictionMode;
  autoFit: boolean;
  alertRadiusKm: number;
  focusView?: MapViewState;
  focusViewRequest: number;
  focusUserLocationRequest: number;
  hasProximityAlerts: boolean;
  initialView?: MapViewState;
  onSelectObject: (object: CopObject) => void;
  onAutoFitChange: (value: boolean) => void;
  onRequestUserLocation: () => void;
  onViewChange: (view: MapViewState) => void;
  showProximityAlertRadius: boolean;
  userLocation: UserLocation | null;
}

export function CopMap({
  objects,
  emptyMessage,
  selectedLayer,
  selectedObjectId,
  showHistory,
  showPrediction,
  trackHistory,
  predictionMinutes,
  predictionMode,
  autoFit,
  alertRadiusKm,
  focusView,
  focusViewRequest,
  focusUserLocationRequest,
  hasProximityAlerts,
  initialView,
  onSelectObject,
  onAutoFitChange,
  onRequestUserLocation,
  onViewChange,
  showProximityAlertRadius,
  userLocation
}: CopMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const objectsRef = React.useRef(objects);
  const onSelectObjectRef = React.useRef(onSelectObject);
  const onAutoFitChangeRef = React.useRef(onAutoFitChange);
  const onViewChangeRef = React.useRef(onViewChange);
  const lastFitSignatureRef = React.useRef("");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);

  const selectedId = selectedObjectId ?? objects[0]?.objectId;
  const positionedObjects = React.useMemo(() => objects.filter(hasPosition), [objects]);
  const featureCollection = React.useMemo(
    () => objectsToTrackFeatureCollection(objects, selectedId),
    [objects, selectedId]
  );
  const historyFeatureCollection = React.useMemo(
    () => (showHistory ? objectsToHistoryFeatureCollection(objects, trackHistory, selectedId) : emptyLineFeatureCollection()),
    [objects, selectedId, showHistory, trackHistory]
  );
  const predictionFeatureCollection = React.useMemo(
    () =>
      showPrediction
        ? objectsToPredictionFeatureCollection(objects, trackHistory, selectedId, predictionMinutes, predictionMode)
        : emptyLineFeatureCollection(),
    [objects, predictionMinutes, predictionMode, selectedId, showPrediction, trackHistory]
  );
  const userAlertRadiusFeatureCollection = React.useMemo(
    () => userAlertRadiusToFeatureCollection(userLocation, alertRadiusKm, showProximityAlertRadius, hasProximityAlerts),
    [alertRadiusKm, hasProximityAlerts, showProximityAlertRadius, userLocation]
  );

  objectsRef.current = objects;
  onSelectObjectRef.current = onSelectObject;
  onAutoFitChangeRef.current = onAutoFitChange;
  onViewChangeRef.current = onViewChange;

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createRasterStyle(tileUrl, tileAttribution),
      center: initialView?.center ?? defaultCenter,
      zoom: initialView?.zoom ?? defaultZoom,
      bearing: initialView?.bearing ?? 0,
      pitch: initialView?.pitch ?? 0,
      attributionControl: false
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const handleClick = (event: MapLayerMouseEvent) => {
      const objectId = event.features?.[0]?.properties?.objectId as string | undefined;
      const object = objectsRef.current.find((candidate) => candidate.objectId === objectId);
      if (object) {
        onSelectObjectRef.current(object);
      }
    };

    map.on("load", () => {
      void (async () => {
        map.addSource(trackSourceId, {
          type: "geojson",
          data: objectsToTrackFeatureCollection(objectsRef.current, objectsRef.current[0]?.objectId) as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(trackHistorySourceId, {
          type: "geojson",
          data: emptyLineFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(trackPredictionSourceId, {
          type: "geojson",
          data: emptyLineFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(userLocationSourceId, {
          type: "geojson",
          data: userLocationToFeatureCollection(null) as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(userAlertRadiusSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        await registerNatoSymbolImages(map);
        if (mapRef.current !== map) {
          return;
        }

        map.addLayer({
          id: userAlertRadiusFillLayerId,
          type: "fill",
          source: userAlertRadiusSourceId,
          paint: {
            "fill-color": ["case", ["get", "active"], "#ef4444", "#facc15"],
            "fill-opacity": ["case", ["get", "active"], 0.13, 0.08]
          }
        });

        map.addLayer({
          id: userAlertRadiusLineLayerId,
          type: "line",
          source: userAlertRadiusSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["case", ["get", "active"], "#ef4444", "#facc15"],
            "line-dasharray": [2, 1.4],
            "line-opacity": ["case", ["get", "active"], 0.72, 0.48],
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.1, 12, 1.8, 16, 2.4]
          }
        });

        map.addLayer({
          id: trackHistoryLayerId,
          type: "line",
          source: trackHistorySourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["get", "color"],
            "line-opacity": 0.66,
            "line-width": ["case", ["get", "selected"], 3, 2]
          }
        });

        map.addLayer({
          id: trackPredictionLayerId,
          type: "line",
          source: trackPredictionSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["get", "color"],
            "line-dasharray": [1.2, 1.15],
            "line-opacity": 0.68,
            "line-width": ["case", ["get", "selected"], 3.1, 2.1]
          }
        });

        map.addLayer({
          id: userLocationAccuracyLayerId,
          type: "circle",
          source: userLocationSourceId,
          paint: {
            "circle-color": "#8cb6d8",
            "circle-opacity": 0.14,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 8, 12, 24, 16, 46],
            "circle-stroke-color": "#dff8ff",
            "circle-stroke-opacity": 0.46,
            "circle-stroke-width": 1
          }
        });

        map.addLayer({
          id: userLocationLayerId,
          type: "circle",
          source: userLocationSourceId,
          paint: {
            "circle-color": "#8cb6d8",
            "circle-radius": 6,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: trackSelectedHaloLayerId,
          type: "circle",
          source: trackSourceId,
          filter: ["==", ["get", "selected"], true],
          paint: {
            "circle-color": ["get", "symbolColor"],
            "circle-opacity": 0.16,
            "circle-radius": 18,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.86,
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: trackSymbolLayerId,
          type: "symbol",
          source: trackSourceId,
          layout: {
            "icon-image": ["get", "symbolKey"],
            "icon-size": 0.46,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          }
        });

        map.addLayer({
          id: trackLabelLayerId,
          type: "symbol",
          source: trackSourceId,
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold"],
            "text-size": 11,
            "text-offset": [0, 1.45],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "text-color": ["get", "symbolColor"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.7,
            "text-halo-blur": 0.4
          }
        });

        map.on("click", trackSymbolLayerId, handleClick);
        map.on("click", trackLabelLayerId, handleClick);
        map.on("dragstart", (event) => {
          if (event.originalEvent) {
            onAutoFitChangeRef.current(false);
          }
        });
        map.on("zoomstart", (event) => {
          if (event.originalEvent) {
            onAutoFitChangeRef.current(false);
          }
        });
        map.on("rotatestart", (event) => {
          if (event.originalEvent) {
            onAutoFitChangeRef.current(false);
          }
        });
        map.on("moveend", () => {
          const center = map.getCenter();
          onViewChangeRef.current({
            center: [roundCoordinate(center.lng), roundCoordinate(center.lat)],
            zoom: roundZoom(map.getZoom()),
            bearing: roundZoom(map.getBearing()),
            pitch: roundZoom(map.getPitch())
          });
        });
        map.on("mouseenter", trackSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", trackLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", trackSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        setMapReady(true);
      })().catch((error: unknown) => {
        setMapError(error instanceof Error ? error.message : "NATO symboly nejsou dostupné.");
      });
    });
    map.on("error", (event) => {
      setMapError(event.error?.message ?? "Mapový podklad není dostupný.");
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(userLocationSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(userLocationToFeatureCollection(userLocation) as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, userLocation]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(userAlertRadiusSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(userAlertRadiusFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, userAlertRadiusFeatureCollection]);

  React.useEffect(() => {
    if (!mapReady || !userLocation || focusUserLocationRequest === 0) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.easeTo({
      center: [userLocation.lon, userLocation.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 650
    });
  }, [focusUserLocationRequest, mapReady, userLocation]);

  React.useEffect(() => {
    if (!mapReady || !focusView || focusViewRequest === 0) {
      return;
    }
    mapRef.current?.easeTo({
      bearing: focusView.bearing ?? 0,
      center: focusView.center,
      duration: 650,
      pitch: focusView.pitch ?? 0,
      zoom: focusView.zoom
    });
  }, [focusView, focusViewRequest, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(trackSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(featureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [featureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(trackHistorySourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(historyFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [historyFeatureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(trackPredictionSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(predictionFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, predictionFeatureCollection]);

  React.useEffect(() => {
    if (!mapReady || !autoFit || positionedObjects.length === 0) {
      return;
    }

    const signature = positionedObjects
      .map((object) => object.objectId)
      .sort()
      .join("|");
    if (lastFitSignatureRef.current === signature) {
      return;
    }

    fitMapToObjects(mapRef.current, positionedObjects);
    lastFitSignatureRef.current = signature;
  }, [autoFit, mapReady, positionedObjects]);

  const missingPositionCount = objects.length - positionedObjects.length;

  return (
    <div className="map-container">
      <div className="map-canvas" ref={containerRef} aria-label="COP georeferenced map" />
      <div className="map-toolbar">
        <div>
          <span>Map layer</span>
          <strong>{selectedLayer}</strong>
        </div>
        <button
          className={`map-action ${autoFit ? "active" : ""}`}
          onClick={() => {
            onAutoFitChange(!autoFit);
            if (!autoFit) {
              fitMapToObjects(mapRef.current, positionedObjects);
            }
          }}
          type="button"
        >
          Auto fit
        </button>
        <button className="map-action" onClick={() => fitMapToObjects(mapRef.current, positionedObjects)} type="button">
          Fit tracks
        </button>
        <button className="map-action" onClick={onRequestUserLocation} type="button">
          Moje poloha
        </button>
      </div>
      <div className="map-legend">
        <LegendItem disposition="friend" color="#3b82f6" label="Vlastní" />
        <LegendItem disposition="hostile" color="#ef4444" label="Cizí" />
        <LegendItem disposition="neutral" color="#22c55e" label="Neutrální" />
        <LegendItem disposition="unknown" color="#facc15" label="Neznámé" />
        {showHistory ? <LineLegendItem label="Historie" /> : null}
        {showPrediction ? <LineLegendItem dashed label="Predikce" /> : null}
        {showProximityAlertRadius && userLocation ? <RadiusLegendItem active={hasProximityAlerts} label="Výstražný perimetr" /> : null}
      </div>
      {missingPositionCount > 0 ? <div className="map-notice">{missingPositionCount} objektů bez polohy není v mapě.</div> : null}
      {mapError ? <div className="map-notice error">Mapový podklad: {mapError}</div> : null}
      {objects.length === 0 ? <div className="map-empty">{emptyMessage}</div> : null}
    </div>
  );
}

export function objectsToTrackFeatureCollection(objects: CopObject[], selectedObjectId?: string): TrackFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.filter(hasPosition).map((object) => {
      const symbol = resolveCopObjectSymbol(object);
      const affiliation = getAffiliationPresentation(object.affiliation);
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [object.position!.lon, object.position!.lat]
        },
        properties: {
          objectId: object.objectId,
          objectType: object.objectType,
          affiliation: object.affiliation,
          confidence: object.confidence ?? 0,
          status: object.status,
          synthetic: Boolean(object.synthetic),
          selected: object.objectId === selectedObjectId,
          symbolCode: symbol.symbolCode,
          symbolKey: getNatoIconKey(object.objectType, object.affiliation),
          label: object.objectId,
          symbolColor: affiliation.color,
          symbolDisposition: affiliation.disposition
        }
      };
    })
  };
}

export function objectsToHistoryFeatureCollection(
  objects: CopObject[],
  trackHistory: TrackHistory,
  selectedObjectId?: string
): TrackLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.flatMap((object) => {
      const points = trackHistory[object.objectId] ?? [];
      if (points.length < 2) {
        return [];
      }
      const affiliation = getAffiliationPresentation(object.affiliation);
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: points.map((point) => [point.lon, point.lat] as [number, number])
          },
          properties: {
            objectId: object.objectId,
            color: affiliation.color,
            selected: object.objectId === selectedObjectId
          }
        }
      ];
    })
  };
}

export function objectsToPredictionFeatureCollection(
  objects: CopObject[],
  trackHistory: TrackHistory,
  selectedObjectId: string | undefined,
  predictionMinutes: number,
  predictionMode: PredictionMode = "adaptive"
): TrackLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.flatMap((object) => {
      if (!hasPosition(object)) {
        return [];
      }
      const prediction = predictPosition(object, trackHistory[object.objectId], predictionMinutes, predictionMode);
      if (!prediction) {
        return [];
      }
      const affiliation = getAffiliationPresentation(object.affiliation);
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: prediction.path.map((point) => [point.lon, point.lat] as [number, number])
          },
          properties: {
            objectId: object.objectId,
            color: affiliation.color,
            selected: object.objectId === selectedObjectId,
            method: prediction.method
          }
        }
      ];
    })
  };
}

export function userLocationToFeatureCollection(userLocation: UserLocation | null): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { accuracyM: number };
  }>;
} {
  return {
    type: "FeatureCollection",
    features: userLocation
      ? [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [userLocation.lon, userLocation.lat]
            },
            properties: {
              accuracyM: userLocation.accuracyM ?? 0
            }
          }
        ]
      : []
  };
}

export function userAlertRadiusToFeatureCollection(
  userLocation: UserLocation | null,
  radiusKm: number,
  visible: boolean,
  active = false
): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { radiusKm: number; active: boolean };
  }>;
} {
  if (!visible || !userLocation || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return emptyPolygonFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [buildGeodesicCircle(userLocation, radiusKm)]
        },
        properties: {
          radiusKm,
          active
        }
      }
    ]
  };
}

function emptyLineFeatureCollection(): TrackLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function emptyPolygonFeatureCollection() {
  return {
    type: "FeatureCollection" as const,
    features: []
  };
}

function buildGeodesicCircle(userLocation: UserLocation, radiusKm: number, segments = 96): Array<[number, number]> {
  const lat = degreesToRadians(userLocation.lat);
  const lon = degreesToRadians(userLocation.lon);
  const angularDistance = radiusKm / earthRadiusKm;
  const coordinates: Array<[number, number]> = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (index / segments) * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) + Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
        Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat)
      );

    coordinates.push([normalizeLongitude(radiansToDegrees(pointLon)), radiansToDegrees(pointLat)]);
  }

  coordinates.push(coordinates[0]!);
  return coordinates;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function parseMapCenter(value: string | undefined): [number, number] {
  if (!value) {
    return [14.42, 50.08];
  }

  const [lonRaw, latRaw] = value.split(",");
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return [14.42, 50.08];
  }
  return [lon, lat];
}

function createRasterStyle(tiles: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: [tiles],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution
      }
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm-raster"
      }
    ]
  };
}

function fitMapToObjects(map: maplibregl.Map | null, objects: CopObject[]) {
  const positionedObjects = objects.filter(hasPosition);
  if (!map || positionedObjects.length === 0) {
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  positionedObjects.forEach((object) => {
    bounds.extend([object.position!.lon, object.position!.lat]);
  });

  if (positionedObjects.length === 1) {
    map.easeTo({
      center: [positionedObjects[0]!.position!.lon, positionedObjects[0]!.position!.lat],
      zoom: Math.max(map.getZoom(), 10),
      duration: 650
    });
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: 86, right: 72, bottom: 72, left: 72 },
    maxZoom: 12,
    duration: 750
  });
}

function hasPosition(object: CopObject): object is CopObject & { position: NonNullable<CopObject["position"]> } {
  return Number.isFinite(object.position?.lat) && Number.isFinite(object.position?.lon);
}

function parseFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

async function registerNatoSymbolImages(map: maplibregl.Map) {
  const objectTypes = ["AIRCRAFT", "UAV", "MISSILE_TRACK", "GROUND_UNIT", "RESCUE_ASSET", "INCIDENT", "REPORT", "UNKNOWN"];
  const affiliations = ["FRIEND", "ASSUMED_FRIEND", "HOSTILE", "SUSPECT", "NEUTRAL", "UNKNOWN", "PENDING"];

  const registrations = new Map<string, { objectType: string; affiliation: string }>();
  objectTypes.forEach((objectType) => {
    affiliations.forEach((affiliation) => {
      registrations.set(getNatoIconKey(objectType, affiliation), { objectType, affiliation });
    });
  });

  await Promise.all(
    Array.from(registrations.entries()).map(async ([key, registration]) => {
      if (!map.hasImage(key)) {
        map.addImage(key, await createNatoSymbolImage(registration.objectType, registration.affiliation), {
          pixelRatio: window.devicePixelRatio || 1
        });
      }
    })
  );
}

async function createNatoSymbolImage(objectType: string, affiliation: string): Promise<ImageData> {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  const image = await loadSvgImage(createNatoSymbolSvg(objectType, affiliation));
  const scale = Math.min(82 / image.width, 82 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

  return context.getImageData(0, 0, size, size);
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("NATO symbol SVG se nepodařilo načíst."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function LegendItem({ color, disposition, label }: { color: string; disposition: AffiliationDisposition; label: string }) {
  return (
    <div className="legend-item">
      <span className={`legend-symbol ${disposition}`} style={{ borderColor: color }} />
      {label}
    </div>
  );
}

function LineLegendItem({ dashed = false, label }: { dashed?: boolean; label: string }) {
  return (
    <div className="legend-item">
      <span className={`legend-line ${dashed ? "dashed" : ""}`} />
      {label}
    </div>
  );
}

function RadiusLegendItem({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="legend-item">
      <span
        className="legend-radius"
        style={{
          background: active ? "rgba(239, 68, 68, 0.16)" : "rgba(250, 204, 21, 0.13)",
          borderColor: active ? "#ef4444" : "#facc15"
        }}
      />
      {label}
    </div>
  );
}
