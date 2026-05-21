import React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AoiRule, CopAlert, CopObject, MapBounds, SituationFeature, SituationFeatureCollectionResponse } from "./cop-data";
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
const trackClusterSourceId = "cop-live-track-clusters";
const trackHistorySourceId = "cop-track-history";
const trackPredictionSourceId = "cop-track-prediction";
const userLocationSourceId = "cop-user-location";
const userAlertRadiusSourceId = "cop-user-alert-radius";
const aoiRuleSourceId = "cop-aoi-rules";
const alertAreaSourceId = "cop-alert-areas";
const situationSourceId = "cop-situation-context";
const trackHistoryLayerId = "cop-track-history-line";
const trackPredictionLayerId = "cop-track-prediction-line";
const userAlertRadiusFillLayerId = "cop-user-alert-radius-fill";
const userAlertRadiusLineLayerId = "cop-user-alert-radius-line";
const aoiRuleFillLayerId = "cop-aoi-rule-fill";
const aoiRuleLineLayerId = "cop-aoi-rule-line";
const alertAreaFillLayerId = "cop-alert-area-fill";
const alertAreaLineLayerId = "cop-alert-area-line";
const situationFillLayerId = "cop-situation-fill";
const situationLineLayerId = "cop-situation-line";
const situationPointSelectedLayerId = "cop-situation-point-selected";
const situationWeatherPointLayerId = "cop-situation-weather-point";
const situationWeatherLabelLayerId = "cop-situation-weather-label";
const situationOsmSymbolLayerId = "cop-situation-osm-symbol";
const situationMobileSymbolLayerId = "cop-situation-mobile-symbol";
const situationPointLayerId = "cop-situation-point";
const situationLabelLayerId = "cop-situation-label";
const userLocationAccuracyLayerId = "cop-user-location-accuracy";
const userLocationLayerId = "cop-user-location-point";
const trackSelectedHaloLayerId = "cop-live-track-selected-halo";
const trackSymbolLayerId = "cop-live-track-symbol";
const trackLabelLayerId = "cop-live-track-label";
const trackClusterCircleLayerId = "cop-live-track-cluster-circle";
const trackClusterCountLayerId = "cop-live-track-cluster-count";
const trackClusterSelectedHaloLayerId = "cop-live-track-cluster-selected-halo";
const trackClusterSymbolLayerId = "cop-live-track-cluster-symbol";
const trackClusterLabelLayerId = "cop-live-track-cluster-label";

const tileUrl = import.meta.env.VITE_COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_COP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
const defaultCenter = parseMapCenter(import.meta.env.VITE_COP_MAP_CENTER);
const defaultZoom = parseFiniteNumber(import.meta.env.VITE_COP_MAP_ZOOM, 8);
const earthRadiusKm = 6371.0088;
const mobileNetworkIconPrefix = "cop-mobile-network";
const mobileNetworkIconTones = ["info", "advisory", "warning", "critical", "unknown"] as const;
type MobileNetworkIconTone = (typeof mobileNetworkIconTones)[number];
const osmCategoryIconPrefix = "cop-osm-category";
const osmCategoryIconIds = ["hospital", "fire_station", "police", "pharmacy", "shelter", "townhall", "communications_tower", "other"] as const;
type OsmCategoryIconId = (typeof osmCategoryIconIds)[number];

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

export interface AlertAreaFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { alertId: string; severity: CopAlert["severity"]; type: CopAlert["type"] };
  }>;
}

export interface AoiRuleFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { color: string; enabled: boolean; fillOpacity: number; id: string; name: string; severity: NonNullable<AoiRule["severity"]> };
  }>;
}

export interface SituationContextFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: SituationFeature["geometry"];
    properties: SituationFeature["properties"] & {
      selected: boolean;
      weatherCloudCoverPercent?: number;
      weatherFlightCategoryColor?: string;
      weatherLabel?: string;
      weatherPrecipitationMm?: number;
      weatherStationIcao?: string;
      weatherTemperatureC?: number;
      weatherWindDirectionDeg?: number;
      weatherWindSpeedMps?: number;
      situationStatusColor?: string;
      situationStatusLabel?: string;
      situationStatusTone?: string;
      takGateway?: boolean;
      mobileNetworkLabel?: string;
      mobileSymbolKey?: string;
      osmCategoryLabel?: string;
      osmPoi?: boolean;
      osmSymbolKey?: string;
    };
  }>;
}

interface CopMapProps {
  alerts: CopAlert[];
  aoiRules: AoiRule[];
  clusterTracks: boolean;
  objects: CopObject[];
  emptyMessage: string;
  hasSituationContextEnabled: boolean;
  mapLayerLabel: string;
  selectedSituationFeatureId?: string;
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
  situationFeatures: SituationFeatureCollectionResponse | null;
  onBoundsChange: (bounds: MapBounds) => void;
  onSelectObject: (object: CopObject) => void;
  onSelectSituationFeature: (feature: SituationFeature) => void;
  onAutoFitChange: (value: boolean) => void;
  onRequestUserLocation: () => void;
  onViewChange: (view: MapViewState) => void;
  showAlertAreas: boolean;
  showProximityAlertRadius: boolean;
  zoneCreationActive?: boolean;
  onCreateZoneAt?: (center: { lat: number; lon: number }) => void;
  userLocation: UserLocation | null;
}

interface ClusterInfo {
  center: [number, number];
  count: number;
  leaves: Array<{
    affiliation: string;
    label: string;
    objectType: string;
    status: string;
  }>;
  zoom: number;
}

export function CopMap({
  alerts,
  aoiRules,
  clusterTracks,
  objects,
  emptyMessage,
  hasSituationContextEnabled,
  mapLayerLabel,
  selectedSituationFeatureId,
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
  situationFeatures,
  onBoundsChange,
  onSelectObject,
  onSelectSituationFeature,
  onAutoFitChange,
  onCreateZoneAt,
  onRequestUserLocation,
  onViewChange,
  showAlertAreas,
  showProximityAlertRadius,
  userLocation,
  zoneCreationActive = false
}: CopMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const objectsRef = React.useRef(objects);
  const situationFeaturesRef = React.useRef<SituationFeature[]>([]);
  const onBoundsChangeRef = React.useRef(onBoundsChange);
  const onSelectObjectRef = React.useRef(onSelectObject);
  const onSelectSituationFeatureRef = React.useRef(onSelectSituationFeature);
  const onAutoFitChangeRef = React.useRef(onAutoFitChange);
  const onCreateZoneAtRef = React.useRef(onCreateZoneAt);
  const onViewChangeRef = React.useRef(onViewChange);
  const zoneCreationActiveRef = React.useRef(zoneCreationActive);
  const lastFitSignatureRef = React.useRef("");
  const handledFocusViewRequestRef = React.useRef(0);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [clusterInfo, setClusterInfo] = React.useState<ClusterInfo | null>(null);
  const [mapFullscreen, setMapFullscreen] = React.useState(false);

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
  const aoiRuleFeatureCollection = React.useMemo(() => aoiRulesToFeatureCollection(aoiRules), [aoiRules]);
  const alertAreaFeatureCollection = React.useMemo(
    () => (showAlertAreas ? alertAreasToFeatureCollection(alerts) : emptyPolygonFeatureCollection()),
    [alerts, showAlertAreas]
  );
  const situationFeatureCollection = React.useMemo(
    () => situationFeaturesToFeatureCollection(situationFeatures, selectedSituationFeatureId),
    [selectedSituationFeatureId, situationFeatures]
  );

  objectsRef.current = objects;
  situationFeaturesRef.current = situationFeatures?.features ?? [];
  onBoundsChangeRef.current = onBoundsChange;
  onSelectObjectRef.current = onSelectObject;
  onSelectSituationFeatureRef.current = onSelectSituationFeature;
  onAutoFitChangeRef.current = onAutoFitChange;
  onCreateZoneAtRef.current = onCreateZoneAt;
  onViewChangeRef.current = onViewChange;
  zoneCreationActiveRef.current = zoneCreationActive;

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
    enableMapInteractions(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const handleClick = (event: MapLayerMouseEvent) => {
      const objectId = event.features?.[0]?.properties?.objectId as string | undefined;
      const object = objectsRef.current.find((candidate) => candidate.objectId === objectId);
      if (object) {
        onSelectObjectRef.current(object);
      }
    };

    const handleSituationClick = (event: MapLayerMouseEvent) => {
      const featureId = event.features?.[0]?.properties?.featureId as string | undefined;
      const feature = situationFeaturesRef.current.find((candidate) => candidate.properties.featureId === featureId);
      if (feature) {
        onSelectSituationFeatureRef.current(feature);
      }
    };

    map.on("load", () => {
      void (async () => {
        map.addSource(trackSourceId, {
          type: "geojson",
          data: objectsToTrackFeatureCollection(objectsRef.current, objectsRef.current[0]?.objectId) as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(trackClusterSourceId, {
          type: "geojson",
          data: objectsToTrackFeatureCollection(objectsRef.current, objectsRef.current[0]?.objectId) as Parameters<GeoJSONSource["setData"]>[0],
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 52
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
        map.addSource(aoiRuleSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(alertAreaSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(situationSourceId, {
          type: "geojson",
          data: emptySituationContextFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        await registerNatoSymbolImages(map);
        await registerSituationSymbolImages(map);
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
          id: aoiRuleFillLayerId,
          type: "fill",
          source: aoiRuleSourceId,
          paint: {
            "fill-color": ["coalesce", ["get", "color"], ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#38bdf8"]],
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.08]
          }
        });

        map.addLayer({
          id: aoiRuleLineLayerId,
          type: "line",
          source: aoiRuleSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["coalesce", ["get", "color"], ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#38bdf8"]],
            "line-dasharray": [3, 2],
            "line-opacity": 0.58,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 1.7, 16, 2.3]
          }
        });

        map.addLayer({
          id: alertAreaFillLayerId,
          type: "fill",
          source: alertAreaSourceId,
          paint: {
            "fill-color": ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#8cb6d8"],
            "fill-opacity": ["match", ["get", "severity"], "critical", 0.15, "warning", 0.1, 0.08]
          }
        });

        map.addLayer({
          id: alertAreaLineLayerId,
          type: "line",
          source: alertAreaSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#8cb6d8"],
            "line-dasharray": [1.5, 1.1],
            "line-opacity": 0.72,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 1.8, 16, 2.6]
          }
        });

        map.addLayer({
          id: situationFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": [
              "coalesce",
              ["get", "situationStatusColor"],
              [
                "match",
                ["get", "layer"],
                "weather",
                "#38bdf8",
                "ground",
                "#22c55e",
                "mobile",
                "#a78bfa",
                "traffic",
                "#facc15",
                "warnings",
                "#ef4444",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
              ]
            ],
            "fill-opacity": ["case", ["get", "stale"], 0.06, 0.1]
          }
        });

        map.addLayer({
          id: situationLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": [
              "coalesce",
              ["get", "situationStatusColor"],
              [
                "match",
                ["get", "layer"],
                "weather",
                "#38bdf8",
                "ground",
                "#22c55e",
                "mobile",
                "#a78bfa",
                "traffic",
                "#facc15",
                "warnings",
                "#ef4444",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
              ]
            ],
            "line-dasharray": ["case", ["get", "stale"], ["literal", [2, 1.2]], ["literal", [1, 0]]],
            "line-opacity": ["case", ["get", "stale"], 0.48, 0.76],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.1, 12, 1.8, 16, 2.6]
          }
        });

        map.addLayer({
          id: situationPointSelectedLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "selected"], true]],
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "situationStatusColor"],
              [
                "match",
                ["get", "layer"],
                "weather",
                "#38bdf8",
                "ground",
                "#22c55e",
                "traffic",
                "#facc15",
                "warnings",
                "#ef4444",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
              ]
            ],
            "circle-opacity": 0.18,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 14, 12, 22, 16, 30],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.86,
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: situationPointLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "layer"], "weather"], ["!=", ["get", "osmPoi"], true], ["any", ["!=", ["get", "layer"], "mobile"], ["==", ["get", "takGateway"], true]]],
          paint: {
            "circle-color": [
              "case",
              ["get", "stale"],
              "#facc15",
              [
                "coalesce",
                ["get", "situationStatusColor"],
                [
                "match",
                ["get", "layer"],
                "ground",
                "#22c55e",
                "traffic",
                "#facc15",
                "warnings",
                "#ef4444",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
                ]
              ]
            ],
            "circle-opacity": ["case", ["get", "stale"], 0.52, 0.88],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 5, 12, 7, 16, 10],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": ["case", ["get", "stale"], 1, 1.6]
          }
        });

        map.addLayer({
          id: situationOsmSymbolLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "osmPoi"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "osmSymbolKey"], getOsmCategoryIconKey("other")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.26, 11, 0.34, 15, 0.48],
            "icon-anchor": "center",
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 0, 12, 0, 13, 10, 16, 12],
            "text-offset": [0, 1.35],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.68, 0.94],
            "text-color": ["case", ["get", "stale"], "#facc15", "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.4
          }
        });

        map.addLayer({
          id: situationLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "layer"], "weather"], ["!=", ["get", "osmPoi"], true], ["any", ["!=", ["get", "layer"], "mobile"], ["==", ["get", "takGateway"], true]]],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 0, 10, 10, 14, 12],
            "text-offset": [0, 1.25],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "text-color": ["case", ["get", "stale"], "#facc15", "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.4
          }
        });

        map.addLayer({
          id: situationMobileSymbolLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layer"], "mobile"], ["!=", ["get", "osmPoi"], true], ["!=", ["get", "takGateway"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "mobileSymbolKey"], getMobileNetworkIconKey("unknown")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.26, 11, 0.34, 15, 0.48],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["coalesce", ["get", "mobileNetworkLabel"], "MOBILE"],
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 9, 11, 11, 15, 13],
            "text-offset": [0, -2.2],
            "text-anchor": "bottom",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.74, 0.96],
            "text-color": ["coalesce", ["get", "situationStatusColor"], "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.7,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationWeatherPointLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layer"], "weather"]],
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "weatherFlightCategoryColor"],
              [
                "interpolate",
                ["linear"],
                ["coalesce", ["get", "weatherTemperatureC"], 12],
                -15,
                "#60a5fa",
                0,
                "#38bdf8",
                15,
                "#22c55e",
                25,
                "#facc15",
                35,
                "#ef4444"
              ]
            ],
            "circle-opacity": ["case", ["get", "stale"], 0.48, 0.74],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 10, 11, 18, 16, 30],
            "circle-stroke-color": ["case", [">", ["coalesce", ["get", "weatherPrecipitationMm"], 0], 0], "#dff8ff", "#061019"],
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "weatherCloudCoverPercent"], 0],
              0,
              1.2,
              100,
              3.2
            ]
          }
        });

        map.addLayer({
          id: situationWeatherLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layer"], "weather"]],
          layout: {
            "text-field": ["get", "weatherLabel"],
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 11, 12, 15, 14],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-offset": [0, 0],
            "text-anchor": "center"
          },
          paint: {
            "text-color": "#061019",
            "text-halo-color": "rgba(244, 247, 251, 0.88)",
            "text-halo-width": 1.3,
            "text-halo-blur": 0.2
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
          id: trackClusterCircleLayerId,
          type: "circle",
          source: trackClusterSourceId,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#8cb6d8", 8, "#facc15", 22, "#ef4444"],
            "circle-opacity": 0.88,
            "circle-radius": ["step", ["get", "point_count"], 18, 8, 24, 22, 30, 60, 36],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: trackClusterCountLayerId,
          type: "symbol",
          source: trackClusterSourceId,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Bold"],
            "text-size": ["step", ["get", "point_count"], 12, 8, 13, 22, 14],
            "text-allow-overlap": true,
            "text-ignore-placement": true
          },
          paint: {
            "text-color": "#061019",
            "text-halo-color": "#eef5fb",
            "text-halo-width": 0.65
          }
        });

        map.addLayer({
          id: trackClusterSelectedHaloLayerId,
          type: "circle",
          source: trackClusterSourceId,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "selected"], true]],
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
          id: trackClusterSymbolLayerId,
          type: "symbol",
          source: trackClusterSourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["get", "symbolKey"],
            "icon-size": 0.46,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          }
        });

        map.addLayer({
          id: trackClusterLabelLayerId,
          type: "symbol",
          source: trackClusterSourceId,
          filter: ["!", ["has", "point_count"]],
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

        setTrackClusterVisibility(map, clusterTracks);

        const handleClusterClick = (event: MapLayerMouseEvent) => {
          void zoomToCluster(map, event, setClusterInfo);
        };
        map.on("click", trackSymbolLayerId, handleClick);
        map.on("click", trackLabelLayerId, handleClick);
        map.on("click", trackClusterSymbolLayerId, handleClick);
        map.on("click", trackClusterLabelLayerId, handleClick);
        map.on("click", situationPointLayerId, handleSituationClick);
        map.on("click", situationLabelLayerId, handleSituationClick);
        map.on("click", situationMobileSymbolLayerId, handleSituationClick);
        map.on("click", situationWeatherPointLayerId, handleSituationClick);
        map.on("click", situationWeatherLabelLayerId, handleSituationClick);
        map.on("click", situationLineLayerId, handleSituationClick);
        map.on("click", situationFillLayerId, handleSituationClick);
        map.on("click", trackClusterCircleLayerId, handleClusterClick);
        map.on("click", trackClusterCountLayerId, handleClusterClick);
        const handleUserMapInteraction = (event: maplibregl.MapLibreEvent) => {
          if (event.originalEvent) {
            onAutoFitChangeRef.current(false);
          }
        };
        const handleMapClick = (event: maplibregl.MapMouseEvent) => {
          if (!zoneCreationActiveRef.current || !onCreateZoneAtRef.current) {
            return;
          }
          onCreateZoneAtRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
        };
        map.on("dragstart", handleUserMapInteraction);
        map.on("movestart", handleUserMapInteraction);
        map.on("pitchstart", handleUserMapInteraction);
        map.on("rotatestart", handleUserMapInteraction);
        map.on("zoomstart", handleUserMapInteraction);
        map.on("click", handleMapClick);
        map.on("moveend", () => emitMapViewport(map, onViewChangeRef, onBoundsChangeRef));
        map.on("mouseenter", trackSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", trackLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", trackClusterCircleLayerId, () => {
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", trackClusterCountLayerId, () => {
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", trackClusterSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", trackClusterLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationMobileSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationFillLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", trackSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterCircleLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterCountLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationMobileSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationFillLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        setMapReady(true);
        map.resize();
        emitMapViewport(map, onViewChangeRef, onBoundsChangeRef);
      })().catch((error: unknown) => {
        setMapError(error instanceof Error ? error.message : "NATO symboly nejsou dostupné.");
      });
    });
    map.on("error", (event) => {
      setMapError(event.error?.message ?? "Mapový podklad není dostupný.");
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!mapReady || !containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    resizeObserverRef.current.observe(containerRef.current);
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [mapReady]);

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
    const source = mapRef.current?.getSource(aoiRuleSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(aoiRuleFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [aoiRuleFeatureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(alertAreaSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(alertAreaFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [alertAreaFeatureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(situationSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(situationFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, situationFeatureCollection]);

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
    if (!mapReady || !focusView || focusViewRequest === 0 || handledFocusViewRequestRef.current === focusViewRequest) {
      return;
    }
    handledFocusViewRequestRef.current = focusViewRequest;
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
    const clusterSource = mapRef.current?.getSource(trackClusterSourceId);
    if (mapReady && clusterSource && "setData" in clusterSource) {
      (clusterSource as GeoJSONSource).setData(featureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [featureCollection, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    setTrackClusterVisibility(map, clusterTracks);
    if (!clusterTracks) {
      setClusterInfo(null);
    }
  }, [clusterTracks, mapReady]);

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

    const signature = buildFitSignature(positionedObjects);
    if (lastFitSignatureRef.current === signature) {
      return;
    }

    if (fitMapToObjects(mapRef.current, positionedObjects)) {
      lastFitSignatureRef.current = signature;
    }
  }, [autoFit, mapReady, positionedObjects]);

  React.useEffect(() => {
    if (!mapFullscreen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMapFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mapFullscreen]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [mapFullscreen]);

  const missingPositionCount = objects.length - positionedObjects.length;

  return (
    <div className={`map-container ${mapFullscreen ? "fullscreen" : ""}`}>
      <div className="map-canvas" ref={containerRef} aria-label="Georeferencovaná situační mapa" />
      {zoneCreationActive ? <div className="map-zone-create-hint">Kliknutím do mapy vytvoříte novou uživatelskou zónu</div> : null}
      <div
        className="map-toolbar"
        onClick={stopMapToolbarEvent}
        onDoubleClick={stopMapToolbarEvent}
        onPointerDown={stopMapToolbarEvent}
        onWheel={stopMapToolbarEvent}
      >
        <div>
          <span>Map layer</span>
          <strong>{mapLayerLabel}</strong>
        </div>
        <button
          className={`map-action ${autoFit ? "active" : ""}`}
          onClick={() => {
            const nextAutoFit = !autoFit;
            onAutoFitChange(nextAutoFit);
            if (nextAutoFit && fitMapToObjects(mapRef.current, positionedObjects)) {
              lastFitSignatureRef.current = buildFitSignature(positionedObjects);
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
        <button
          aria-pressed={mapFullscreen}
          className={`map-action icon-map-action ${mapFullscreen ? "active" : ""}`}
          onClick={() => setMapFullscreen((current) => !current)}
          title={mapFullscreen ? "Ukončit celou obrazovku" : "Zobrazit mapu přes celou obrazovku"}
          type="button"
        >
          {mapFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          <span>{mapFullscreen ? "Zmenšit" : "Celá mapa"}</span>
        </button>
      </div>
      <div className="map-legend">
        <LegendItem disposition="friend" color="#3b82f6" label="Vlastní" />
        <LegendItem disposition="hostile" color="#ef4444" label="Rizikové" />
        <LegendItem disposition="neutral" color="#22c55e" label="Neutrální" />
        <LegendItem disposition="unknown" color="#facc15" label="Neznámé" />
        {showHistory ? <LineLegendItem label="Historie" /> : null}
        {showPrediction ? <LineLegendItem dashed label="Predikce" /> : null}
        {showProximityAlertRadius && userLocation ? <RadiusLegendItem active={hasProximityAlerts} label="Výstražný perimetr" /> : null}
        {aoiRuleFeatureCollection.features.length > 0 ? <RadiusLegendItem active={false} label="Uživatelská zóna" /> : null}
        {alertAreaFeatureCollection.features.length > 0 ? <RadiusLegendItem active label="Alert vrstva" /> : null}
        {situationFeatureCollection.features.length > 0 ? <SituationLegendItem label="Situační kontext" /> : null}
        {clusterTracks ? <ClusterLegendItem label="Shluky" /> : null}
      </div>
      {clusterInfo ? <ClusterPanel cluster={clusterInfo} onClose={() => setClusterInfo(null)} /> : null}
      {missingPositionCount > 0 ? <div className="map-notice">{missingPositionCount} objektů bez polohy není v mapě.</div> : null}
      {mapError ? <div className="map-notice error">Mapový podklad: {mapError}</div> : null}
      {objects.length === 0 && !hasSituationContextEnabled && situationFeatureCollection.features.length === 0 ? <div className="map-empty">{emptyMessage}</div> : null}
    </div>
  );
}

function enableMapInteractions(map: maplibregl.Map): void {
  map.dragPan.enable();
  map.scrollZoom.enable();
  map.boxZoom.enable();
  map.dragRotate.enable();
  map.keyboard.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();

  const canvas = map.getCanvas();
  const canvasContainer = map.getCanvasContainer();
  canvas.style.pointerEvents = "auto";
  canvas.style.touchAction = "none";
  canvasContainer.style.pointerEvents = "auto";
  canvasContainer.style.touchAction = "none";
}

function stopMapToolbarEvent(event: React.SyntheticEvent<HTMLElement>): void {
  event.stopPropagation();
}

function emitMapViewport(
  map: maplibregl.Map,
  onViewChangeRef: React.MutableRefObject<(view: MapViewState) => void>,
  onBoundsChangeRef: React.MutableRefObject<(bounds: MapBounds) => void>
): void {
  const center = map.getCenter();
  const bounds = map.getBounds();
  onViewChangeRef.current({
    center: [roundCoordinate(center.lng), roundCoordinate(center.lat)],
    zoom: roundZoom(map.getZoom()),
    bearing: roundZoom(map.getBearing()),
    pitch: roundZoom(map.getPitch())
  });
  onBoundsChangeRef.current({
    east: roundCoordinate(bounds.getEast()),
    north: roundCoordinate(bounds.getNorth()),
    south: roundCoordinate(bounds.getSouth()),
    west: roundCoordinate(bounds.getWest())
  });
}

function setTrackClusterVisibility(map: maplibregl.Map, clusterTracks: boolean): void {
  const normalLayerIds = [trackSelectedHaloLayerId, trackSymbolLayerId, trackLabelLayerId];
  const clusterLayerIds = [
    trackClusterCircleLayerId,
    trackClusterCountLayerId,
    trackClusterSelectedHaloLayerId,
    trackClusterSymbolLayerId,
    trackClusterLabelLayerId
  ];

  normalLayerIds.forEach((layerId) => setLayerVisibility(map, layerId, !clusterTracks));
  clusterLayerIds.forEach((layerId) => setLayerVisibility(map, layerId, clusterTracks));
}

function setLayerVisibility(map: maplibregl.Map, layerId: string, visible: boolean): void {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

async function zoomToCluster(
  map: maplibregl.Map,
  event: MapLayerMouseEvent,
  setClusterInfo: React.Dispatch<React.SetStateAction<ClusterInfo | null>>
): Promise<void> {
  const feature = event.features?.[0];
  const clusterId = Number(feature?.properties?.cluster_id);
  const pointCount = Number(feature?.properties?.point_count);
  const center = extractPointCoordinates(feature);
  const source = map.getSource(trackClusterSourceId);
  if (!Number.isFinite(clusterId) || !Number.isFinite(pointCount) || !center || !source || !("getClusterExpansionZoom" in source)) {
    return;
  }

  const clusterSource = source as GeoJSONSource;
  const [zoom, leaves] = await Promise.all([
    clusterSource.getClusterExpansionZoom(clusterId),
    clusterSource.getClusterLeaves(clusterId, Math.min(pointCount, 12), 0).catch(() => [])
  ]);
  setClusterInfo({
    center,
    count: pointCount,
    leaves: leaves.map(clusterLeafToInfo).filter((leaf): leaf is ClusterInfo["leaves"][number] => leaf !== null),
    zoom
  });
  map.easeTo({
    center,
    duration: 650,
    zoom: Math.min(17, Math.max(map.getZoom() + 1, zoom + 0.35))
  });
}

function extractPointCoordinates(feature: NonNullable<MapLayerMouseEvent["features"]>[number] | undefined): [number, number] | null {
  const coordinates = (feature?.geometry as { coordinates?: unknown } | undefined)?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function clusterLeafToInfo(feature: unknown): ClusterInfo["leaves"][number] | null {
  const properties = isRecord((feature as { properties?: unknown })?.properties) ? (feature as { properties: Record<string, unknown> }).properties : null;
  if (!properties) {
    return null;
  }
  return {
    affiliation: stringProperty(properties.affiliation) ?? "UNKNOWN",
    label: stringProperty(properties.label) ?? stringProperty(properties.objectId) ?? "track",
    objectType: stringProperty(properties.objectType) ?? "UNKNOWN",
    status: stringProperty(properties.status) ?? "n/a"
  };
}

export function alertAreasToFeatureCollection(alerts: CopAlert[]): AlertAreaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: alerts.flatMap((alert) => {
      if (!alert.map || !Number.isFinite(alert.map.lat) || !Number.isFinite(alert.map.lon) || !Number.isFinite(alert.map.radiusKm)) {
        return [];
      }
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [buildGeodesicCircle(alert.map, Math.max(0.2, alert.map.radiusKm))]
          },
          properties: {
            alertId: alert.alertId,
            severity: alert.severity,
            type: alert.type
          }
        }
      ];
    })
  };
}

export function aoiRulesToFeatureCollection(aoiRules: AoiRule[]): AoiRuleFeatureCollection {
  return {
    type: "FeatureCollection",
    features: aoiRules.flatMap((rule) => {
      if (!rule.enabled || !Number.isFinite(rule.lat) || !Number.isFinite(rule.lon) || !Number.isFinite(rule.radiusKm) || rule.radiusKm <= 0) {
        return [];
      }
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [buildGeodesicCircle(rule, Math.max(0.2, rule.radiusKm))]
          },
          properties: {
            enabled: true,
            id: rule.id,
            color: normalizeZoneColor(rule.color),
            fillOpacity: normalizeZoneOpacity(rule.fillOpacity),
            name: rule.name,
            severity: rule.severity ?? "warning"
          }
        }
      ];
    })
  };
}

function normalizeZoneColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#8cb6d8";
}

function normalizeZoneOpacity(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(0.35, Math.max(0.02, value)) : 0.1;
}

export function situationFeaturesToFeatureCollection(
  collection: SituationFeatureCollectionResponse | null,
  selectedFeatureId?: string
): SituationContextFeatureCollection {
  return {
    type: "FeatureCollection",
    features: (collection?.features ?? []).map((feature) => ({
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        ...buildSituationRenderProperties(feature),
        selected: feature.properties.featureId === selectedFeatureId
      },
      type: "Feature"
    }))
  };
}

function buildSituationRenderProperties(feature: SituationFeature): Partial<SituationContextFeatureCollection["features"][number]["properties"]> {
  const status = situationFeatureStatus(feature);
  if (isTakGatewayFeature(feature)) {
    return {
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone,
      takGateway: true
    };
  }
  const osmCategory = resolveOsmCategoryPresentation(feature);
  if (osmCategory) {
    return {
      osmCategoryLabel: osmCategory.label,
      osmPoi: true,
      osmSymbolKey: getOsmCategoryIconKey(osmCategory.iconId),
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  if (feature.properties.layer === "mobile") {
    return {
      mobileNetworkLabel: formatMobileNetworkLabel(feature),
      mobileSymbolKey: getMobileNetworkIconKey(status.tone),
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  if (feature.properties.layer !== "weather") {
    return {
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const aviationCategory = aviationFlightCategory(feature);
  const temperatureC = recordNumber(metrics, "temperatureC");
  const windSpeedMps = recordNumber(metrics, "windSpeedMps");
  const windDirectionDeg = recordNumber(metrics, "windDirectionDeg");
  const precipitationMm = recordNumber(metrics, "precipitationMm");
  const cloudCoverPercent = recordNumber(metrics, "cloudCoverPercent");
  const stationIcao = stringProperty(tags.icaoId);
  return {
    weatherCloudCoverPercent: cloudCoverPercent,
    weatherFlightCategoryColor: aviationCategory ? aviationCategory.color : undefined,
    weatherLabel: aviationCategory ? formatAviationWeatherMapLabel(stationIcao, aviationCategory.label) : formatWeatherMapLabel(temperatureC, windSpeedMps, precipitationMm),
    weatherPrecipitationMm: precipitationMm,
    weatherStationIcao: stationIcao,
    weatherTemperatureC: temperatureC,
    weatherWindDirectionDeg: windDirectionDeg,
    weatherWindSpeedMps: windSpeedMps,
    situationStatusColor: status.color,
    situationStatusLabel: status.label,
    situationStatusTone: status.tone
  };
}

function situationFeatureStatus(feature: SituationFeature): { color: string; label: string; tone: string } {
  if (feature.properties.stale) {
    return { color: "#facc15", label: "STALE", tone: "warning" };
  }
  if (isTakGatewayFeature(feature)) {
    const affiliation = normalizeTakAffiliation(feature.properties.affiliation);
    if (affiliation === "friend") {
      return { color: "#38bdf8", label: "VLASTNÍ", tone: "info" };
    }
    if (affiliation === "hostile") {
      return { color: "#ef4444", label: "RIZIKO", tone: "critical" };
    }
    if (affiliation === "neutral") {
      return { color: "#22c55e", label: "NEUTRÁLNÍ", tone: "info" };
    }
    return { color: "#a78bfa", label: "NEZNÁMÉ", tone: "unknown" };
  }
  const aviationCategory = aviationFlightCategory(feature);
  if (aviationCategory) {
    return aviationCategory;
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw = stringProperty(tags.status)
    ?? stringProperty(tags.networkStatus)
    ?? stringProperty(metrics.status)
    ?? stringProperty(metrics.networkStatus)
    ?? feature.properties.severity
    ?? "info";
  const normalized = raw.toLowerCase();
  if (["critical", "down", "offline", "outage", "failed", "error"].includes(normalized)) {
    return { color: "#ef4444", label: "KRITICKÝ", tone: "critical" };
  }
  if (["warning", "degraded", "poor", "weak"].includes(normalized)) {
    return { color: "#facc15", label: "ZHORŠENÝ", tone: "warning" };
  }
  if (["advisory", "limited", "fair"].includes(normalized)) {
    return { color: "#fb923c", label: "OMEZENÝ", tone: "advisory" };
  }
  if (["ok", "online", "good", "fresh", "info"].includes(normalized)) {
    return { color: "#22c55e", label: "OK", tone: "info" };
  }
  return { color: "#a78bfa", label: raw.toUpperCase(), tone: "unknown" };
}

function aviationFlightCategory(feature: SituationFeature): { color: string; label: string; tone: string } | null {
  if (feature.properties.sourceId !== "aviation_weather" && feature.properties.category !== "aviation_weather_station") {
    return null;
  }
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw = stringProperty(tags.flightCategory)?.toUpperCase();
  if (raw === "LIFR") {
    return { color: "#ef4444", label: "LIFR", tone: "critical" };
  }
  if (raw === "IFR") {
    return { color: "#fb923c", label: "IFR", tone: "advisory" };
  }
  if (raw === "MVFR") {
    return { color: "#facc15", label: "MVFR", tone: "warning" };
  }
  if (raw === "VFR") {
    return { color: "#22c55e", label: "VFR", tone: "info" };
  }
  return raw ? { color: "#8cb6d8", label: raw, tone: "unknown" } : null;
}

function formatMobileNetworkLabel(feature: SituationFeature): string {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const raw = stringProperty(tags.accessTechnology)
    ?? stringProperty(tags.catTechnology)
    ?? stringProperty(tags.networkType)
    ?? stringProperty(tags.networkGeneration)
    ?? stringProperty(tags.technology)
    ?? stringProperty(tags.radioAccessTechnology)
    ?? stringProperty(tags.rat)
    ?? stringProperty(tags.standard)
    ?? stringProperty(tags.type)
    ?? stringProperty(metrics.accessTechnology)
    ?? stringProperty(metrics.catTechnology)
    ?? stringProperty(metrics.networkType)
    ?? stringProperty(metrics.networkGeneration)
    ?? stringProperty(metrics.technology)
    ?? stringProperty(metrics.radioAccessTechnology)
    ?? stringProperty(metrics.rat)
    ?? stringProperty(metrics.standard)
    ?? stringProperty(metrics.type)
    ?? stringProperty(feature.properties.category);

  return normalizeMobileNetworkLabel(raw) ?? "MOBILE";
}

function normalizeMobileNetworkLabel(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.toLowerCase().replace(/[_\s.-]+/g, "");
  if ((normalized.includes("5g") || normalized.includes("nr")) && (normalized.includes("4g") || normalized.includes("lte"))) {
    return "4G/5G";
  }
  if (normalized.includes("5g") || normalized.includes("nr")) {
    return "5G";
  }
  if (normalized.includes("4g") || normalized.includes("lte")) {
    return "4G";
  }
  if (normalized.includes("3g") || normalized.includes("umts") || normalized.includes("wcdma") || normalized.includes("hspa")) {
    return "3G";
  }
  if (normalized.includes("2g") || normalized.includes("gsm") || normalized.includes("gprs") || normalized.includes("edge")) {
    return "2G";
  }
  if (normalized.includes("mobile") || normalized.includes("cellular") || normalized.includes("network")) {
    return "MOBILE";
  }
  const compact = raw.trim().replace(/\s+/g, " ").toUpperCase();
  return compact.length > 0 ? compact.slice(0, 10) : undefined;
}

function resolveOsmCategoryPresentation(feature: SituationFeature): { iconId: OsmCategoryIconId; label: string } | null {
  if (feature.properties.sourceId !== "osm_postgis") {
    return null;
  }
  const normalized = feature.properties.category.toLowerCase().replace(/[\s.-]+/g, "_");
  if (["hospital", "clinic", "doctors", "healthcare_hospital", "healthcare_clinic", "healthcare_doctor", "ambulance_station"].includes(normalized)) {
    return { iconId: "hospital", label: "Nemocnice" };
  }
  if (["fire_station", "fire_hydrant"].includes(normalized)) {
    return { iconId: "fire_station", label: "Hasiči" };
  }
  if (normalized === "police") {
    return { iconId: "police", label: "Policie" };
  }
  if (["pharmacy", "healthcare_pharmacy", "defibrillator"].includes(normalized)) {
    return { iconId: "pharmacy", label: "Lékárna" };
  }
  if (["shelter", "assembly_point", "community_centre"].includes(normalized)) {
    return { iconId: "shelter", label: "Kryt" };
  }
  if (normalized === "townhall") {
    return { iconId: "townhall", label: "Úřad" };
  }
  if (normalized === "communications_tower") {
    return { iconId: "communications_tower", label: "Komunikační věž" };
  }
  return { iconId: "other", label: "OSM" };
}

function getMobileNetworkIconKey(tone: string | undefined): string {
  return `${mobileNetworkIconPrefix}-${normalizeMobileNetworkIconTone(tone)}`;
}

function getOsmCategoryIconKey(iconId: OsmCategoryIconId): string {
  return `${osmCategoryIconPrefix}-${iconId}`;
}

function normalizeMobileNetworkIconTone(tone: string | undefined): MobileNetworkIconTone {
  return mobileNetworkIconTones.includes(tone as MobileNetworkIconTone) ? tone as MobileNetworkIconTone : "unknown";
}

function mobileNetworkIconColor(tone: MobileNetworkIconTone): string {
  const colors: Record<MobileNetworkIconTone, string> = {
    advisory: "#fb923c",
    critical: "#ef4444",
    info: "#22c55e",
    unknown: "#a78bfa",
    warning: "#facc15"
  };
  return colors[tone];
}

function formatWeatherMapLabel(temperatureC: number | undefined, windSpeedMps: number | undefined, precipitationMm: number | undefined): string {
  const parts: string[] = [];
  if (temperatureC !== undefined) {
    parts.push(`${Math.round(temperatureC)}°C`);
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 0.5) {
    parts.push(`${Math.round(windSpeedMps)} m/s`);
  }
  if (precipitationMm !== undefined && precipitationMm > 0) {
    parts.push(`${precipitationMm.toFixed(1)} mm`);
  }
  return parts.length > 0 ? parts.slice(0, 2).join("\n") : "WX";
}

function formatAviationWeatherMapLabel(icaoId: string | undefined, flightCategory: string): string {
  return [icaoId, flightCategory].filter(Boolean).join("\n") || "METAR";
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
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
          label: formatTrackLabel(object),
          symbolColor: affiliation.color,
          symbolDisposition: affiliation.disposition
        }
      };
    })
  };
}

export function formatTrackLabel(object: CopObject): string {
  const flightData = object.attributes?.flightData;
  const callsign = cleanTrackLabel(flightData?.callsign);
  if (callsign) {
    return callsign;
  }

  const registration = cleanTrackLabel(flightData?.registration);
  if (registration) {
    return registration;
  }

  const icao24 = cleanTrackLabel(flightData?.icao24);
  if (icao24) {
    return icao24.toUpperCase();
  }

  return object.objectId;
}

function cleanTrackLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTakGatewayFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return stringProperty(tags.dataSource) === "tak-gateway";
}

function normalizeTakAffiliation(value: unknown): "friend" | "hostile" | "neutral" | "unknown" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "friend" || normalized === "hostile" || normalized === "neutral" ? normalized : "unknown";
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

function emptySituationContextFeatureCollection(): SituationContextFeatureCollection {
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

function buildGeodesicCircle(center: { lat: number; lon: number }, radiusKm: number, segments = 96): Array<[number, number]> {
  const lat = degreesToRadians(center.lat);
  const lon = degreesToRadians(center.lon);
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

export function fitMapToObjects(map: maplibregl.Map | null, objects: CopObject[]): boolean {
  const positionedObjects = objects.filter(hasPosition);
  if (!map || positionedObjects.length === 0) {
    return false;
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
    return true;
  }

  map.fitBounds(bounds, {
    padding: { top: 86, right: 72, bottom: 72, left: 72 },
    maxZoom: 12,
    duration: 750
  });
  return true;
}

function buildFitSignature(objects: CopObject[]): string {
  return objects
    .filter(hasPosition)
    .map((object) => object.objectId)
    .sort()
    .join("|");
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

async function registerSituationSymbolImages(map: maplibregl.Map) {
  mobileNetworkIconTones.forEach((tone) => {
    const key = getMobileNetworkIconKey(tone);
    if (!map.hasImage(key)) {
      map.addImage(key, createMobileNetworkSymbolImage(tone), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  osmCategoryIconIds.forEach((iconId) => {
    const key = getOsmCategoryIconKey(iconId);
    if (!map.hasImage(key)) {
      map.addImage(key, createOsmCategorySymbolImage(iconId), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
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

function createMobileNetworkSymbolImage(tone: MobileNetworkIconTone): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const waveColor = mobileNetworkIconColor(tone);
  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";

  const drawWaves = (strokeStyle: string, lineWidth: number, alpha = 1) => {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    [24, 38, 52].forEach((radius) => {
      context.beginPath();
      context.arc(64, 44, radius, -0.86, 0.86);
      context.stroke();
      context.beginPath();
      context.arc(64, 44, radius, Math.PI - 0.86, Math.PI + 0.86);
      context.stroke();
    });
    context.restore();
  };

  const drawTower = (strokeStyle: string, lineWidth: number, alpha = 1) => {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(64, 42);
    context.lineTo(36, 110);
    context.moveTo(64, 42);
    context.lineTo(92, 110);
    context.moveTo(64, 42);
    context.lineTo(64, 112);
    context.moveTo(42, 110);
    context.lineTo(86, 110);
    context.moveTo(50, 72);
    context.lineTo(78, 88);
    context.moveTo(78, 72);
    context.lineTo(50, 88);
    context.moveTo(45, 94);
    context.lineTo(83, 94);
    context.moveTo(57, 56);
    context.lineTo(71, 56);
    context.stroke();
    context.fillStyle = strokeStyle;
    context.beginPath();
    context.arc(64, 42, lineWidth >= 8 ? 9 : 5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  drawWaves("rgba(248, 250, 252, 0.92)", 13, 0.9);
  drawWaves(waveColor, 7, 0.96);
  drawTower("rgba(248, 250, 252, 0.96)", 10, 0.95);
  drawTower("#061019", 5, 0.96);

  return context.getImageData(0, 0, size, size);
}

function createOsmCategorySymbolImage(iconId: OsmCategoryIconId): ImageData {
  const canvas = document.createElement("canvas");
  const size = 112;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const color = osmCategoryIconColor(iconId);
  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";

  drawRoundedRect(context, 17, 17, 78, 78, 17);
  context.fillStyle = "rgba(6, 16, 25, 0.94)";
  context.fill();
  context.strokeStyle = "rgba(248, 250, 252, 0.9)";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();

  context.save();
  context.translate(56, 56);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 7;

  switch (iconId) {
    case "hospital":
      context.fillRect(-8, -28, 16, 56);
      context.fillRect(-28, -8, 56, 16);
      break;
    case "fire_station":
      context.beginPath();
      context.moveTo(0, -32);
      context.bezierCurveTo(20, -10, 18, 2, 8, 11);
      context.bezierCurveTo(18, 0, 3, -12, 2, -21);
      context.bezierCurveTo(-13, -8, -22, 3, -18, 17);
      context.bezierCurveTo(-14, 31, 14, 31, 20, 12);
      context.bezierCurveTo(24, 28, 9, 39, -8, 34);
      context.bezierCurveTo(-30, 28, -35, 2, -15, -17);
      context.bezierCurveTo(-6, -25, -4, -29, 0, -32);
      context.fill();
      break;
    case "police":
      context.beginPath();
      context.moveTo(0, -34);
      context.lineTo(26, -22);
      context.lineTo(21, 11);
      context.quadraticCurveTo(16, 27, 0, 35);
      context.quadraticCurveTo(-16, 27, -21, 11);
      context.lineTo(-26, -22);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.arc(0, -2, 8, 0, Math.PI * 2);
      context.fill();
      break;
    case "pharmacy":
      context.strokeStyle = color;
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(-8, -30);
      context.lineTo(8, -30);
      context.lineTo(8, -12);
      context.lineTo(27, -12);
      context.lineTo(27, 4);
      context.lineTo(8, 4);
      context.lineTo(8, 30);
      context.lineTo(-8, 30);
      context.lineTo(-8, 4);
      context.lineTo(-27, 4);
      context.lineTo(-27, -12);
      context.lineTo(-8, -12);
      context.closePath();
      context.stroke();
      break;
    case "shelter":
      context.beginPath();
      context.moveTo(-31, -4);
      context.lineTo(0, -31);
      context.lineTo(31, -4);
      context.stroke();
      context.beginPath();
      context.moveTo(-22, -4);
      context.lineTo(-22, 30);
      context.lineTo(22, 30);
      context.lineTo(22, -4);
      context.stroke();
      context.beginPath();
      context.moveTo(-8, 30);
      context.lineTo(-8, 10);
      context.lineTo(8, 10);
      context.lineTo(8, 30);
      context.stroke();
      break;
    case "townhall":
      context.beginPath();
      context.moveTo(-31, -17);
      context.lineTo(0, -32);
      context.lineTo(31, -17);
      context.closePath();
      context.fill();
      context.fillRect(-30, 27, 60, 8);
      [-20, 0, 20].forEach((x) => {
        context.fillRect(x - 5, -12, 10, 34);
      });
      break;
    case "communications_tower":
      context.beginPath();
      context.moveTo(0, -24);
      context.lineTo(-21, 32);
      context.moveTo(0, -24);
      context.lineTo(21, 32);
      context.moveTo(0, -24);
      context.lineTo(0, 34);
      context.moveTo(-13, 5);
      context.lineTo(13, 18);
      context.moveTo(13, 5);
      context.lineTo(-13, 18);
      context.moveTo(-25, 34);
      context.lineTo(25, 34);
      context.stroke();
      context.beginPath();
      context.arc(0, -24, 5, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(0, -24, 18, -0.72, 0.72);
      context.stroke();
      context.beginPath();
      context.arc(0, -24, 18, Math.PI - 0.72, Math.PI + 0.72);
      context.stroke();
      break;
    case "other":
      context.beginPath();
      context.arc(0, 0, 22, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(6, 16, 25, 0.94)";
      context.beginPath();
      context.arc(0, 0, 8, 0, Math.PI * 2);
      context.fill();
      break;
  }
  context.restore();

  return context.getImageData(0, 0, size, size);
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function osmCategoryIconColor(iconId: OsmCategoryIconId): string {
  switch (iconId) {
    case "hospital":
      return "#ef4444";
    case "fire_station":
      return "#fb923c";
    case "police":
      return "#38bdf8";
    case "pharmacy":
      return "#22c55e";
    case "shelter":
      return "#facc15";
    case "townhall":
      return "#c4b5fd";
    case "communications_tower":
      return "#8cb6d8";
    case "other":
      return "#dff8ff";
  }
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

function ClusterLegendItem({ label }: { label: string }) {
  return (
    <div className="legend-item">
      <span className="legend-cluster">12</span>
      {label}
    </div>
  );
}

function SituationLegendItem({ label }: { label: string }) {
  return (
    <div className="legend-item">
      <span className="legend-situation" />
      {label}
    </div>
  );
}

function ClusterPanel({ cluster, onClose }: { cluster: ClusterInfo; onClose: () => void }) {
  return (
    <div
      className="map-cluster-panel"
      onClick={stopMapToolbarEvent}
      onDoubleClick={stopMapToolbarEvent}
      onPointerDown={stopMapToolbarEvent}
      onWheel={stopMapToolbarEvent}
    >
      <div className="map-cluster-panel-header">
        <span>Shluk objektů</span>
        <button aria-label="Zavřít detail shluku" onClick={onClose} type="button">
          ×
        </button>
      </div>
      <strong>{cluster.count} objektů</strong>
      <small>
        {cluster.center[1].toFixed(4)}, {cluster.center[0].toFixed(4)} · zoom {cluster.zoom.toFixed(1)}
      </small>
      {cluster.leaves.length > 0 ? (
        <ul>
          {cluster.leaves.slice(0, 6).map((leaf, index) => (
            <li key={`${leaf.label}-${index}`}>
              <span>{leaf.label}</span>
              <em>{leaf.objectType} · {leaf.affiliation} · {leaf.status}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p>Detail shluku bude dostupný po přiblížení.</p>
      )}
    </div>
  );
}
