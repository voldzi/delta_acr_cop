import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Car,
  ChevronDown,
  ChevronUp,
  Circle as CircleIcon,
  Compass,
  Droplets,
  HelpCircle,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  MousePointer2,
  Navigation,
  Palette,
  Pentagon,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Ruler,
  Shield,
  Square as SquareIcon,
  Star,
  Type,
  Waves,
  X
} from "lucide-react";
import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type SourceSpecification,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  isPublicFlightObject,
  type AoiRule,
  type CopAlert,
  type CopObject,
  type MapBounds,
  type RoutingRouteResponse,
  type SituationFeature,
  type SituationFeatureCollectionResponse,
  type SketchDrawingFeature,
  type SketchDrawingKind,
  type SketchDrawingVisibility,
  type SketchGeometry,
  type TransitStopTime,
  type TransitVehicleDetailResponse
} from "./cop-data";
import type { UserLocation } from "./proximity-alerts";
import { useDocumentVisible } from "./use-document-visibility";
import { nativeCompassAvailable, NativeDeviceBridgeError, startNativeHeading } from "./cop-device-native";
import { isPendingMapFocusRequest } from "./map-location-policy";
import type { ChatLiveLocationPayload } from "@cop/messaging/bridge";
import { predictPosition, type PredictionMethod, type PredictionMode, type TrackHistory } from "./track-history";
import {
  defaultMapCenter,
  isUsableMapCenter,
  type MapBasemapMode,
  type MapViewState,
  type PublicFlightSymbolMode,
  type TrackHistoryDisplayMode
} from "./user-preferences";
import {
  getAffiliationPresentation,
  getNatoIconKey,
  resolveCopObjectSymbol,
  type AffiliationDisposition
} from "./symbology";
import {
  civilAircraftIconToneColor,
  civilAircraftIconKinds,
  getCivilAircraftIconKey,
  getFloodTrendIconKey,
  getMobileNetworkIconKey,
  getOsmCategoryIconKey,
  getRiskIconKey,
  getTransitIconKey,
  getWeatherConditionIconKey,
  normalizeWeatherConditionIconId,
  registerCivilAircraftSymbolImages,
  registerNatoSymbolImages,
  registerSituationSymbolImages,
  weatherCameraIconKey,
  weatherWindIconKey,
  type CivilAircraftIconTone,
  type CivilAircraftIconKind,
  type FloodStageTone,
  type FloodTrendDirection,
  type OsmCategoryIconId,
  type RiskIconId,
  type WeatherConditionIconId
} from "./map-symbol-rendering";
import {
  formatTransportCurrentStatus,
  formatTransportDelay,
  formatTransportSpeed,
  isTransitVehicleSelectionKey,
  resolveTransportPresentation,
  transportSelectionKey,
  type TransportIconKind
} from "./transport-presentation";
import { compactTrackIdentifier, formatTrackIdentity, formatTrackKeyKindLabel, formatTrackLabel } from "./track-label";
import {
  alertAreasToFeatureCollection,
  aoiRuleEditablePoints,
  aoiRuleToEditFeatureCollection,
  aoiRulesToFeatureCollection,
  emptyAoiDraftFeatureCollection,
  emptyAoiEditFeatureCollection,
  emptyPolygonFeatureCollection,
  findEditableAoiRule,
  sharedLiveLocationsToFeatureCollection,
  userAlertRadiusToFeatureCollection,
  userLocationToFeatureCollection,
  zoneDraftToFeatureCollection
} from "./map-area-features";
import {
  defaultSketchStyle,
  defaultSketchSymbol,
  emptySketchDraftFeatureCollection,
  emptySketchEditFeatureCollection,
  emptySketchFeatureCollection,
  formatSketchDrawingSubtitle,
  isSketchDraftMode,
  isSketchFillPattern,
  measureSketchLine,
  sketchColorSwatches,
  sketchDraftHint,
  sketchDraftLabel,
  sketchDrawingToEditFeatureCollection,
  sketchDrawingsToFeatureCollection,
  sketchDraftToFeatureCollection,
  sketchEditablePoints,
  sketchGeometryFromPoints,
  sketchPresetToSymbolInput,
  sketchSymbolPresets,
  type SketchDraftFeatureCollection,
  type SketchEditFeatureCollection,
  type SketchFeatureCollection,
  type SketchFillPattern,
  type SketchStyleSettings,
  type SketchSymbolPreset,
  type SketchToolMode
} from "./map-sketch-features";
import { RouteElevationProfileView, type RouteElevationProfileSummary } from "./route-elevation-profile";

export {
  alertAreasToFeatureCollection,
  aoiRuleToEditFeatureCollection,
  aoiRulesToFeatureCollection,
  sharedLiveLocationsToFeatureCollection,
  userAlertRadiusToFeatureCollection,
  userLocationToFeatureCollection
} from "./map-area-features";
export type {
  AlertAreaFeatureCollection,
  AoiDraftFeatureCollection,
  AoiEditFeatureCollection,
  AoiRuleFeatureCollection,
  EmptyFeatureCollection,
  SharedLiveLocationFeatureCollection,
  UserAlertRadiusFeatureCollection,
  UserLocationFeatureCollection
} from "./map-area-features";
export type {
  SketchDraftFeatureCollection,
  SketchEditFeatureCollection,
  SketchFeatureCollection,
  SketchFillPattern,
  SketchStyleSettings,
  SketchSymbolPalette,
  SketchSymbolPreset,
  SketchToolMode
} from "./map-sketch-features";

const trackSourceId = "cop-live-tracks";
const trackClusterSourceId = "cop-live-track-clusters";
const trackHistorySourceId = "cop-track-history";
const trackPredictionSourceId = "cop-track-prediction";
const userLocationSourceId = "cop-user-location";
const sharedLiveLocationSourceId = "cop-shared-live-locations";
const userAlertRadiusSourceId = "cop-user-alert-radius";
const aoiRuleSourceId = "cop-aoi-rules";
const aoiDraftSourceId = "cop-aoi-draft";
const aoiEditSourceId = "cop-aoi-edit";
const sketchSourceId = "cop-sketch-drawings";
const sketchDraftSourceId = "cop-sketch-draft";
const sketchEditSourceId = "cop-sketch-edit";
const alertAreaSourceId = "cop-alert-areas";
const situationSourceId = "cop-situation-context";
const situationOsmClusterSourceId = "cop-situation-osm-clusters";
const trackHistoryLayerId = "cop-track-history-line";
const trackPredictionUncertaintyLayerId = "cop-track-prediction-uncertainty";
const trackPredictionLayerId = "cop-track-prediction-line";
const userAlertRadiusFillLayerId = "cop-user-alert-radius-fill";
const userAlertRadiusLineLayerId = "cop-user-alert-radius-line";
const aoiRuleFillLayerId = "cop-aoi-rule-fill";
const aoiRuleLineLayerId = "cop-aoi-rule-line";
const aoiDraftFillLayerId = "cop-aoi-draft-fill";
const aoiDraftLineLayerId = "cop-aoi-draft-line";
const aoiDraftPointLayerId = "cop-aoi-draft-point";
const aoiEditMidpointLayerId = "cop-aoi-edit-midpoint";
const aoiEditVertexLayerId = "cop-aoi-edit-vertex";
const sketchFillLayerId = "cop-sketch-fill";
const sketchLineLayerId = "cop-sketch-line";
const sketchArrowHeadLayerId = "cop-sketch-arrowhead";
const sketchPointLayerId = "cop-sketch-point";
const sketchPointIconLayerId = "cop-sketch-point-icon";
const sketchLabelLayerId = "cop-sketch-label";
const sketchDraftLineLayerId = "cop-sketch-draft-line";
const sketchDraftPointLayerId = "cop-sketch-draft-point";
const sketchEditMidpointLayerId = "cop-sketch-edit-midpoint";
const sketchEditVertexLayerId = "cop-sketch-edit-vertex";
const alertAreaFillLayerId = "cop-alert-area-fill";
const alertAreaLineLayerId = "cop-alert-area-line";
const situationSafetyAlertFillLayerId = "cop-situation-safety-alert-fill";
const situationSafetyAlertLineLayerId = "cop-situation-safety-alert-line";
const situationFillLayerId = "cop-situation-fill";
const situationLineLayerId = "cop-situation-line";
const situationTrailRouteLineLayerId = "cop-situation-trail-route-line";
const situationTrailRouteLabelLayerId = "cop-situation-trail-route-label";
const situationRadioFillLayerId = "cop-situation-radio-fill";
const situationRadioLineLayerId = "cop-situation-radio-line";
const situationRadioPointHaloLayerId = "cop-situation-radio-point-halo";
const situationRadioPointLayerId = "cop-situation-radio-point";
const situationRadioLabelLayerId = "cop-situation-radio-label";
const situationRasterOverlayLayerPrefix = "cop-situation-raster-overlay-layer";
const situationRasterOverlaySourcePrefix = "cop-situation-raster-overlay-source";
const situationPointSelectedLayerId = "cop-situation-point-selected";
const situationWeatherForecastFillLayerId = "cop-situation-weather-forecast-fill";
const situationWeatherForecastLineLayerId = "cop-situation-weather-forecast-line";
const situationWeatherForecastIconLayerId = "cop-situation-weather-forecast-icon";
const situationWeatherForecastLabelLayerId = "cop-situation-weather-forecast-label";
const situationWeatherGridFillLayerId = "cop-situation-weather-grid-fill";
const situationWeatherGridLineLayerId = "cop-situation-weather-grid-line";
const situationWeatherGridLabelLayerId = "cop-situation-weather-grid-label";
const situationWeatherPulseLayerId = "cop-situation-weather-pulse";
const situationWeatherHeatLayerId = "cop-situation-weather-heat";
const situationWeatherPriorityLayerId = "cop-situation-weather-priority";
const situationWeatherConditionLayerId = "cop-situation-weather-condition";
const situationWeatherDetailLayerId = "cop-situation-weather-detail";
const situationWeatherWindLayerId = "cop-situation-weather-wind";
const situationWeatherValueLayerId = "cop-situation-weather-value";
const situationWeatherLabelLayerId = "cop-situation-weather-label";
const situationWeatherCameraSelectedLayerId = "cop-situation-weather-camera-selected";
const situationWeatherCameraLayerId = "cop-situation-weather-camera";
const situationAirQualityHeatLayerId = "cop-situation-air-quality-heat";
const situationAirQualityPointLayerId = "cop-situation-air-quality-point";
const situationAirQualityLabelLayerId = "cop-situation-air-quality-label";
const situationOsmClusterCircleLayerId = "cop-situation-osm-cluster-circle";
const situationOsmClusterCountLayerId = "cop-situation-osm-cluster-count";
const situationOsmClusterSymbolLayerId = "cop-situation-osm-cluster-symbol";
const situationOsmClusterLabelLayerId = "cop-situation-osm-cluster-label";
const situationOsmSymbolLayerId = "cop-situation-osm-symbol";
const situationOsmDetailSymbolLayerId = "cop-situation-osm-detail-symbol";
const situationMobileSymbolLayerId = "cop-situation-mobile-symbol";
const situationTrafficSymbolLayerId = "cop-situation-traffic-symbol";
const situationTrafficStopHaloLayerId = "cop-situation-traffic-stop-halo";
const situationTrafficStopLayerId = "cop-situation-traffic-stop";
const selectedTransitRouteSourceId = "cop-selected-transit-route";
const selectedTransitRouteLineLayerId = "cop-selected-transit-route-line";
const selectedTransitRouteStopLayerId = "cop-selected-transit-route-stop";
const selectedTransitRouteStopLabelLayerId = "cop-selected-transit-route-stop-label";
const emergencyRouteSourceId = "cop-emergency-route";
const emergencyRouteFillLayerId = "cop-emergency-route-fill";
const emergencyRouteLineCasingLayerId = "cop-emergency-route-line-casing";
const emergencyRouteLineLayerId = "cop-emergency-route-line";
const emergencyRoutePointLayerId = "cop-emergency-route-point";
const emergencyRoutePointLabelLayerId = "cop-emergency-route-point-label";
const situationRiskPointLayerId = "cop-situation-risk-point";
const situationRiskIconLayerId = "cop-situation-risk-icon";
const situationFloodTrendLayerId = "cop-situation-flood-trend";
const situationHydroReferenceIconLayerId = "cop-situation-hydro-reference-icon";
const situationHydroReferenceTrendLayerId = "cop-situation-hydro-reference-trend";
const situationHydroReferenceDetailIconLayerId = "cop-situation-hydro-reference-detail-icon";
const situationHydroReferenceDetailTrendLayerId = "cop-situation-hydro-reference-detail-trend";
const situationHydroReferenceLabelLayerId = "cop-situation-hydro-reference-label";
const situationRiskLabelLayerId = "cop-situation-risk-label";
const situationPointLayerId = "cop-situation-point";
const situationLabelLayerId = "cop-situation-label";
const userLocationAccuracyLayerId = "cop-user-location-accuracy";
const userLocationLayerId = "cop-user-location-point";
const sharedLiveLocationAccuracyLayerId = "cop-shared-live-location-accuracy";
const sharedLiveLocationLayerId = "cop-shared-live-location-point";
const sharedLiveLocationLabelLayerId = "cop-shared-live-location-label";
const trackSelectedHaloLayerId = "cop-live-track-selected-halo";
const trackHoverHaloLayerId = "cop-live-track-hover-halo";
const trackSymbolLayerId = "cop-live-track-symbol";
const trackLabelLayerId = "cop-live-track-label";
const trackClusterCircleLayerId = "cop-live-track-cluster-circle";
const trackClusterCountLayerId = "cop-live-track-cluster-count";
const trackClusterSelectedHaloLayerId = "cop-live-track-cluster-selected-halo";
const trackClusterSymbolLayerId = "cop-live-track-cluster-symbol";
const trackClusterLabelLayerId = "cop-live-track-cluster-label";

const mapClusterClickLayerIds = [
  trackClusterCircleLayerId,
  trackClusterCountLayerId,
  situationOsmClusterCircleLayerId,
  situationOsmClusterCountLayerId
] as const;

const mapFeatureClickPriorityLayerIds = [
  trackSymbolLayerId,
  trackLabelLayerId,
  trackClusterSymbolLayerId,
  trackClusterLabelLayerId,
  sharedLiveLocationLayerId,
  sharedLiveLocationLabelLayerId,
  sharedLiveLocationAccuracyLayerId,
  sketchArrowHeadLayerId,
  sketchPointLayerId,
  sketchPointIconLayerId,
  sketchLabelLayerId,
  sketchLineLayerId,
  sketchFillLayerId,
  situationRiskIconLayerId,
  situationRadioPointLayerId,
  situationRadioLabelLayerId,
  situationRadioLineLayerId,
  situationRadioFillLayerId,
  situationFloodTrendLayerId,
  situationHydroReferenceDetailTrendLayerId,
  situationHydroReferenceDetailIconLayerId,
  situationHydroReferenceIconLayerId,
  situationHydroReferenceTrendLayerId,
  situationHydroReferenceLabelLayerId,
  situationRiskPointLayerId,
  situationRiskLabelLayerId,
  situationTrafficSymbolLayerId,
  situationTrafficStopLayerId,
  situationMobileSymbolLayerId,
  situationWeatherCameraLayerId,
  situationWeatherLabelLayerId,
  situationWeatherValueLayerId,
  situationWeatherWindLayerId,
  situationWeatherDetailLayerId,
  situationWeatherPriorityLayerId,
  situationWeatherConditionLayerId,
  situationWeatherCameraSelectedLayerId,
  situationWeatherForecastIconLayerId,
  situationWeatherForecastLabelLayerId,
  situationWeatherForecastLineLayerId,
  situationWeatherForecastFillLayerId,
  situationAirQualityLabelLayerId,
  situationAirQualityPointLayerId,
  situationOsmClusterSymbolLayerId,
  situationOsmClusterLabelLayerId,
  situationOsmDetailSymbolLayerId,
  situationOsmSymbolLayerId,
  situationPointSelectedLayerId,
  situationPointLayerId,
  situationLabelLayerId,
  situationWeatherGridLabelLayerId,
  situationWeatherGridLineLayerId,
  situationWeatherGridFillLayerId,
  situationSafetyAlertLineLayerId,
  situationSafetyAlertFillLayerId,
  situationTrailRouteLabelLayerId,
  situationTrailRouteLineLayerId,
  situationLineLayerId,
  situationFillLayerId
] as const;

const dynamicLegendLayerIds = [
  trackSymbolLayerId,
  trackLabelLayerId,
  trackClusterCircleLayerId,
  trackClusterCountLayerId,
  trackClusterSymbolLayerId,
  trackClusterLabelLayerId,
  sharedLiveLocationLayerId,
  sharedLiveLocationLabelLayerId,
  situationRiskIconLayerId,
  situationRadioPointLayerId,
  situationRadioLabelLayerId,
  situationFloodTrendLayerId,
  situationHydroReferenceDetailTrendLayerId,
  situationHydroReferenceDetailIconLayerId,
  situationHydroReferenceIconLayerId,
  situationHydroReferenceTrendLayerId,
  situationHydroReferenceLabelLayerId,
  situationRiskPointLayerId,
  situationRiskLabelLayerId,
  situationTrafficSymbolLayerId,
  situationTrafficStopLayerId,
  situationMobileSymbolLayerId,
  situationWeatherCameraLayerId,
  situationWeatherLabelLayerId,
  situationWeatherValueLayerId,
  situationWeatherWindLayerId,
  situationWeatherDetailLayerId,
  situationWeatherPriorityLayerId,
  situationWeatherConditionLayerId,
  situationWeatherForecastIconLayerId,
  situationWeatherForecastLabelLayerId,
  situationAirQualityLabelLayerId,
  situationAirQualityPointLayerId,
  situationOsmClusterSymbolLayerId,
  situationOsmClusterLabelLayerId,
  situationOsmDetailSymbolLayerId,
  situationOsmSymbolLayerId,
  situationPointLayerId,
  situationLabelLayerId
] as const;

type RasterOverlayCoordinates = [[number, number], [number, number], [number, number], [number, number]];

interface SituationRasterOverlaySpec {
  coordinates: RasterOverlayCoordinates;
  id: string;
  layerId: string;
  opacity: number;
  sourceId: string;
  url: string;
}

const mapPointRaiseLayerIds = [
  sketchFillLayerId,
  sketchLineLayerId,
  sketchArrowHeadLayerId,
  sketchPointLayerId,
  sketchPointIconLayerId,
  sketchLabelLayerId,
  situationPointSelectedLayerId,
  situationPointLayerId,
  situationTrafficSymbolLayerId,
  situationTrafficStopLayerId,
  situationRiskPointLayerId,
  situationRiskIconLayerId,
  situationFloodTrendLayerId,
  situationHydroReferenceDetailIconLayerId,
  situationHydroReferenceDetailTrendLayerId,
  situationHydroReferenceIconLayerId,
  situationHydroReferenceTrendLayerId,
  situationHydroReferenceLabelLayerId,
  situationRiskLabelLayerId,
  situationOsmClusterCircleLayerId,
  situationOsmClusterCountLayerId,
  situationOsmClusterSymbolLayerId,
  situationOsmClusterLabelLayerId,
  situationOsmSymbolLayerId,
  situationOsmDetailSymbolLayerId,
  situationRadioPointHaloLayerId,
  situationRadioPointLayerId,
  situationRadioLabelLayerId,
  situationMobileSymbolLayerId,
  situationWeatherCameraSelectedLayerId,
  situationWeatherCameraLayerId,
  situationWeatherPriorityLayerId,
  situationWeatherConditionLayerId,
  situationWeatherDetailLayerId,
  situationWeatherWindLayerId,
  situationWeatherValueLayerId,
  situationWeatherLabelLayerId,
  situationWeatherForecastIconLayerId,
  situationWeatherForecastLabelLayerId,
  situationAirQualityPointLayerId,
  situationAirQualityLabelLayerId,
  userLocationAccuracyLayerId,
  userLocationLayerId,
  sharedLiveLocationAccuracyLayerId,
  sharedLiveLocationLayerId,
  sharedLiveLocationLabelLayerId,
  trackHoverHaloLayerId,
  trackSelectedHaloLayerId,
  trackClusterCircleLayerId,
  trackClusterCountLayerId,
  trackClusterSelectedHaloLayerId,
  emergencyRouteLineLayerId,
  emergencyRouteFillLayerId,
  emergencyRoutePointLayerId,
  emergencyRoutePointLabelLayerId,
  trackClusterSymbolLayerId,
  trackClusterLabelLayerId,
  trackSymbolLayerId,
  trackLabelLayerId
] as const;

const defaultTileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const defaultTileGlyphsUrl = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const defaultTileAttribution = "&copy; OpenStreetMap contributors";
const mapStyleUrl = normalizeOptionalMapUrl(import.meta.env.VITE_COP_MAP_STYLE_URL);
const tileUrl = normalizeMapTileTemplate(import.meta.env.VITE_COP_TILE_URL, defaultTileUrl);
const tileGlyphsUrl = normalizeMapGlyphsTemplate(import.meta.env.VITE_COP_TILE_GLYPHS_URL, defaultTileGlyphsUrl);
const tileAttribution = normalizeOptionalMapText(import.meta.env.VITE_COP_TILE_ATTRIBUTION, defaultTileAttribution);
const defaultCenter = parseMapCenter(import.meta.env.VITE_COP_MAP_CENTER);
const defaultZoom = parseFiniteNumber(import.meta.env.VITE_COP_MAP_ZOOM, 8);
export interface TrackFeatureProperties {
  objectId: string;
  objectType: string;
  affiliation: string;
  confidence: number;
  status: string;
  synthetic: boolean;
  selected: boolean;
  hovered: boolean;
  symbolCode: string;
  symbolKey: string;
  displaySymbolKey: string;
  publicFlight: boolean;
  aircraftHeadingDeg?: number;
  civilAircraftKind?: CivilAircraftIconKind;
  civilAircraftTone?: CivilAircraftIconTone;
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

export interface DynamicLegendItem {
  color: string;
  count: number;
  disposition?: AffiliationDisposition;
  key: string;
  label: string;
  shape: "circle" | "cluster" | "diamond" | "square";
}

interface DynamicLegendBucket {
  color: string;
  count: number;
  disposition?: AffiliationDisposition;
  identities: Set<string>;
  key: string;
  label: string;
  shape: DynamicLegendItem["shape"];
}

interface DynamicLegendCandidate {
  color: string;
  disposition?: AffiliationDisposition;
  identity: string;
  key: string;
  label: string;
  shape: DynamicLegendItem["shape"];
  weight: number;
}

export interface TrackLineFeature {
  type: "Feature";
  geometry:
    | {
        type: "LineString";
        coordinates: Array<[number, number]>;
      }
    | {
        type: "Polygon";
        coordinates: Array<Array<[number, number]>>;
      };
  properties: {
    objectId: string;
    color: string;
    confidence?: number;
    kind?: "path" | "uncertainty";
    selected: boolean;
    method?: PredictionMethod;
    opacity?: number;
    uncertaintyM?: number;
  };
}

export interface TrackLineFeatureCollection {
  type: "FeatureCollection";
  features: TrackLineFeature[];
}

export interface SelectedRouteFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      { type: "LineString"; coordinates: Array<[number, number]> } | { type: "Point"; coordinates: [number, number] };
    properties: { featureId: string; kind: "route-line" | "route-stop" | "route-waypoint"; label: string };
  }>;
}

export interface EmergencyRouteFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: Array<[number, number]> }
      | { type: "Point"; coordinates: [number, number] }
      | { type: "Polygon"; coordinates: Array<Array<[number, number]>> }
      | { type: "MultiPolygon"; coordinates: Array<Array<Array<[number, number]>>> };
    properties: {
      kind: "route-area" | "route-line" | "route-point";
      distanceM?: number;
      durationSeconds?: number;
      label: string;
      qualityMode?: string;
      rank?: number;
      role: "access" | "alternative" | "destination" | "incident" | "isochrone" | "origin" | "primary";
      routeId: string;
      sequence?: number;
      trafficSeverity?: string;
    };
  }>;
}

type RoutingActionProfile =
  "car" | "emergency_vehicle" | "evacuation_walking" | "large_emergency_vehicle" | "offroad_4x4" | "walking";

export interface SituationContextFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: SituationFeature["geometry"];
    properties: SituationFeature["properties"] & {
      selected: boolean;
      airQualityDominantPollutant?: string;
      airQualityFeature?: boolean;
      airQualityIndex?: number;
      airQualityLabel?: string;
      airQualityLevel?: string;
      weatherCloudCoverPercent?: number;
      weatherCamera?: boolean;
      weatherCameraLabel?: string;
      weatherFillColor?: string;
      weatherFillOpacity?: number;
      weatherFlightCategoryColor?: string;
      weatherForecastArea?: boolean;
      weatherForecastDetailUrl?: string;
      weatherForecastFillColor?: string;
      weatherForecastLabel?: string;
      weatherForecastLineColor?: string;
      weatherForecastRiskLevel?: string;
      weatherForecastRiskScore?: number;
      weatherForecastSubtitle?: string;
      weatherForecastSymbolKey?: string;
      weatherGrid?: boolean;
      weatherGridKind?: string;
      weatherHeadline?: string;
      weatherLabel?: string;
      weatherLineColor?: string;
      weatherMapPriority?: number;
      weatherMetricLabel?: string;
      weatherObservation?: boolean;
      weatherPulse?: boolean;
      weatherPulseColor?: string;
      weatherPulseOpacity?: number;
      weatherPulseRadius?: number;
      weatherConditionLabel?: string;
      weatherSubtitle?: string;
      weatherPrecipitationMm?: number;
      weatherStationIcao?: string;
      weatherStationLabel?: string;
      weatherSymbolKey?: string;
      weatherTemperatureC?: number;
      weatherValueLabel?: string;
      weatherWindDirectionDeg?: number;
      weatherWindSpeedMps?: number;
      coverageColor?: string;
      coverageLabel?: string;
      coverageLineOpacity?: number;
      coverageOpacity?: number;
      coverageQuality?: string;
      coverageTechnology?: string;
      radioFillColor?: string;
      radioFillOpacity?: number;
      radioLabel?: string;
      radioLineColor?: string;
      radioLineOpacity?: number;
      radioOverlay?: boolean;
      radioOverlayKind?: string;
      radioPointColor?: string;
      radioPointHaloColor?: string;
      boundaryLabel?: string;
      boundaryReference?: boolean;
      communicationTower?: boolean;
      mapLabel?: string;
      mapPointSuppressed?: boolean;
      missionArena?: boolean;
      missionArenaRole?: string;
      missionArenaTeamColor?: string;
      situationStatusColor?: string;
      situationStatusLabel?: string;
      situationStatusTone?: string;
      takGateway?: boolean;
      trafficHeadingDeg?: number;
      trafficRouteShortName?: string;
      trafficRouteType?: string;
      trafficSymbolKey?: string;
      trafficStaticStop?: boolean;
      trafficStopName?: string;
      trafficTransit?: boolean;
      trailPoi?: boolean;
      trailPoiCategory?: string;
      trailPoiLabel?: string;
      trailRoute?: boolean;
      trailRouteColor?: string;
      trailRouteLabel?: string;
      trailRouteMode?: string;
      mobileNetworkLabel?: string;
      mobileSymbolKey?: string;
      osmCategoryLabel?: string;
      osmPoi?: boolean;
      osmSymbolKey?: string;
      riskFeature?: boolean;
      safetyAlertDimmed?: boolean;
      safetyAlertLayer?: "warnings" | "weather_alerts";
      floodStageLabel?: string;
      floodTrendIconKey?: string;
      floodTrendLabel?: string;
      hydroMapPriority?: number;
      riskIconKey?: string;
      riskKind?: RiskIconId;
      riskMapLabel?: string;
    };
  }>;
}

interface CopMapProps {
  alerts: CopAlert[];
  aoiRules: AoiRule[];
  clusterTracks: boolean;
  objects: CopObject[];
  emptyMessage: string | null;
  emergencyRoute?: RoutingRouteResponse | null;
  emergencyRouteMessage?: string | null;
  emergencyRouteStatus?: "error" | "idle" | "loading" | "ready";
  hasSituationContextEnabled: boolean;
  mapLayerDetailLabel: string;
  mapLayerLabel: string;
  mapControlsCollapsed: boolean;
  mapLegendCollapsed: boolean;
  mapInteractionSuspended?: boolean;
  mapResizeSuspended?: boolean;
  mobileSketchControlsOpen?: boolean;
  selectedSituationFeatureId?: string;
  selectedSituationFeatureStableKey?: string;
  selectedObjectId?: string;
  showHistory: boolean;
  showPrediction: boolean;
  trackHistoryDisplayMode: TrackHistoryDisplayMode;
  trackHistory: TrackHistory;
  mapBasemapMode: MapBasemapMode;
  publicFlightSymbolMode: PublicFlightSymbolMode;
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
  selectedTransitRouteDetail?: TransitVehicleDetailResponse | null;
  selectedTransitRouteShape?: unknown;
  sharedLiveLocations: ChatLiveLocationPayload[];
  onBoundsChange: (bounds: MapBounds) => void;
  onSelectObject: (object: CopObject) => void;
  onSelectSituationFeature: (feature: SituationFeature) => void;
  onStartReport?: () => void;
  onAutoFitChange: (value: boolean) => void;
  onMapControlsCollapsedChange: (value: boolean) => void;
  onMapLegendCollapsedChange: (value: boolean) => void;
  onClearSelection?: () => void;
  onClearEmergencyRoute?: () => void;
  onActivateEmergencyRoute?: (routeId: string) => void;
  onSelectEmergencyRoute?: (info: EmergencyRouteSelectionInfo | null) => void;
  onRequestIsochroneFromPoint?: (target: { label?: string; lat: number; lon: number }) => void;
  onRequestNearestAccessToPoint?: (target: { label?: string; lat: number; lon: number }) => void;
  onRequestRouteToPoint?: (
    target: { label?: string; lat: number; lon: number },
    profile?: RoutingActionProfile
  ) => void;
  onStartNavigationToPoint?: (
    target: { label?: string; lat: number; lon: number },
    profile?: RoutingActionProfile
  ) => void;
  onRequestUserLocation: () => void;
  onUserLocationFollowChange: (value: boolean) => void;
  onUserMapInteraction?: () => void;
  onViewChange: (view: MapViewState) => void;
  reportLocationPickActive?: boolean;
  showAlertAreas: boolean;
  showProximityAlertRadius: boolean;
  editingZoneId?: string | null;
  zoneCreationActive?: boolean;
  onCancelZoneCreation?: () => void;
  onCancelZoneEditing?: () => void;
  onCreateZonePolygon?: (points: Array<{ lat: number; lon: number }>) => void;
  onUpdateZonePolygon?: (zoneId: string, points: Array<{ lat: number; lon: number }>) => void;
  onPickReportLocation?: (center: { lat: number; lon: number }) => void;
  onPickRadioPoint?: (center: { lat: number; lon: number }) => void;
  userLocation: UserLocation | null;
  userLocationFollowEnabled: boolean;
  radioPointPickActive?: boolean;
  radioPointPickLabel?: string;
  sketchDrawings?: SketchDrawingFeature[];
  sketchMode?: SketchToolMode;
  selectedSketchDrawingId?: string | null;
  onCreateSketchDrawing?: (input: CreateSketchDrawingRequest) => void;
  onDeleteSketchDrawing?: (drawingId: string) => void;
  onSelectSketchDrawing?: (drawing: SketchDrawingFeature | null) => void;
  onSketchModeChange?: (mode: SketchToolMode) => void;
  onUpdateSketchDrawing?: (drawingId: string, input: UpdateSketchDrawingRequest) => void;
}

type DeviceCompassStatus = "active" | "denied" | "idle" | "unsupported";

interface DeviceCompassState {
  headingDeg?: number;
  message?: string;
  status: DeviceCompassStatus;
}

const sketchToolItems: Array<{
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  mode: SketchToolMode;
}> = [
  { Icon: MousePointer2, label: "Pohyb", mode: "pan" },
  { Icon: MousePointer2, label: "Výběr", mode: "select" },
  { Icon: MapPin, label: "Značka", mode: "marker" },
  { Icon: Minus, label: "Linie", mode: "line" },
  { Icon: ArrowRight, label: "Šipka", mode: "arrow" },
  { Icon: Pentagon, label: "Polygon", mode: "polygon" },
  { Icon: CircleIcon, label: "Kruh", mode: "circle" },
  { Icon: Type, label: "Text", mode: "text" },
  { Icon: Ruler, label: "Měření", mode: "measurement" }
];

const sketchSymbolIcons: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  closure: X,
  evacuation: ArrowRight,
  help: HelpCircle,
  "meeting-point": MapPin,
  note: HelpCircle,
  risk: AlertTriangle,
  "shape-circle": CircleIcon,
  "shape-cross": HelpCircle,
  "shape-diamond": AlertTriangle,
  "shape-rectangle": SquareIcon,
  "shape-square": SquareIcon,
  "shape-star": Star,
  "shape-triangle": AlertTriangle,
  "shape-wave": Waves,
  "water-source": Droplets,
  warning: AlertTriangle,
  "app6-friendly": Shield,
  "app6-neutral": SquareIcon,
  "app6-unknown": Shield
};

export interface CreateSketchDrawingRequest {
  geometry: SketchGeometry;
  kind: SketchDrawingKind;
  label?: string;
  properties?: Record<string, unknown>;
  style?: Partial<SketchDrawingFeature["properties"]["style"]>;
  symbol?: Partial<SketchDrawingFeature["properties"]["symbol"]>;
  visibility?: SketchDrawingVisibility;
}

export interface UpdateSketchDrawingRequest {
  geometry?: SketchGeometry;
  label?: string;
  properties?: Record<string, unknown>;
  style?: Partial<SketchDrawingFeature["properties"]["style"]>;
  symbol?: Partial<SketchDrawingFeature["properties"]["symbol"]>;
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

export interface MapSelectionCard {
  analysisSections?: Array<{
    items: string[];
    title: string;
  }>;
  compactSubtitle: string;
  detailRows?: Array<{
    label: string;
    value: string;
  }>;
  elevationProfile?: RouteElevationProfileSummary;
  eyebrow: string;
  key: string;
  metaItems: string[];
  statusTone?: "bad" | "ok" | "warn";
  subtitle: string;
  title: string;
  variant?: "aircraft" | "default";
}

export interface EmergencyRouteSelectionInfo {
  canActivate?: boolean;
  card: MapSelectionCard;
  coordinate: [number, number];
  routeId?: string;
}

function CopMapComponent({
  alerts,
  aoiRules,
  clusterTracks,
  objects,
  emptyMessage,
  emergencyRoute = null,
  emergencyRouteMessage = null,
  emergencyRouteStatus = "idle",
  hasSituationContextEnabled,
  mapLayerDetailLabel,
  mapLayerLabel,
  mapControlsCollapsed,
  mapLegendCollapsed,
  mapInteractionSuspended = false,
  mapResizeSuspended = false,
  mobileSketchControlsOpen = false,
  selectedSituationFeatureId,
  selectedSituationFeatureStableKey,
  selectedObjectId,
  showHistory,
  showPrediction,
  trackHistoryDisplayMode,
  trackHistory,
  mapBasemapMode,
  publicFlightSymbolMode,
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
  selectedTransitRouteDetail,
  selectedTransitRouteShape,
  sharedLiveLocations,
  onBoundsChange,
  onSelectObject,
  onSelectSituationFeature,
  onActivateEmergencyRoute,
  onSelectEmergencyRoute,
  onStartReport,
  onAutoFitChange,
  onMapControlsCollapsedChange,
  onMapLegendCollapsedChange,
  onCancelZoneCreation,
  onClearEmergencyRoute,
  onClearSelection,
  onCreateZonePolygon,
  onPickReportLocation,
  onRequestIsochroneFromPoint,
  onRequestNearestAccessToPoint,
  onRequestRouteToPoint,
  onRequestUserLocation,
  onStartNavigationToPoint,
  onUserLocationFollowChange,
  onUserMapInteraction,
  onViewChange,
  reportLocationPickActive = false,
  showAlertAreas,
  showProximityAlertRadius,
  editingZoneId = null,
  userLocation,
  userLocationFollowEnabled,
  onCancelZoneEditing,
  onUpdateZonePolygon,
  onPickRadioPoint,
  zoneCreationActive = false,
  radioPointPickActive = false,
  radioPointPickLabel,
  sketchDrawings = [],
  sketchMode = "pan",
  selectedSketchDrawingId = null,
  onCreateSketchDrawing,
  onDeleteSketchDrawing,
  onSelectSketchDrawing,
  onSketchModeChange,
  onUpdateSketchDrawing
}: CopMapProps) {
  const documentVisible = useDocumentVisible();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const selectionPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const selectionPopoverDragRef = React.useRef<{
    detachedAtStart: boolean;
    height: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);
  const sketchPaletteRef = React.useRef<HTMLDivElement | null>(null);
  const sketchPaletteDragRef = React.useRef<{
    height: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);
  const mapControlsRef = React.useRef<HTMLDivElement | null>(null);
  const mapControlsDragRef = React.useRef<{
    height: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const situationRasterOverlayIdsRef = React.useRef<Set<string>>(new Set());
  const objectsRef = React.useRef(objects);
  const sharedLiveLocationsRef = React.useRef(sharedLiveLocations);
  const situationFeaturesRef = React.useRef<SituationFeature[]>([]);
  const onBoundsChangeRef = React.useRef(onBoundsChange);
  const onSelectObjectRef = React.useRef(onSelectObject);
  const onSelectSituationFeatureRef = React.useRef(onSelectSituationFeature);
  const onSelectEmergencyRouteRef = React.useRef(onSelectEmergencyRoute);
  const onAutoFitChangeRef = React.useRef(onAutoFitChange);
  const onCancelZoneCreationRef = React.useRef(onCancelZoneCreation);
  const onCancelZoneEditingRef = React.useRef(onCancelZoneEditing);
  const onClearSelectionRef = React.useRef(onClearSelection);
  const onCreateZonePolygonRef = React.useRef(onCreateZonePolygon);
  const onUpdateZonePolygonRef = React.useRef(onUpdateZonePolygon);
  const onCreateSketchDrawingRef = React.useRef(onCreateSketchDrawing);
  const onDeleteSketchDrawingRef = React.useRef(onDeleteSketchDrawing);
  const onSelectSketchDrawingRef = React.useRef(onSelectSketchDrawing);
  const onSketchModeChangeRef = React.useRef(onSketchModeChange);
  const onUpdateSketchDrawingRef = React.useRef(onUpdateSketchDrawing);
  const onPickReportLocationRef = React.useRef(onPickReportLocation);
  const onPickRadioPointRef = React.useRef(onPickRadioPoint);
  const onUserMapInteractionRef = React.useRef(onUserMapInteraction);
  const onViewChangeRef = React.useRef(onViewChange);
  const aoiRulesRef = React.useRef(aoiRules);
  const sketchDrawingsRef = React.useRef(sketchDrawings);
  const sketchModeRef = React.useRef<SketchToolMode>(sketchMode);
  const selectedSketchDrawingIdRef = React.useRef<string | null>(selectedSketchDrawingId);
  const editingZoneIdRef = React.useRef<string | null>(editingZoneId);
  const draggedAoiVertexRef = React.useRef<{ index: number; zoneId: string } | null>(null);
  const draggedSketchVertexRef = React.useRef<{ drawingId: string; index: number } | null>(null);
  const reportLocationPickActiveRef = React.useRef(reportLocationPickActive);
  const radioPointPickActiveRef = React.useRef(radioPointPickActive);
  const zoneCreationActiveRef = React.useRef(zoneCreationActive);
  const lastFitSignatureRef = React.useRef("");
  const handledFocusViewRequestRef = React.useRef(0);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const nativeHeadingStopRef = React.useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapTilesReady, setMapTilesReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [clusterInfo, setClusterInfo] = React.useState<ClusterInfo | null>(null);
  const [mapFullscreen, setMapFullscreen] = React.useState(false);
  const [mapBearingDeg, setMapBearingDeg] = React.useState(() => normalizeCompassDegrees(initialView?.bearing ?? 0));
  const [deviceCompass, setDeviceCompass] = React.useState<DeviceCompassState>(() => initialDeviceCompassState());
  const [compassExpanded, setCompassExpanded] = React.useState(false);
  const [mapControlsPosition, setMapControlsPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [mapControlsDragging, setMapControlsDragging] = React.useState(false);
  const [selectionPopupPoint, setSelectionPopupPoint] = React.useState<{
    arrowX: number;
    placement: "above" | "below";
    x: number;
    y: number;
    yOffset: number;
  } | null>(null);
  const [selectionPopoverPosition, setSelectionPopoverPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [selectionPopoverDragging, setSelectionPopoverDragging] = React.useState(false);
  const [hoveredObjectId, setHoveredObjectId] = React.useState<string | undefined>();
  const [zoneDraftPoints, setZoneDraftPoints] = React.useState<Array<{ lat: number; lon: number }>>([]);
  const [sketchDraftPoints, setSketchDraftPoints] = React.useState<Array<{ lat: number; lon: number }>>([]);
  const [selectedSharedLiveLocationId, setSelectedSharedLiveLocationId] = React.useState<string | null>(null);

  React.useEffect(
    () => () => {
      nativeHeadingStopRef.current?.();
      nativeHeadingStopRef.current = null;
    },
    []
  );
  const [selectedEmergencyRouteInfo, setSelectedEmergencyRouteInfo] =
    React.useState<EmergencyRouteSelectionInfo | null>(null);
  const [selectedSketchVertexIndex, setSelectedSketchVertexIndex] = React.useState<number | null>(null);
  const [selectedEditVertexIndex, setSelectedEditVertexIndex] = React.useState<number | null>(null);
  const [sketchToolsExpanded, setSketchToolsExpanded] = React.useState(false);
  const [sketchPalettePosition, setSketchPalettePosition] = React.useState<{ x: number; y: number } | null>(null);
  const [sketchPaletteDragging, setSketchPaletteDragging] = React.useState(false);
  const [dynamicLegendItems, setDynamicLegendItems] = React.useState<DynamicLegendItem[]>([]);
  const [sketchStroke, setSketchStroke] = React.useState(defaultSketchStyle.stroke);
  const [sketchFill, setSketchFill] = React.useState(defaultSketchStyle.fill);
  const [sketchOpacity, setSketchOpacity] = React.useState(defaultSketchStyle.opacity);
  const [sketchLineWidth, setSketchLineWidth] = React.useState(defaultSketchStyle.lineWidth);
  const [sketchFillPattern, setSketchFillPattern] = React.useState<SketchFillPattern>("solid");
  const [sketchSymbol, setSketchSymbol] = React.useState<SketchSymbolPreset>(defaultSketchSymbol);
  const webKitMapRuntime = React.useMemo(() => isWebKitRuntime(), []);
  const sketchStyleSettingsRef = React.useRef({
    fill: defaultSketchStyle.fill,
    lineWidth: defaultSketchStyle.lineWidth,
    opacity: defaultSketchStyle.opacity,
    stroke: defaultSketchStyle.stroke
  });
  const sketchFillPatternRef = React.useRef<SketchFillPattern>("solid");
  const sketchSymbolRef = React.useRef<SketchSymbolPreset>(defaultSketchSymbol);

  const selectedId = selectedObjectId;
  const selectedObject = React.useMemo(
    () => (selectedObjectId ? (objects.find((object) => object.objectId === selectedObjectId) ?? null) : null),
    [objects, selectedObjectId]
  );
  const liveSelectedSituationFeature = React.useMemo(() => {
    const features = situationFeatures?.features ?? [];
    if (selectedSituationFeatureId) {
      const direct = features.find((feature) => feature.properties.featureId === selectedSituationFeatureId);
      if (direct) {
        return direct;
      }
    }
    if (selectedSituationFeatureStableKey) {
      return features.find((feature) => transportSelectionKey(feature) === selectedSituationFeatureStableKey) ?? null;
    }
    return null;
  }, [selectedSituationFeatureId, selectedSituationFeatureStableKey, situationFeatures]);
  const retainedSelectedSituationFeatureRef = React.useRef<SituationFeature | null>(null);
  const selectedSituationFeature =
    liveSelectedSituationFeature ??
    (isTransitVehicleSelectionKey(selectedSituationFeatureStableKey)
      ? retainedSelectedSituationFeatureRef.current
      : null);
  React.useEffect(() => {
    if (liveSelectedSituationFeature) {
      retainedSelectedSituationFeatureRef.current = liveSelectedSituationFeature;
      return;
    }
    if (!isTransitVehicleSelectionKey(selectedSituationFeatureStableKey)) {
      retainedSelectedSituationFeatureRef.current = null;
    }
  }, [liveSelectedSituationFeature, selectedSituationFeatureStableKey]);
  const selectedSketchDrawing = React.useMemo(
    () =>
      selectedSketchDrawingId
        ? (sketchDrawings.find((drawing) => drawing.id === selectedSketchDrawingId) ?? null)
        : null,
    [selectedSketchDrawingId, sketchDrawings]
  );
  const selectedSharedLiveLocation = React.useMemo(
    () =>
      selectedSharedLiveLocationId
        ? (sharedLiveLocations.find((location) => location.shareId === selectedSharedLiveLocationId) ?? null)
        : null,
    [selectedSharedLiveLocationId, sharedLiveLocations]
  );
  const [selectionPopoverCollapsed, setSelectionPopoverCollapsed] = React.useState(false);
  const selectedTransitSelectionKey = React.useMemo(
    () =>
      selectedSituationFeature
        ? (transportSelectionKey(selectedSituationFeature) ?? selectedSituationFeature.properties.featureId)
        : null,
    [selectedSituationFeature]
  );
  const retainedSelectedTransitRouteDetailRef = React.useRef<{
    detail: TransitVehicleDetailResponse;
    key: string;
  } | null>(null);
  React.useEffect(() => {
    if (selectedTransitSelectionKey && selectedTransitRouteDetail) {
      retainedSelectedTransitRouteDetailRef.current = {
        detail: selectedTransitRouteDetail,
        key: selectedTransitSelectionKey
      };
      return;
    }
    if (!selectedTransitSelectionKey) {
      retainedSelectedTransitRouteDetailRef.current = null;
    }
  }, [selectedTransitRouteDetail, selectedTransitSelectionKey]);
  const effectiveSelectedTransitRouteDetail =
    selectedTransitRouteDetail ??
    (selectedTransitSelectionKey && retainedSelectedTransitRouteDetailRef.current?.key === selectedTransitSelectionKey
      ? retainedSelectedTransitRouteDetailRef.current.detail
      : null);
  const selectionCard = React.useMemo(
    () =>
      selectedObject
        ? formatObjectSelectionCard(selectedObject)
        : selectedSituationFeature
          ? formatSituationFeatureSelectionCard(selectedSituationFeature, effectiveSelectedTransitRouteDetail)
          : selectedSketchDrawing
            ? ({
                compactSubtitle: formatSketchDrawingSubtitle(selectedSketchDrawing),
                eyebrow: "Vybraný zákres",
                key: `sketch:${selectedSketchDrawing.id}`,
                metaItems: [],
                subtitle: formatSketchDrawingSubtitle(selectedSketchDrawing),
                title: selectedSketchDrawing.properties.label
              } satisfies MapSelectionCard)
            : selectedSharedLiveLocation
              ? formatSharedLiveLocationSelectionCard(selectedSharedLiveLocation)
              : (selectedEmergencyRouteInfo?.card ?? null),
    [
      effectiveSelectedTransitRouteDetail,
      selectedObject,
      selectedEmergencyRouteInfo?.card,
      selectedSharedLiveLocation,
      selectedSituationFeature,
      selectedSketchDrawing
    ]
  );
  const clearMapSelection = React.useCallback(() => {
    setSelectedSharedLiveLocationId(null);
    setSelectedEmergencyRouteInfo(null);
    onSelectEmergencyRoute?.(null);
    onClearSelection?.();
  }, [onClearSelection, onSelectEmergencyRoute]);
  React.useEffect(() => {
    setSelectionPopoverCollapsed(true);
    setSelectionPopoverPosition(null);
  }, [selectionCard?.key]);
  const selectedAnchorCoordinate = React.useMemo(
    () =>
      selectedObject || selectedSituationFeature || selectedSketchDrawing
        ? selectionAnchorCoordinate(selectedObject, selectedSituationFeature, selectedSketchDrawing)
        : selectedSharedLiveLocation
          ? ([selectedSharedLiveLocation.lon, selectedSharedLiveLocation.lat] as [number, number])
          : (selectedEmergencyRouteInfo?.coordinate ?? null),
    [
      selectedEmergencyRouteInfo?.coordinate,
      selectedObject,
      selectedSharedLiveLocation,
      selectedSituationFeature,
      selectedSketchDrawing
    ]
  );
  const selectedRouteFeatureCollection = React.useMemo(
    () =>
      selectedSituationFeature
        ? selectedTransitRouteToFeatureCollection(
            selectedSituationFeature,
            selectedTransitRouteShapeForMap(selectedTransitRouteShape, effectiveSelectedTransitRouteDetail),
            effectiveSelectedTransitRouteDetail
          )
        : emptySelectedRouteFeatureCollection(),
    [effectiveSelectedTransitRouteDetail, selectedSituationFeature, selectedTransitRouteShape]
  );
  const emergencyRouteFeatureCollection = React.useMemo(
    () => emergencyRouteToFeatureCollection(emergencyRoute),
    [emergencyRoute]
  );
  const positionedObjects = React.useMemo(() => objects.filter(hasPosition), [objects]);
  const featureCollection = React.useMemo(
    () => objectsToTrackFeatureCollection(objects, selectedId, { hoveredObjectId, publicFlightSymbolMode }),
    [hoveredObjectId, objects, publicFlightSymbolMode, selectedId]
  );
  const historyFeatureCollection = React.useMemo(
    () =>
      showHistory
        ? objectsToHistoryFeatureCollection(objects, trackHistory, selectedId, trackHistoryDisplayMode)
        : emptyLineFeatureCollection(),
    [objects, selectedId, showHistory, trackHistory, trackHistoryDisplayMode]
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
  const sharedLiveLocationFeatureCollection = React.useMemo(
    () => sharedLiveLocationsToFeatureCollection(sharedLiveLocations),
    [sharedLiveLocations]
  );
  const aoiRuleFeatureCollection = React.useMemo(() => aoiRulesToFeatureCollection(aoiRules), [aoiRules]);
  const aoiDraftFeatureCollection = React.useMemo(
    () => zoneDraftToFeatureCollection(zoneDraftPoints),
    [zoneDraftPoints]
  );
  const editingZone = React.useMemo(() => findEditableAoiRule(aoiRules, editingZoneId), [aoiRules, editingZoneId]);
  const editingZonePoints = React.useMemo(() => aoiRuleEditablePoints(editingZone), [editingZone]);
  const aoiEditFeatureCollection = React.useMemo(
    () => aoiRuleToEditFeatureCollection(editingZone, selectedEditVertexIndex),
    [editingZone, selectedEditVertexIndex]
  );
  const sketchFeatureCollection = React.useMemo(
    () => sketchDrawingsToFeatureCollection(sketchDrawings, selectedSketchDrawingId),
    [selectedSketchDrawingId, sketchDrawings]
  );
  const sketchDraftFeatureCollection = React.useMemo(
    () => sketchDraftToFeatureCollection(sketchDraftPoints, sketchMode),
    [sketchDraftPoints, sketchMode]
  );
  const sketchEditFeatureCollection = React.useMemo(
    () => sketchDrawingToEditFeatureCollection(selectedSketchDrawing, selectedSketchVertexIndex),
    [selectedSketchDrawing, selectedSketchVertexIndex]
  );
  const alertAreaFeatureCollection = React.useMemo(
    () => (showAlertAreas ? alertAreasToFeatureCollection(alerts) : emptyPolygonFeatureCollection()),
    [alerts, showAlertAreas]
  );
  const situationFeatureCollection = React.useMemo(
    () =>
      situationFeaturesToFeatureCollection(
        situationFeatures,
        selectedSituationFeatureId,
        publicFlightSymbolMode,
        selectedSituationFeatureStableKey
      ),
    [publicFlightSymbolMode, selectedSituationFeatureId, selectedSituationFeatureStableKey, situationFeatures]
  );
  const situationOsmClusterFeatureCollection = React.useMemo(
    () => situationOsmPointsToClusterFeatureCollection(situationFeatureCollection),
    [situationFeatureCollection]
  );
  const hasMobileCoverageFeatures = React.useMemo(
    () =>
      situationFeatureCollection.features.some(
        (feature) => feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network"
      ),
    [situationFeatureCollection]
  );

  aoiRulesRef.current = aoiRules;
  editingZoneIdRef.current = editingZoneId;
  objectsRef.current = objects;
  sharedLiveLocationsRef.current = sharedLiveLocations;
  situationFeaturesRef.current = situationFeatures?.features ?? [];
  onBoundsChangeRef.current = onBoundsChange;
  onSelectObjectRef.current = onSelectObject;
  onSelectSituationFeatureRef.current = onSelectSituationFeature;
  onSelectEmergencyRouteRef.current = onSelectEmergencyRoute;
  onAutoFitChangeRef.current = onAutoFitChange;
  onCancelZoneCreationRef.current = onCancelZoneCreation;
  onCancelZoneEditingRef.current = onCancelZoneEditing;
  onClearSelectionRef.current = onClearSelection;
  onCreateZonePolygonRef.current = onCreateZonePolygon;
  onUpdateZonePolygonRef.current = onUpdateZonePolygon;
  onCreateSketchDrawingRef.current = onCreateSketchDrawing;
  onDeleteSketchDrawingRef.current = onDeleteSketchDrawing;
  onSelectSketchDrawingRef.current = onSelectSketchDrawing;
  onSketchModeChangeRef.current = onSketchModeChange;
  onUpdateSketchDrawingRef.current = onUpdateSketchDrawing;
  onPickReportLocationRef.current = onPickReportLocation;
  onPickRadioPointRef.current = onPickRadioPoint;
  onUserMapInteractionRef.current = onUserMapInteraction;
  onViewChangeRef.current = onViewChange;
  reportLocationPickActiveRef.current = reportLocationPickActive;
  radioPointPickActiveRef.current = radioPointPickActive;
  zoneCreationActiveRef.current = zoneCreationActive;
  sketchDrawingsRef.current = sketchDrawings;
  sketchModeRef.current = sketchMode;
  selectedSketchDrawingIdRef.current = selectedSketchDrawingId;
  sketchStyleSettingsRef.current = {
    fill: sketchFill,
    lineWidth: sketchLineWidth,
    opacity: sketchOpacity,
    stroke: sketchStroke
  };
  sketchFillPatternRef.current = sketchFillPattern;
  sketchSymbolRef.current = sketchSymbol;

  React.useEffect(() => {
    if (!mobileSketchControlsOpen) {
      return;
    }
    setSketchToolsExpanded(false);
    onMapLegendCollapsedChange(true);
  }, [mobileSketchControlsOpen, onMapLegendCollapsedChange]);

  React.useEffect(() => {
    if (
      selectedSharedLiveLocationId &&
      !sharedLiveLocations.some((location) => location.shareId === selectedSharedLiveLocationId)
    ) {
      setSelectedSharedLiveLocationId(null);
    }
  }, [selectedSharedLiveLocationId, sharedLiveLocations]);

  React.useEffect(() => {
    if (
      selectedObjectId ||
      selectedSituationFeatureId ||
      selectedSituationFeatureStableKey ||
      selectedSketchDrawingId
    ) {
      setSelectedSharedLiveLocationId(null);
      setSelectedEmergencyRouteInfo(null);
    }
  }, [selectedObjectId, selectedSituationFeatureId, selectedSituationFeatureStableKey, selectedSketchDrawingId]);

  React.useEffect(() => {
    if (!selectedSketchDrawing) {
      return;
    }
    const style = selectedSketchDrawing.properties.style;
    setSketchStroke(style.stroke || defaultSketchStyle.stroke);
    setSketchFill(style.fill || defaultSketchStyle.fill);
    setSketchOpacity(Number.isFinite(style.opacity) ? style.opacity : defaultSketchStyle.opacity);
    setSketchLineWidth(Number.isFinite(style.lineWidth) ? style.lineWidth : defaultSketchStyle.lineWidth);
    const properties = selectedSketchDrawing.properties.properties ?? {};
    setSketchFillPattern(isSketchFillPattern(properties.fillPattern) ? properties.fillPattern : "solid");
    const symbol = selectedSketchDrawing.properties.symbol;
    const preset =
      sketchSymbolPresets.find(
        (candidate) => candidate.iconId === symbol.iconId && candidate.palette === symbol.palette
      ) ??
      (symbol.sidc ? sketchSymbolPresets.find((candidate) => candidate.sidc === symbol.sidc) : undefined) ??
      defaultSketchSymbol;
    setSketchSymbol(preset);
  }, [selectedSketchDrawing]);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveMapStyle(mapStyleUrl, tileUrl, tileAttribution, tileGlyphsUrl),
      center: initialView?.center ?? defaultCenter,
      zoom: initialView?.zoom ?? defaultZoom,
      bearing: initialView?.bearing ?? 0,
      pitch: initialView?.pitch ?? 0,
      attributionControl: false
    });

    mapRef.current = map;
    setMapTilesReady(false);
    const mapCanvas = map.getCanvas();
    const handleWebGlContextLost = (event: Event) => {
      event.preventDefault();
      setMapError("Safari obnovuje mapový podklad po ztrátě WebGL kontextu.");
    };
    const handleWebGlContextRestored = () => {
      setMapError(null);
      requestMapResize(map);
    };
    const handleMapViewportResume = () => requestMapResize(map);
    const removeMapViewportResumeHandlers = registerMapViewportResumeHandlers(handleMapViewportResume);
    const handleInitialMapIdle = () => {
      setMapTilesReady(true);
      if (!mapStyleUrl) {
        void warmRasterBasemapTileCache(map, tileUrl);
      }
    };
    map.once("idle", handleInitialMapIdle);
    mapCanvas.addEventListener("webglcontextlost", handleWebGlContextLost);
    mapCanvas.addEventListener("webglcontextrestored", handleWebGlContextRestored);
    enableMapInteractions(map);
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    requestMapResize(map);

    const selectRenderedFeature = (
      renderedFeature: NonNullable<MapLayerMouseEvent["features"]>[number] | undefined
    ) => {
      const properties = isRecord(renderedFeature?.properties) ? renderedFeature.properties : {};
      const objectId = stringProperty(properties.objectId);
      const object = objectsRef.current.find((candidate) => candidate.objectId === objectId);
      if (object) {
        setSelectedSharedLiveLocationId(null);
        setSelectedEmergencyRouteInfo(null);
        onSelectEmergencyRouteRef.current?.(null);
        onSelectObjectRef.current(object);
        return true;
      }
      const featureId = stringProperty(properties.featureId);
      const situationFeature = situationFeaturesRef.current.find(
        (candidate) => candidate.properties.featureId === featureId
      );
      if (situationFeature) {
        setSelectedSharedLiveLocationId(null);
        setSelectedEmergencyRouteInfo(null);
        onSelectEmergencyRouteRef.current?.(null);
        onSelectSituationFeatureRef.current(situationFeature);
        return true;
      }
      const drawingId = stringProperty(properties.drawingId);
      const sketchDrawing = sketchDrawingsRef.current.find((candidate) => candidate.id === drawingId);
      if (sketchDrawing) {
        setSelectedSharedLiveLocationId(null);
        setSelectedEmergencyRouteInfo(null);
        onSelectEmergencyRouteRef.current?.(null);
        onSelectSketchDrawingRef.current?.(sketchDrawing);
        return true;
      }
      const shareId = stringProperty(properties.shareId);
      const sharedLiveLocation = sharedLiveLocationsRef.current.find((candidate) => candidate.shareId === shareId);
      if (sharedLiveLocation) {
        onClearSelectionRef.current?.();
        onSelectSketchDrawingRef.current?.(null);
        setSelectedEmergencyRouteInfo(null);
        onSelectEmergencyRouteRef.current?.(null);
        setSelectedSharedLiveLocationId(sharedLiveLocation.shareId);
        return true;
      }
      return false;
    };

    map.on("load", () => {
      void (async () => {
        map.addSource(trackSourceId, {
          type: "geojson",
          data: objectsToTrackFeatureCollection(objectsRef.current, selectedId, {
            publicFlightSymbolMode
          }) as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(trackClusterSourceId, {
          type: "geojson",
          data: objectsToTrackFeatureCollection(objectsRef.current, selectedId, {
            publicFlightSymbolMode
          }) as Parameters<GeoJSONSource["setData"]>[0],
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
        map.addSource(sharedLiveLocationSourceId, {
          type: "geojson",
          data: sharedLiveLocationsToFeatureCollection([]) as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(userAlertRadiusSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(aoiRuleSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(aoiDraftSourceId, {
          type: "geojson",
          data: emptyAoiDraftFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(aoiEditSourceId, {
          type: "geojson",
          data: emptyAoiEditFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(sketchSourceId, {
          type: "geojson",
          data: emptySketchFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(sketchDraftSourceId, {
          type: "geojson",
          data: emptySketchDraftFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(sketchEditSourceId, {
          type: "geojson",
          data: emptySketchEditFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(alertAreaSourceId, {
          type: "geojson",
          data: emptyPolygonFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(situationSourceId, {
          type: "geojson",
          data: emptySituationContextFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(situationOsmClusterSourceId, {
          type: "geojson",
          data: emptySituationContextFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0],
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 44
        });
        map.addSource(selectedTransitRouteSourceId, {
          type: "geojson",
          data: emptySelectedRouteFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        map.addSource(emergencyRouteSourceId, {
          type: "geojson",
          data: emptyEmergencyRouteFeatureCollection() as Parameters<GeoJSONSource["setData"]>[0]
        });
        await registerNatoSymbolImages(map);
        await registerCivilAircraftSymbolImages(map);
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
            "fill-color": [
              "coalesce",
              ["get", "color"],
              ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#38bdf8"]
            ],
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
            "line-color": [
              "coalesce",
              ["get", "color"],
              ["match", ["get", "severity"], "critical", "#ef4444", "warning", "#facc15", "#38bdf8"]
            ],
            "line-dasharray": [3, 2],
            "line-opacity": 0.58,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 1.7, 16, 2.3]
          }
        });

        map.addLayer({
          id: aoiDraftFillLayerId,
          type: "fill",
          source: aoiDraftSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          paint: {
            "fill-color": "#c8f08d",
            "fill-opacity": 0.16
          }
        });

        map.addLayer({
          id: aoiDraftLineLayerId,
          type: "line",
          source: aoiDraftSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#c8f08d",
            "line-dasharray": [2.5, 1.2],
            "line-opacity": 0.9,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 12, 2.6, 16, 3.4]
          }
        });

        map.addLayer({
          id: aoiDraftPointLayerId,
          type: "circle",
          source: aoiDraftSourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#c8f08d",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3.5, 12, 5.2, 16, 7],
            "circle-stroke-color": "#061019",
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: aoiEditMidpointLayerId,
          type: "circle",
          source: aoiEditSourceId,
          filter: ["==", ["get", "kind"], "midpoint"],
          paint: {
            "circle-color": "#38bdf8",
            "circle-opacity": 0.82,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 5.8, 16, 7.5],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.88,
            "circle-stroke-width": 1.8
          }
        });

        map.addLayer({
          id: aoiEditVertexLayerId,
          type: "circle",
          source: aoiEditSourceId,
          filter: ["==", ["get", "kind"], "vertex"],
          paint: {
            "circle-color": ["case", ["get", "selected"], "#ffffff", "#c8f08d"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5.5, 12, 7.4, 16, 9.2],
            "circle-stroke-color": ["case", ["get", "selected"], "#38bdf8", "#061019"],
            "circle-stroke-width": ["case", ["get", "selected"], 3, 2]
          }
        });

        map.addLayer({
          id: sketchFillLayerId,
          type: "fill",
          source: sketchSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          paint: {
            "fill-color": ["coalesce", ["get", "fill"], "#2f80ed"],
            "fill-opacity": [
              "case",
              ["==", ["get", "fillPattern"], "outline"],
              0,
              ["==", ["get", "fillPattern"], "hatch"],
              ["case", ["get", "selected"], 0.18, 0.1],
              ["get", "selected"],
              ["*", ["coalesce", ["get", "opacity"], 0.25], 1.35],
              ["coalesce", ["get", "opacity"], 0.25]
            ]
          }
        });

        map.addLayer({
          id: sketchLineLayerId,
          type: "line",
          source: sketchSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["coalesce", ["get", "stroke"], "#2f80ed"],
            "line-dasharray": [
              "case",
              ["==", ["get", "kind"], "measurement"],
              ["literal", [1.5, 1.2]],
              ["==", ["get", "fillPattern"], "dash"],
              ["literal", [2.2, 1.1]],
              ["==", ["get", "fillPattern"], "hatch"],
              ["literal", [0.8, 0.8]],
              ["literal", [1000, 0.0001]]
            ],
            "line-opacity": 0.9,
            "line-width": [
              "case",
              ["get", "selected"],
              ["+", ["coalesce", ["get", "lineWidth"], 2], 1.4],
              ["coalesce", ["get", "lineWidth"], 2]
            ]
          }
        });

        map.addLayer({
          id: sketchArrowHeadLayerId,
          type: "symbol",
          source: sketchSourceId,
          filter: ["==", ["get", "kind"], "arrowhead"],
          layout: {
            "text-field": "➤",
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 17, 12, 22, 16, 28],
            "text-rotate": ["coalesce", ["get", "bearing"], 0],
            "text-rotation-alignment": "map",
            "text-allow-overlap": true,
            "text-anchor": "center"
          },
          paint: {
            "text-color": ["coalesce", ["get", "stroke"], "#2f80ed"],
            "text-halo-color": "#061019",
            "text-halo-width": 2,
            "text-halo-blur": 0.2
          }
        });

        map.addLayer({
          id: sketchPointLayerId,
          type: "circle",
          source: sketchSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "arrowhead"]],
          paint: {
            "circle-color": ["coalesce", ["get", "fill"], "#2f80ed"],
            "circle-radius": ["case", ["get", "selected"], 11, 8],
            "circle-stroke-color": ["coalesce", ["get", "stroke"], "#ffffff"],
            "circle-stroke-width": ["case", ["get", "selected"], 3, 2]
          }
        });

        map.addLayer({
          id: sketchPointIconLayerId,
          type: "symbol",
          source: sketchSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "arrowhead"]],
          layout: {
            "text-allow-overlap": true,
            "text-anchor": "center",
            "text-field": ["coalesce", ["get", "iconGlyph"], ""],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["case", ["get", "selected"], 16, 13]
          },
          paint: {
            "text-color": "#061019",
            "text-halo-color": "rgba(255,255,255,0.45)",
            "text-halo-width": 0.6
          }
        });

        map.addLayer({
          id: sketchLabelLayerId,
          type: "symbol",
          source: sketchSourceId,
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 13, 16, 15],
            "text-offset": [0, 1.25],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "text-color": ["coalesce", ["get", "stroke"], "#c8f08d"],
            "text-halo-color": "#061019",
            "text-halo-width": 2,
            "text-halo-blur": 0.3
          }
        });

        map.addLayer({
          id: sketchDraftLineLayerId,
          type: "line",
          source: sketchDraftSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#c8f08d",
            "line-dasharray": [2, 1.3],
            "line-opacity": 0.95,
            "line-width": 3
          }
        });

        map.addLayer({
          id: sketchDraftPointLayerId,
          type: "circle",
          source: sketchDraftSourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#c8f08d",
            "circle-radius": 6,
            "circle-stroke-color": "#061019",
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: sketchEditMidpointLayerId,
          type: "circle",
          source: sketchEditSourceId,
          filter: ["==", ["get", "kind"], "midpoint"],
          paint: {
            "circle-color": "#38bdf8",
            "circle-radius": 6,
            "circle-stroke-color": "#061019",
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: sketchEditVertexLayerId,
          type: "circle",
          source: sketchEditSourceId,
          filter: ["==", ["get", "kind"], "vertex"],
          paint: {
            "circle-color": ["case", ["get", "selected"], "#ffffff", "#c8f08d"],
            "circle-radius": ["case", ["get", "selected"], 9, 7],
            "circle-stroke-color": ["case", ["get", "selected"], "#38bdf8", "#061019"],
            "circle-stroke-width": ["case", ["get", "selected"], 3, 2]
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
          id: situationSafetyAlertFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: [
            "all",
            ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
            ["!=", ["get", "weatherForecastArea"], true],
            ["!=", ["get", "weatherGrid"], true],
            ["in", ["get", "safetyAlertLayer"], ["literal", ["warnings", "weather_alerts"]]]
          ],
          paint: {
            "fill-color": [
              "case",
              ["==", ["get", "safetyAlertLayer"], "weather_alerts"],
              [
                "match",
                ["get", "severity"],
                "critical",
                "#f97316",
                "warning",
                "#f59e0b",
                "advisory",
                "#facc15",
                "info",
                "#fde68a",
                "#facc15"
              ],
              [
                "match",
                ["get", "severity"],
                "critical",
                "#b91c1c",
                "warning",
                "#dc2626",
                "advisory",
                "#7c3aed",
                "info",
                "#2563eb",
                "#7c3aed"
              ]
            ],
            "fill-opacity": [
              "case",
              ["get", "selected"],
              0.26,
              ["get", "safetyAlertDimmed"],
              0.08,
              ["match", ["get", "severity"], "critical", 0.22, "warning", 0.2, "advisory", 0.17, 0.15]
            ]
          }
        });

        map.addLayer({
          id: situationFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: [
            "all",
            ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
            ["!=", ["get", "weatherForecastArea"], true],
            ["!=", ["get", "weatherGrid"], true],
            ["!=", ["get", "radioOverlay"], true],
            ["!", ["in", ["get", "safetyAlertLayer"], ["literal", ["warnings", "weather_alerts"]]]]
          ],
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
                "mobile_coverage",
                "#22c55e",
                "mobile_network",
                "#22c55e",
                "traffic",
                "#facc15",
                "boundary_admin",
                "#8cb6d8",
                "fire",
                "#fb923c",
                "warnings",
                "#ef4444",
                "weather_alerts",
                "#facc15",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
              ]
            ],
            "fill-opacity": [
              "case",
              ["==", ["get", "layer"], "mobile_coverage"],
              [
                "case",
                ["get", "stale"],
                ["*", ["coalesce", ["get", "coverageOpacity"], 0.2], 0.5],
                ["coalesce", ["get", "coverageOpacity"], 0.2]
              ],
              ["==", ["get", "layer"], "mobile_network"],
              ["case", ["get", "stale"], 0.08, 0.16],
              ["==", ["get", "boundaryReference"], true],
              ["case", ["get", "stale"], 0.025, 0.055],
              ["==", ["get", "riskFeature"], true],
              ["case", ["get", "stale"], 0.07, 0.18],
              ["get", "stale"],
              0.06,
              0.1
            ]
          }
        });

        map.addLayer({
          id: situationTrailRouteLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "trailRoute"], true],
            ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]]
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["coalesce", ["get", "trailRouteColor"], "#84cc16"],
            "line-dasharray": [
              "case",
              ["==", ["get", "trailRouteMode"], "cycling_route"],
              ["literal", [2.2, 1.2]],
              ["==", ["get", "trailRouteMode"], "mtb_route"],
              ["literal", [1.2, 1]],
              ["literal", [1000, 0.0001]]
            ],
            "line-opacity": ["case", ["get", "stale"], 0.42, 0.86],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.4, 11, 2.1, 14, 3.2, 17, 4.4]
          }
        });

        map.addLayer({
          id: situationTrailRouteLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 11.5,
          filter: [
            "all",
            ["==", ["get", "trailRoute"], true],
            ["has", "trailRouteLabel"],
            ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]]
          ],
          layout: {
            "symbol-placement": "line",
            "text-allow-overlap": false,
            "text-field": ["get", "trailRouteLabel"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-ignore-placement": false,
            "text-size": ["interpolate", ["linear"], ["zoom"], 11.5, 10, 14, 12, 17, 13]
          },
          paint: {
            "text-color": ["coalesce", ["get", "trailRouteColor"], "#84cc16"],
            "text-halo-color": "rgba(6, 12, 17, 0.9)",
            "text-halo-width": 2
          }
        });

        map.addLayer({
          id: situationLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString", "Polygon", "MultiPolygon"]]],
            ["!=", ["get", "trailRoute"], true],
            ["!=", ["get", "weatherForecastArea"], true],
            ["!=", ["get", "weatherGrid"], true],
            ["!=", ["get", "radioOverlay"], true],
            ["!", ["in", ["get", "safetyAlertLayer"], ["literal", ["warnings", "weather_alerts"]]]]
          ],
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
                "mobile_coverage",
                "#22c55e",
                "mobile_network",
                "#22c55e",
                "traffic",
                "#facc15",
                "boundary_admin",
                "#8cb6d8",
                "fire",
                "#fb923c",
                "warnings",
                "#ef4444",
                "weather_alerts",
                "#facc15",
                "flood",
                "#38bdf8",
                "air_quality",
                "#22c55e",
                "#8cb6d8"
              ]
            ],
            "line-dasharray": ["case", ["get", "stale"], ["literal", [2, 1.2]], ["literal", [1000, 0.0001]]],
            "line-opacity": [
              "case",
              ["==", ["get", "layer"], "mobile_coverage"],
              [
                "case",
                ["get", "stale"],
                ["*", ["coalesce", ["get", "coverageLineOpacity"], 0.62], 0.68],
                ["coalesce", ["get", "coverageLineOpacity"], 0.62]
              ],
              ["==", ["get", "layer"], "mobile_network"],
              ["case", ["get", "stale"], 0.26, 0.38],
              ["==", ["get", "boundaryReference"], true],
              ["case", ["get", "stale"], 0.36, 0.64],
              ["get", "stale"],
              0.48,
              0.76
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              [
                "case",
                ["==", ["get", "boundaryReference"], true],
                ["case", ["<=", ["coalesce", ["get", "adminLevel"], 99], 2], 1.8, 1.2],
                ["==", ["get", "layer"], "mobile_network"],
                0.65,
                1.1
              ],
              12,
              [
                "case",
                ["==", ["get", "boundaryReference"], true],
                ["case", ["<=", ["coalesce", ["get", "adminLevel"], 99], 2], 2.8, 1.9],
                ["==", ["get", "layer"], "mobile_network"],
                1.05,
                1.8
              ],
              16,
              [
                "case",
                ["==", ["get", "boundaryReference"], true],
                ["case", ["<=", ["coalesce", ["get", "adminLevel"], 99], 2], 3.4, 2.4],
                ["==", ["get", "layer"], "mobile_network"],
                1.45,
                2.6
              ]
            ]
          }
        });

        map.addLayer({
          id: situationRadioFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "radioOverlay"], true],
            ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]]
          ],
          paint: {
            "fill-color": ["coalesce", ["get", "radioFillColor"], ["get", "situationStatusColor"], "#38bdf8"],
            "fill-opacity": [
              "case",
              ["get", "selected"],
              ["min", 0.42, ["*", ["coalesce", ["get", "radioFillOpacity"], 0.18], 1.55]],
              ["coalesce", ["get", "radioFillOpacity"], 0.18]
            ]
          }
        });

        map.addLayer({
          id: situationRadioLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "radioOverlay"], true],
            ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]]
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": ["coalesce", ["get", "radioLineColor"], ["get", "situationStatusColor"], "#38bdf8"],
            "line-dasharray": [
              "case",
              ["==", ["get", "radioOverlayKind"], "input"],
              ["literal", [2.2, 1.2]],
              ["literal", [1000, 0.0001]]
            ],
            "line-opacity": ["case", ["get", "selected"], 0.96, ["coalesce", ["get", "radioLineOpacity"], 0.78]],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 2.6, 1.2],
              12,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 3.8, 2.2],
              16,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 5.2, 3.4]
            ]
          }
        });

        map.addLayer({
          id: selectedTransitRouteLineLayerId,
          type: "line",
          source: selectedTransitRouteSourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#0f7fa7",
            "line-opacity": 0.88,
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4.5, 13, 7.5, 17, 10.5],
            "line-blur": 0.2
          }
        });

        map.addLayer({
          id: selectedTransitRouteStopLayerId,
          type: "circle",
          source: selectedTransitRouteSourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#ffffff",
            "circle-opacity": 0.92,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 13, 4.5, 17, 6.5],
            "circle-stroke-color": "#0f7fa7",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 13, 2.2, 17, 3]
          }
        });

        map.addLayer({
          id: selectedTransitRouteStopLabelLayerId,
          type: "symbol",
          source: selectedTransitRouteSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "route-stop"], ["has", "label"]],
          layout: {
            "text-allow-overlap": false,
            "text-anchor": "top",
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-ignore-placement": false,
            "text-offset": [0, 1.08],
            "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 14, 11, 17, 12]
          },
          paint: {
            "text-color": "#07111a",
            "text-halo-blur": 0.6,
            "text-halo-color": "rgba(255, 255, 255, 0.94)",
            "text-halo-width": 2.2
          }
        });

        map.addLayer({
          id: emergencyRouteFillLayerId,
          type: "fill",
          source: emergencyRouteSourceId,
          filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
          paint: {
            "fill-color": "#22c55e",
            "fill-opacity": ["case", ["==", ["get", "role"], "isochrone"], 0.2, 0.14],
            "fill-outline-color": "#047857"
          }
        });

        map.addLayer({
          id: emergencyRouteLineCasingLayerId,
          type: "line",
          source: emergencyRouteSourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#f8fafc",
            "line-opacity": 0.92,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 7, 13, 10.5, 17, 14]
          }
        });

        map.addLayer({
          id: emergencyRouteLineLayerId,
          type: "line",
          source: emergencyRouteSourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "qualityMode"], "direct_fallback"],
              "#64748b",
              ["==", ["get", "role"], "alternative"],
              "#0ea5e9",
              "#dc2626"
            ],
            "line-dasharray": [
              "case",
              ["==", ["get", "qualityMode"], "direct_fallback"],
              ["literal", [0.8, 1.2]],
              ["==", ["get", "role"], "alternative"],
              ["literal", [1.6, 1.1]],
              ["literal", [1000, 0.0001]]
            ],
            "line-opacity": ["case", ["==", ["get", "role"], "alternative"], 0.74, 0.94],
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 13, 7.2, 17, 10]
          }
        });

        map.addLayer({
          id: emergencyRoutePointLayerId,
          type: "circle",
          source: emergencyRouteSourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": [
              "case",
              ["==", ["get", "role"], "origin"],
              "#16a34a",
              ["==", ["get", "role"], "incident"],
              "#f59e0b",
              ["==", ["get", "role"], "access"],
              "#0ea5e9",
              "#dc2626"
            ],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 13, 6.5, 17, 9],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 8, 1.6, 13, 2.4, 17, 3.2]
          }
        });

        map.addLayer({
          id: emergencyRoutePointLabelLayerId,
          type: "symbol",
          source: emergencyRouteSourceId,
          filter: ["==", ["geometry-type"], "Point"],
          layout: {
            "text-allow-overlap": false,
            "text-anchor": "top",
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-offset": [0, 1.15],
            "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 12, 17, 13]
          },
          paint: {
            "text-color": "#111827",
            "text-halo-blur": 0.7,
            "text-halo-color": "rgba(255, 255, 255, 0.94)",
            "text-halo-width": 2.4
          }
        });

        map.addLayer({
          id: situationSafetyAlertLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]],
            ["!=", ["get", "weatherForecastArea"], true],
            ["!=", ["get", "weatherGrid"], true],
            ["in", ["get", "safetyAlertLayer"], ["literal", ["warnings", "weather_alerts"]]]
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "safetyAlertLayer"], "weather_alerts"],
              [
                "match",
                ["get", "severity"],
                "critical",
                "#ea580c",
                "warning",
                "#d97706",
                "advisory",
                "#ca8a04",
                "info",
                "#facc15",
                "#ca8a04"
              ],
              [
                "match",
                ["get", "severity"],
                "critical",
                "#991b1b",
                "warning",
                "#b91c1c",
                "advisory",
                "#6d28d9",
                "info",
                "#1d4ed8",
                "#6d28d9"
              ]
            ],
            "line-opacity": ["case", ["get", "selected"], 0.98, ["get", "safetyAlertDimmed"], 0.38, 0.88],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              ["case", ["get", "selected"], 3, 2],
              12,
              ["case", ["get", "selected"], 3.5, 2.4],
              16,
              ["case", ["get", "selected"], 4, 2.9]
            ]
          }
        });

        map.addLayer({
          id: situationWeatherForecastFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "weatherForecastArea"], true],
            ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]]
          ],
          paint: {
            "fill-color": ["coalesce", ["get", "weatherForecastFillColor"], "#38bdf8"],
            "fill-opacity": ["case", ["get", "selected"], 0.32, ["get", "stale"], 0.08, 0.2]
          }
        });

        map.addLayer({
          id: situationWeatherForecastLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "weatherForecastArea"], true],
            ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]]
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": [
              "coalesce",
              ["get", "weatherForecastLineColor"],
              ["get", "weatherForecastFillColor"],
              "#38bdf8"
            ],
            "line-opacity": ["case", ["get", "selected"], 0.98, ["get", "stale"], 0.42, 0.78],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              ["case", ["get", "selected"], 2.6, 1.2],
              12,
              ["case", ["get", "selected"], 3.4, 1.8],
              16,
              ["case", ["get", "selected"], 4.2, 2.4]
            ]
          }
        });

        map.addLayer({
          id: situationWeatherForecastIconLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 5,
          filter: ["all", ["==", ["get", "weatherForecastArea"], true], ["has", "weatherForecastSymbolKey"]],
          layout: {
            "icon-image": ["get", "weatherForecastSymbolKey"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.36, 10, 0.5, 14, 0.64],
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-optional": true,
            "symbol-sort-key": ["-", ["coalesce", ["get", "weatherForecastRiskScore"], 0]]
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.52, 0.92]
          }
        });

        map.addLayer({
          id: situationWeatherForecastLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 7,
          filter: ["all", ["==", ["get", "weatherForecastArea"], true], ["has", "weatherForecastLabel"]],
          layout: {
            "text-field": ["get", "weatherForecastLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 9, 10, 11, 14, 13],
            "text-offset": [0, 1.35],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true,
            "symbol-sort-key": ["-", ["coalesce", ["get", "weatherForecastRiskScore"], 0]]
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "rgba(6, 16, 25, 0.92)",
            "text-halo-width": 1.8,
            "text-halo-blur": 0.3
          }
        });

        map.addLayer({
          id: situationWeatherGridFillLayerId,
          type: "fill",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "weatherGrid"], true],
            ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]]
          ],
          paint: {
            "fill-color": ["coalesce", ["get", "weatherFillColor"], ["get", "situationStatusColor"], "#38bdf8"],
            "fill-opacity": [
              "case",
              ["get", "stale"],
              ["*", ["coalesce", ["get", "weatherFillOpacity"], 0.24], 0.52],
              ["coalesce", ["get", "weatherFillOpacity"], 0.24]
            ]
          }
        });

        map.addLayer({
          id: situationWeatherGridLineLayerId,
          type: "line",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["get", "weatherGrid"], true],
            ["in", ["geometry-type"], ["literal", ["LineString", "Polygon", "MultiPolygon"]]]
          ],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": [
              "coalesce",
              ["get", "weatherLineColor"],
              ["get", "weatherFillColor"],
              ["get", "situationStatusColor"],
              "#38bdf8"
            ],
            "line-dasharray": ["case", ["get", "stale"], ["literal", [2, 1.2]], ["literal", [1000, 0.0001]]],
            "line-opacity": ["case", ["get", "stale"], 0.28, 0.48],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.45, 9, 0.8, 13, 1.25]
          }
        });

        map.addLayer({
          id: situationWeatherGridLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 9,
          filter: ["all", ["==", ["get", "weatherGrid"], true], ["has", "weatherMetricLabel"]],
          layout: {
            "text-field": ["get", "weatherMetricLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 9, 13, 11],
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "#061019",
            "text-halo-width": 1.6,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationWeatherPulseLayerId,
          type: "circle",
          source: situationSourceId,
          minzoom: 6,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "weatherPulse"], true]],
          paint: {
            "circle-color": ["coalesce", ["get", "weatherPulseColor"], ["get", "weatherFillColor"], "#38bdf8"],
            "circle-opacity": weatherPulseOpacityExpression(false),
            "circle-radius": weatherPulseRadiusExpression(false),
            "circle-stroke-color": "#e0f7ff",
            "circle-stroke-opacity": ["case", ["get", "stale"], 0.18, 0.54],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 11, 1.4, 14, 2.1],
            "circle-radius-transition": { duration: 1300 },
            "circle-opacity-transition": { duration: 1300 }
          }
        });

        map.addLayer({
          id: situationWeatherHeatLayerId,
          type: "heatmap",
          source: situationSourceId,
          maxzoom: 13,
          minzoom: 5,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            ["has", "weatherTemperatureC"]
          ],
          paint: {
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(14, 165, 233, 0)",
              0.16,
              "rgba(56, 189, 248, 0.24)",
              0.34,
              "rgba(34, 197, 94, 0.28)",
              0.56,
              "rgba(250, 204, 21, 0.34)",
              0.78,
              "rgba(251, 146, 60, 0.38)",
              1,
              "rgba(239, 68, 68, 0.42)"
            ],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.05, 13, 0.7],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 11, 0.56, 13, 0],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 22, 9, 52, 13, 78],
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "weatherTemperatureC"], 10],
              -15,
              0.12,
              0,
              0.26,
              15,
              0.52,
              25,
              0.78,
              35,
              1
            ]
          }
        });

        map.addLayer({
          id: situationAirQualityHeatLayerId,
          type: "heatmap",
          source: situationSourceId,
          maxzoom: 13,
          minzoom: 5,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "airQualityFeature"], true],
            ["has", "airQualityIndex"]
          ],
          paint: {
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(34, 197, 94, 0)",
              0.18,
              "rgba(34, 197, 94, 0.24)",
              0.38,
              "rgba(250, 204, 21, 0.34)",
              0.58,
              "rgba(251, 146, 60, 0.4)",
              0.78,
              "rgba(239, 68, 68, 0.42)",
              1,
              "rgba(168, 85, 247, 0.48)"
            ],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 1.0, 13, 0.72],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 11, 0.54, 13, 0],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 20, 9, 48, 13, 72],
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "airQualityIndex"], 1],
              1,
              0.18,
              2,
              0.38,
              3,
              0.58,
              4,
              0.78,
              5,
              1
            ]
          }
        });

        map.addLayer({
          id: situationPointSelectedLayerId,
          type: "circle",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "selected"], true],
            ["!=", ["get", "mapPointSuppressed"], true]
          ],
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
                "fire",
                "#fb923c",
                "warnings",
                "#ef4444",
                "weather_alerts",
                "#facc15",
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
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["!=", ["get", "mapPointSuppressed"], true],
            ["!=", ["get", "riskFeature"], true],
            ["!=", ["get", "airQualityFeature"], true],
            ["!=", ["get", "weatherObservation"], true],
            ["!=", ["get", "layer"], "weather"],
            ["!=", ["get", "osmPoi"], true],
            ["!=", ["get", "trafficTransit"], true],
            ["!=", ["get", "trafficStaticStop"], true],
            ["any", ["!=", ["get", "layer"], "mobile"], ["==", ["get", "takGateway"], true]]
          ],
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
                  "fire",
                  "#fb923c",
                  "warnings",
                  "#ef4444",
                  "weather_alerts",
                  "#facc15",
                  "flood",
                  "#38bdf8",
                  "air_quality",
                  "#22c55e",
                  "#8cb6d8"
                ]
              ]
            ],
            "circle-opacity": ["case", ["get", "stale"], 0.52, 0.88],
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "mission_state"],
                7,
                ["==", ["get", "missionArenaRole"], "team_state"],
                6,
                ["==", ["get", "missionArenaRole"], "task_state"],
                4,
                5
              ],
              12,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "mission_state"],
                10,
                ["==", ["get", "missionArenaRole"], "team_state"],
                9,
                ["==", ["get", "missionArenaRole"], "task_state"],
                5.5,
                7
              ],
              16,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "mission_state"],
                13,
                ["==", ["get", "missionArenaRole"], "team_state"],
                11,
                ["==", ["get", "missionArenaRole"], "task_state"],
                7,
                10
              ]
            ],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": ["case", ["get", "missionArena"], 2.2, ["get", "stale"], 1, 1.6]
          }
        });

        map.addLayer({
          id: situationRadioPointHaloLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "radioOverlay"], true]],
          paint: {
            "circle-color": ["coalesce", ["get", "radioPointHaloColor"], ["get", "radioPointColor"], "#38bdf8"],
            "circle-opacity": [
              "case",
              ["get", "selected"],
              0.3,
              ["==", ["get", "radioOverlayKind"], "input"],
              0.24,
              0.18
            ],
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["get", "selected"], 16, 12],
              12,
              ["case", ["get", "selected"], 23, 17],
              16,
              ["case", ["get", "selected"], 31, 22]
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": ["case", ["get", "selected"], 0.95, 0.62],
            "circle-stroke-width": ["case", ["get", "selected"], 2.2, 1.4]
          }
        });

        map.addLayer({
          id: situationRadioPointLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "radioOverlay"], true]],
          paint: {
            "circle-color": ["coalesce", ["get", "radioPointColor"], ["get", "situationStatusColor"], "#38bdf8"],
            "circle-opacity": 0.96,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 6, 5],
              12,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 8, 6.5],
              16,
              ["case", ["==", ["get", "radioOverlayKind"], "input"], 10, 8]
            ],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.96,
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: situationRadioLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "radioOverlay"], true],
            ["has", "radioLabel"]
          ],
          layout: {
            "text-field": ["get", "radioLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 11.5, 16, 13],
            "text-offset": [0, 1.35],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true
          },
          paint: {
            "text-color": ["coalesce", ["get", "radioPointColor"], "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.8,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationTrafficSymbolLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "trafficTransit"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "trafficSymbolKey"], getTransitIconKey("traffic")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.28, 12, 0.38, 16, 0.5],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["coalesce", ["get", "trafficRouteShortName"], ["get", "mapLabel"], ["get", "label"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 12, 11, 16, 13],
            "text-offset": [0, 1.05],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.6, 0.96],
            "text-color": [
              "case",
              ["get", "stale"],
              "#facc15",
              ["coalesce", ["get", "situationStatusColor"], "#dff8ff"]
            ],
            "text-halo-color": "#061019",
            "text-halo-width": 1.7,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationTrafficStopHaloLayerId,
          type: "circle",
          source: situationSourceId,
          minzoom: 11,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "trafficStaticStop"], true]],
          paint: {
            "circle-color": "#e0f2fe",
            "circle-opacity": ["case", ["get", "stale"], 0.38, 0.82],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5.2, 14, 6.4, 17, 8.4],
            "circle-stroke-color": "#082f49",
            "circle-stroke-opacity": 0.95,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.1, 15, 1.7]
          }
        });

        map.addLayer({
          id: situationTrafficStopLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 11,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "trafficStaticStop"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "trafficSymbolKey"], getTransitIconKey("stop")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.28, 14, 0.38, 17, 0.52],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": [
              "step",
              ["zoom"],
              "",
              15,
              ["coalesce", ["get", "trafficStopName"], ["get", "mapLabel"], ["get", "label"]]
            ],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 17, 12],
            "text-offset": [0, 1.05],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.52, 0.92],
            "text-color": "#e8f7ff",
            "text-halo-color": "#061019",
            "text-halo-width": 1.6,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationRiskPointLayerId,
          type: "circle",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskFeature"], true],
            ["any", ["!=", ["get", "riskKind"], "flood"], [">=", ["coalesce", ["get", "hydroMapPriority"], 0], 70]]
          ],
          paint: {
            "circle-color": ["coalesce", ["get", "situationStatusColor"], "#fb923c"],
            "circle-opacity": ["case", ["get", "stale"], 0.48, 0.78],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 15, 15, 23],
            "circle-stroke-color": "#f8fafc",
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 12, 2.4, 16, 3]
          }
        });

        map.addLayer({
          id: situationRiskIconLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskFeature"], true],
            ["any", ["!=", ["get", "riskKind"], "flood"], [">=", ["coalesce", ["get", "hydroMapPriority"], 0], 70]]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "riskIconKey"], getRiskIconKey("warning")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.28, 10, 0.38, 15, 0.5],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.72, 0.98]
          }
        });

        map.addLayer({
          id: situationFloodTrendLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["has", "floodTrendIconKey"],
            [">=", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "icon-image": ["get", "floodTrendIconKey"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.2, 10, 0.28, 15, 0.38],
            "icon-anchor": "center",
            "icon-offset": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              ["literal", [22, -22]],
              12,
              ["literal", [30, -30]],
              16,
              ["literal", [36, -36]]
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.72, 0.98]
          }
        });

        map.addLayer({
          id: situationHydroReferenceIconLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 10.3,
          maxzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["<", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "riskIconKey"], getRiskIconKey("flood")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 10.3, 0.22, 12, 0.3, 15, 0.44],
            "icon-anchor": "bottom",
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-optional": true,
            "symbol-sort-key": ["-", ["coalesce", ["get", "hydroMapPriority"], 0]]
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.46, 0.72]
          }
        });

        map.addLayer({
          id: situationHydroReferenceDetailIconLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["<", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "riskIconKey"], getRiskIconKey("flood")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12.2, 0.34, 15, 0.44, 17, 0.52],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-sort-key": ["-", ["coalesce", ["get", "hydroMapPriority"], 0]]
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.5, 0.86]
          }
        });

        map.addLayer({
          id: situationHydroReferenceTrendLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12,
          maxzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["has", "floodTrendIconKey"],
            ["<", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "icon-image": ["get", "floodTrendIconKey"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.22, 15, 0.34],
            "icon-anchor": "center",
            "icon-offset": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              ["literal", [26, -26]],
              16,
              ["literal", [34, -34]]
            ],
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.46, 0.76]
          }
        });

        map.addLayer({
          id: situationHydroReferenceDetailTrendLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["has", "floodTrendIconKey"],
            ["<", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "icon-image": ["get", "floodTrendIconKey"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12.2, 0.26, 15, 0.34, 17, 0.4],
            "icon-anchor": "center",
            "icon-offset": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12.2,
              ["literal", [28, -28]],
              16,
              ["literal", [36, -36]]
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.52, 0.88]
          }
        });

        map.addLayer({
          id: situationHydroReferenceLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskKind"], "flood"],
            ["<", ["coalesce", ["get", "hydroMapPriority"], 0], 70]
          ],
          layout: {
            "text-field": ["coalesce", ["get", "riskMapLabel"], ["get", "mapLabel"], ["get", "label"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 12.2, 9, 14, 11, 16, 12],
            "text-offset": [0, 1.25],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true
          },
          paint: {
            "text-color": "#dff8ff",
            "text-halo-color": "#061019",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.35,
            "text-opacity": ["case", ["get", "stale"], 0.42, 0.78]
          }
        });

        map.addLayer({
          id: situationRiskLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "riskFeature"], true],
            ["any", ["!=", ["get", "riskKind"], "flood"], [">=", ["coalesce", ["get", "hydroMapPriority"], 0], 70]]
          ],
          layout: {
            "text-field": ["coalesce", ["get", "riskMapLabel"], ["get", "mapLabel"], ["get", "label"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 0, 8.5, 0, 10, 11, 13, 12, 16, 14],
            "text-offset": [0, 1.35],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "text-color": ["coalesce", ["get", "situationStatusColor"], "#f8fafc"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.8,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationOsmSymbolLayerId,
          type: "symbol",
          source: situationSourceId,
          maxzoom: 14,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "osmPoi"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "osmSymbolKey"], getOsmCategoryIconKey("other")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.22, 9, 0.3, 12, 0.38, 15, 0.48],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 0, 12, 0, 13, 10, 16, 12],
            "text-offset": [0, 1.35],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              0.72,
              9,
              0.84,
              12,
              ["case", ["get", "stale"], 0.68, 0.94]
            ],
            "text-color": ["case", ["get", "stale"], "#facc15", "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.4
          }
        });

        map.addLayer({
          id: situationOsmDetailSymbolLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 14,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "osmPoi"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "osmSymbolKey"], getOsmCategoryIconKey("other")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.42, 16, 0.5, 18, 0.58],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.68, 0.96]
          }
        });

        map.addLayer({
          id: situationOsmClusterCircleLayerId,
          type: "circle",
          source: situationOsmClusterSourceId,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#7dd3fc", 12, "#a3e635", 36, "#facc15"],
            "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 17, 12, 22, 36, 28, 80, 34],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.9,
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: situationOsmClusterCountLayerId,
          type: "symbol",
          source: situationOsmClusterSourceId,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["step", ["get", "point_count"], 11, 12, 12, 36, 13],
            "text-allow-overlap": true,
            "text-ignore-placement": true
          },
          paint: {
            "text-color": "#061019",
            "text-halo-color": "#eef5fb",
            "text-halo-width": 0.7
          }
        });

        map.addLayer({
          id: situationOsmClusterSymbolLayerId,
          type: "symbol",
          source: situationOsmClusterSourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["coalesce", ["get", "osmSymbolKey"], getOsmCategoryIconKey("other")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.22, 9, 0.3, 12, 0.38, 15, 0.48],
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.68, 0.95]
          }
        });

        map.addLayer({
          id: situationOsmClusterLabelLayerId,
          type: "symbol",
          source: situationOsmClusterSourceId,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 0, 12, 0, 13, 10, 16, 12],
            "text-offset": [0, 1.35],
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
          id: situationLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["!=", ["get", "mapPointSuppressed"], true],
            ["!=", ["get", "riskFeature"], true],
            ["!=", ["get", "airQualityFeature"], true],
            ["!=", ["get", "weatherObservation"], true],
            ["!=", ["get", "layer"], "weather"],
            ["!=", ["get", "osmPoi"], true],
            ["!=", ["get", "trafficTransit"], true],
            ["!=", ["get", "trafficStaticStop"], true],
            ["any", ["!=", ["get", "layer"], "mobile"], ["==", ["get", "takGateway"], true]]
          ],
          layout: {
            "text-field": ["coalesce", ["get", "mapLabel"], ["get", "label"]],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              0,
              10,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "task_state"],
                0,
                ["==", ["get", "missionArenaRole"], "mission_state"],
                11,
                10
              ],
              12,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "task_state"],
                9,
                ["==", ["get", "missionArenaRole"], "mission_state"],
                12,
                11
              ],
              14,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "task_state"],
                10,
                ["==", ["get", "missionArenaRole"], "mission_state"],
                13,
                12
              ],
              16,
              [
                "case",
                ["==", ["get", "missionArenaRole"], "task_state"],
                11,
                ["==", ["get", "missionArenaRole"], "mission_state"],
                13,
                12
              ]
            ],
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
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "layer"], "mobile"],
            ["!=", ["get", "osmPoi"], true],
            ["!=", ["get", "takGateway"], true],
            ["!=", ["get", "radioOverlay"], true]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "mobileSymbolKey"], getMobileNetworkIconKey("unknown")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.26, 11, 0.34, 15, 0.48],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["coalesce", ["get", "mobileNetworkLabel"], "MOBILE"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 0, 10, 0, 12, 11, 15, 13],
            "text-offset": [0, -2.2],
            "text-anchor": "bottom",
            "text-allow-overlap": false,
            "text-optional": true
          },
          paint: {
            "icon-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              ["case", ["get", "stale"], 0.24, 0.42],
              9,
              ["case", ["get", "stale"], 0.38, 0.66],
              12,
              ["case", ["get", "stale"], 0.74, 0.96]
            ],
            "text-color": ["coalesce", ["get", "situationStatusColor"], "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.7,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationWeatherPriorityLayerId,
          type: "symbol",
          source: situationSourceId,
          maxzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            [">=", ["coalesce", ["get", "weatherMapPriority"], 0], 50]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "weatherSymbolKey"], getWeatherConditionIconKey("unknown")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.34, 8, 0.42, 12, 0.54, 16, 0.72],
            "icon-anchor": "bottom",
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-optional": false,
            "symbol-sort-key": ["-", ["coalesce", ["get", "weatherMapPriority"], 0]]
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.72, 0.98]
          }
        });

        map.addLayer({
          id: situationWeatherWindLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 11,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            [">=", ["coalesce", ["get", "weatherWindSpeedMps"], 0], 3]
          ],
          layout: {
            "icon-image": weatherWindIconKey,
            "icon-rotate": ["+", ["coalesce", ["get", "weatherWindDirectionDeg"], 0], 180],
            "icon-rotation-alignment": "map",
            "icon-size": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "weatherWindSpeedMps"], 0],
              0.5,
              0.18,
              5,
              0.3,
              14,
              0.48,
              28,
              0.62
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "center"
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.44, 0.72]
          }
        });

        map.addLayer({
          id: situationWeatherConditionLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 10,
          maxzoom: 12.2,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            ["<", ["coalesce", ["get", "weatherMapPriority"], 0], 50]
          ],
          layout: {
            "icon-image": ["coalesce", ["get", "weatherSymbolKey"], getWeatherConditionIconKey("unknown")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.38, 13, 0.52, 16, 0.66],
            "icon-anchor": "bottom",
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-optional": true
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.62, 0.98]
          }
        });

        map.addLayer({
          id: situationWeatherDetailLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12.2,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "weatherObservation"], true]],
          layout: {
            "icon-image": ["coalesce", ["get", "weatherSymbolKey"], getWeatherConditionIconKey("unknown")],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12.2, 0.5, 16, 0.72, 18, 0.82],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-sort-key": ["-", ["coalesce", ["get", "weatherMapPriority"], 0]]
          },
          paint: {
            "icon-opacity": ["case", ["get", "stale"], 0.66, 0.98]
          }
        });

        map.addLayer({
          id: situationWeatherValueLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 10.5,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            ["has", "weatherValueLabel"]
          ],
          layout: {
            "text-field": ["get", "weatherValueLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 10.5, 10, 13, 11.5, 16, 13],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true,
            "text-offset": [0, 1.18],
            "text-anchor": "top",
            "symbol-sort-key": ["-", ["coalesce", ["get", "weatherMapPriority"], 0]]
          },
          paint: {
            "text-color": ["case", ["get", "stale"], "#facc15", "#f8fafc"],
            "text-halo-color": "rgba(6, 16, 25, 0.94)",
            "text-halo-width": 2,
            "text-halo-blur": 0.25
          }
        });

        map.addLayer({
          id: situationWeatherLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          minzoom: 12.4,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherObservation"], true],
            ["has", "weatherLabel"]
          ],
          layout: {
            "text-field": ["get", "weatherLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 0, 9, 0, 11, 11, 15, 13],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true,
            "text-offset": [0, 2.05],
            "text-anchor": "top"
          },
          paint: {
            "text-color": ["case", ["get", "stale"], "#facc15", "#f8fafc"],
            "text-halo-color": "rgba(6, 16, 25, 0.92)",
            "text-halo-width": 1.6,
            "text-halo-blur": 0.35
          }
        });

        map.addLayer({
          id: situationWeatherCameraSelectedLayerId,
          type: "circle",
          source: situationSourceId,
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "weatherCamera"], true],
            ["==", ["get", "selected"], true]
          ],
          paint: {
            "circle-color": "#38bdf8",
            "circle-opacity": 0.18,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 19, 11, 27, 15, 36],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.95,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 2.4, 11, 3.2, 15, 4.2]
          }
        });

        map.addLayer({
          id: situationWeatherCameraLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "weatherCamera"], true]],
          layout: {
            "icon-image": weatherCameraIconKey,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 11, 0.54, 15, 0.7],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true
          },
          paint: {
            "icon-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              ["case", ["get", "stale"], 0.48, 0.78],
              9.5,
              ["case", ["get", "stale"], 0.56, 0.9],
              11,
              ["case", ["get", "stale"], 0.68, 0.98]
            ]
          }
        });

        map.addLayer({
          id: situationAirQualityPointLayerId,
          type: "circle",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "airQualityFeature"], true]],
          paint: {
            "circle-color": ["coalesce", ["get", "situationStatusColor"], "#22c55e"],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              0,
              9,
              0,
              11,
              ["case", ["get", "stale"], 0.5, 0.82]
            ],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 7, 9, 11, 13, 16, 16, 22],
            "circle-stroke-color": "#061019",
            "circle-stroke-opacity": 0.92,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 12, 2.2, 16, 3]
          }
        });

        map.addLayer({
          id: situationAirQualityLabelLayerId,
          type: "symbol",
          source: situationSourceId,
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "airQualityFeature"], true]],
          layout: {
            "text-field": ["get", "airQualityLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 0, 9, 0, 11, 10, 13, 11, 16, 13],
            "text-allow-overlap": false,
            "text-optional": true,
            "text-offset": [0, 1.35],
            "text-anchor": "top"
          },
          paint: {
            "text-color": ["coalesce", ["get", "situationStatusColor"], "#dff8ff"],
            "text-halo-color": "#061019",
            "text-halo-width": 1.7,
            "text-halo-blur": 0.35
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
          id: trackPredictionUncertaintyLayerId,
          type: "fill",
          source: trackPredictionSourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["case", ["has", "opacity"], ["get", "opacity"], 0.12],
            "fill-outline-color": ["get", "color"]
          }
        });

        map.addLayer({
          id: trackPredictionLayerId,
          type: "line",
          source: trackPredictionSourceId,
          filter: ["==", ["geometry-type"], "LineString"],
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
          id: sharedLiveLocationAccuracyLayerId,
          type: "circle",
          source: sharedLiveLocationSourceId,
          paint: {
            "circle-color": "#f59e0b",
            "circle-opacity": 0.12,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 8, 12, 26, 16, 48],
            "circle-stroke-color": "#fff7ed",
            "circle-stroke-opacity": 0.5,
            "circle-stroke-width": 1
          }
        });

        map.addLayer({
          id: sharedLiveLocationLayerId,
          type: "circle",
          source: sharedLiveLocationSourceId,
          paint: {
            "circle-color": "#f59e0b",
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.4
          }
        });

        map.addLayer({
          id: sharedLiveLocationLabelLayerId,
          type: "symbol",
          source: sharedLiveLocationSourceId,
          layout: {
            "text-anchor": "bottom",
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-offset": [0, -1],
            "text-size": 12
          },
          paint: {
            "text-color": "#7c2d12",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4
          }
        });

        map.addLayer({
          id: trackHoverHaloLayerId,
          type: "circle",
          source: trackSourceId,
          filter: ["all", ["==", ["get", "hovered"], true], ["!=", ["get", "selected"], true]],
          paint: {
            "circle-color": ["get", "symbolColor"],
            "circle-opacity": 0.12,
            "circle-radius": ["case", ["get", "publicFlight"], 24, 18],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.64,
            "circle-stroke-width": 1.8
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
            "circle-radius": ["case", ["get", "publicFlight"], 26, 18],
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
            "text-font": ["Noto Sans Bold"],
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
            "circle-radius": ["case", ["get", "publicFlight"], 26, 18],
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
            "icon-image": ["get", "displaySymbolKey"],
            "icon-size": ["case", ["get", "publicFlight"], 0.52, 0.46],
            "icon-rotate": ["case", ["get", "publicFlight"], ["coalesce", ["get", "aircraftHeadingDeg"], 0], 0],
            "icon-rotation-alignment": "map",
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
            "text-font": ["Noto Sans Regular"],
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
            "icon-image": ["get", "displaySymbolKey"],
            "icon-size": [
              "case",
              ["get", "publicFlight"],
              ["case", ["get", "selected"], 0.68, ["get", "hovered"], 0.62, 0.56],
              0.46
            ],
            "icon-rotate": ["case", ["get", "publicFlight"], ["coalesce", ["get", "aircraftHeadingDeg"], 0], 0],
            "icon-rotation-alignment": "map",
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
            "text-font": ["Noto Sans Regular"],
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
        raiseInteractivePointLayers(map);

        const handleClusterClick = (event: MapLayerMouseEvent) => {
          void zoomToCluster(map, event, trackClusterSourceId, setClusterInfo);
        };
        const handleSituationOsmClusterClick = (event: MapLayerMouseEvent) => {
          void zoomToCluster(map, event, situationOsmClusterSourceId, setClusterInfo);
        };
        map.on("click", trackClusterCircleLayerId, handleClusterClick);
        map.on("click", trackClusterCountLayerId, handleClusterClick);
        map.on("click", situationOsmClusterCircleLayerId, handleSituationOsmClusterClick);
        map.on("click", situationOsmClusterCountLayerId, handleSituationOsmClusterClick);
        const updateAoiEditPoint = (zoneId: string, index: number, lngLat: maplibregl.LngLat) => {
          const rule = findEditableAoiRule(aoiRulesRef.current, zoneId);
          const points = aoiRuleEditablePoints(rule);
          if (!rule || !points[index]) {
            return;
          }
          const nextPoints = points.map((point, pointIndex) =>
            pointIndex === index ? { lat: lngLat.lat, lon: lngLat.lng } : point
          );
          onUpdateZonePolygonRef.current?.(rule.id, nextPoints);
        };
        const finishAoiVertexDrag = () => {
          if (!draggedAoiVertexRef.current) {
            return;
          }
          draggedAoiVertexRef.current = null;
          map.dragPan.enable();
          map.touchZoomRotate.enable();
          map.getCanvas().style.cursor = "";
        };
        const handleAoiVertexDragMove = (
          event: maplibregl.MapMouseEvent | (maplibregl.MapTouchEvent & { lngLat: maplibregl.LngLat })
        ) => {
          const dragged = draggedAoiVertexRef.current;
          if (!dragged) {
            return;
          }
          event.preventDefault();
          updateAoiEditPoint(dragged.zoneId, dragged.index, event.lngLat);
        };
        const handleAoiVertexDragStart = (
          event:
            | MapLayerMouseEvent
            | (maplibregl.MapTouchEvent & { features?: MapLayerMouseEvent["features"]; lngLat: maplibregl.LngLat })
        ) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const zoneId = stringProperty(properties.zoneId);
          const index = numberProperty(properties.index);
          if (!zoneId || index === undefined) {
            return;
          }
          event.preventDefault();
          setSelectedEditVertexIndex(index);
          draggedAoiVertexRef.current = { index, zoneId };
          map.dragPan.disable();
          map.touchZoomRotate.disable();
          map.getCanvas().style.cursor = "grabbing";
        };
        const handleAoiVertexClick = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const index = numberProperty(properties.index);
          if (index !== undefined) {
            event.preventDefault();
            setSelectedEditVertexIndex(index);
          }
        };
        const handleAoiMidpointClick = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const zoneId = stringProperty(properties.zoneId);
          const insertIndex = numberProperty(properties.insertIndex);
          const rule = findEditableAoiRule(aoiRulesRef.current, zoneId ?? editingZoneIdRef.current);
          const points = aoiRuleEditablePoints(rule);
          if (!rule || insertIndex === undefined || points.length < 3) {
            return;
          }
          event.preventDefault();
          const nextPoints = [...points];
          nextPoints.splice(insertIndex, 0, { lat: event.lngLat.lat, lon: event.lngLat.lng });
          onUpdateZonePolygonRef.current?.(rule.id, nextPoints);
          setSelectedEditVertexIndex(insertIndex);
        };
        map.on("mousedown", aoiEditVertexLayerId, handleAoiVertexDragStart);
        map.on("touchstart", aoiEditVertexLayerId, handleAoiVertexDragStart);
        map.on("click", aoiEditVertexLayerId, handleAoiVertexClick);
        map.on("click", aoiEditMidpointLayerId, handleAoiMidpointClick);
        map.on("mousemove", handleAoiVertexDragMove);
        map.on("touchmove", handleAoiVertexDragMove);
        map.on("mouseup", finishAoiVertexDrag);
        map.on("touchend", finishAoiVertexDrag);
        map.on("touchcancel", finishAoiVertexDrag);
        map.on("mouseenter", aoiEditVertexLayerId, () => {
          map.getCanvas().style.cursor = "grab";
        });
        map.on("mouseenter", aoiEditMidpointLayerId, () => {
          map.getCanvas().style.cursor = "copy";
        });
        map.on("mouseleave", aoiEditVertexLayerId, () => {
          if (!draggedAoiVertexRef.current) {
            map.getCanvas().style.cursor = "";
          }
        });
        map.on("mouseleave", aoiEditMidpointLayerId, () => {
          if (!draggedAoiVertexRef.current) {
            map.getCanvas().style.cursor = "";
          }
        });
        const updateSketchEditPoint = (drawingId: string, index: number, lngLat: maplibregl.LngLat) => {
          const drawing = sketchDrawingsRef.current.find((candidate) => candidate.id === drawingId);
          const points = sketchEditablePoints(drawing ?? null);
          if (!drawing || !points[index]) {
            return;
          }
          const nextPoints = points.map((point, pointIndex) =>
            pointIndex === index ? { lat: lngLat.lat, lon: lngLat.lng } : point
          );
          const geometry = sketchGeometryFromPoints(drawing.properties.kind, nextPoints);
          if (geometry) {
            onUpdateSketchDrawingRef.current?.(drawing.id, { geometry });
          }
        };
        const finishSketchVertexDrag = () => {
          if (!draggedSketchVertexRef.current) {
            return;
          }
          draggedSketchVertexRef.current = null;
          if (
            !mapInteractionSuspended &&
            sketchModeRef.current !== "line" &&
            sketchModeRef.current !== "polygon" &&
            sketchModeRef.current !== "measurement"
          ) {
            map.dragPan.enable();
          }
          map.touchZoomRotate.enable();
          map.getCanvas().style.cursor = "";
        };
        const handleSketchVertexDragMove = (
          event: maplibregl.MapMouseEvent | (maplibregl.MapTouchEvent & { lngLat: maplibregl.LngLat })
        ) => {
          const dragged = draggedSketchVertexRef.current;
          if (!dragged) {
            return;
          }
          event.preventDefault();
          updateSketchEditPoint(dragged.drawingId, dragged.index, event.lngLat);
        };
        const handleSketchVertexDragStart = (
          event:
            | MapLayerMouseEvent
            | (maplibregl.MapTouchEvent & { features?: MapLayerMouseEvent["features"]; lngLat: maplibregl.LngLat })
        ) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const drawingId = stringProperty(properties.drawingId);
          const index = numberProperty(properties.index);
          if (!drawingId || index === undefined) {
            return;
          }
          event.preventDefault();
          setSelectedSketchVertexIndex(index);
          draggedSketchVertexRef.current = { drawingId, index };
          map.dragPan.disable();
          map.touchZoomRotate.disable();
          map.getCanvas().style.cursor = "grabbing";
        };
        const handleSketchVertexClick = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const index = numberProperty(properties.index);
          if (index !== undefined) {
            event.preventDefault();
            setSelectedSketchVertexIndex(index);
          }
        };
        const handleSketchMidpointClick = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = isRecord(feature?.properties) ? feature.properties : {};
          const drawingId = stringProperty(properties.drawingId);
          const insertIndex = numberProperty(properties.insertIndex);
          const drawing = sketchDrawingsRef.current.find(
            (candidate) => candidate.id === (drawingId ?? selectedSketchDrawingIdRef.current)
          );
          const points = sketchEditablePoints(drawing ?? null);
          if (!drawing || insertIndex === undefined || points.length < 2) {
            return;
          }
          event.preventDefault();
          const nextPoints = [...points];
          nextPoints.splice(insertIndex, 0, { lat: event.lngLat.lat, lon: event.lngLat.lng });
          const geometry = sketchGeometryFromPoints(drawing.properties.kind, nextPoints);
          if (geometry) {
            onUpdateSketchDrawingRef.current?.(drawing.id, { geometry });
            setSelectedSketchVertexIndex(insertIndex);
          }
        };
        map.on("mousedown", sketchEditVertexLayerId, handleSketchVertexDragStart);
        map.on("touchstart", sketchEditVertexLayerId, handleSketchVertexDragStart);
        map.on("click", sketchEditVertexLayerId, handleSketchVertexClick);
        map.on("click", sketchEditMidpointLayerId, handleSketchMidpointClick);
        map.on("mousemove", handleSketchVertexDragMove);
        map.on("touchmove", handleSketchVertexDragMove);
        map.on("mouseup", finishSketchVertexDrag);
        map.on("touchend", finishSketchVertexDrag);
        map.on("touchcancel", finishSketchVertexDrag);
        map.on("mouseenter", sketchEditVertexLayerId, () => {
          map.getCanvas().style.cursor = "grab";
        });
        map.on("mouseenter", sketchEditMidpointLayerId, () => {
          map.getCanvas().style.cursor = "copy";
        });
        map.on("mouseleave", sketchEditVertexLayerId, () => {
          if (!draggedSketchVertexRef.current) {
            map.getCanvas().style.cursor = "";
          }
        });
        map.on("mouseleave", sketchEditMidpointLayerId, () => {
          if (!draggedSketchVertexRef.current) {
            map.getCanvas().style.cursor = "";
          }
        });
        const handleUserMapInteraction = (event: maplibregl.MapLibreEvent) => {
          if (event.originalEvent) {
            onAutoFitChangeRef.current(false);
            onUserMapInteractionRef.current?.();
          }
        };
        const handleMapClick = (event: maplibregl.MapMouseEvent) => {
          if (reportLocationPickActiveRef.current && onPickReportLocationRef.current) {
            onPickReportLocationRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
            return;
          }
          if (radioPointPickActiveRef.current && onPickRadioPointRef.current) {
            onPickRadioPointRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
            return;
          }
          const activeSketchMode = sketchModeRef.current;
          if (activeSketchMode === "marker" || activeSketchMode === "text") {
            const kind: SketchDrawingKind = activeSketchMode === "text" ? "text" : "marker";
            const preset =
              activeSketchMode === "text"
                ? (sketchSymbolPresets.find((candidate) => candidate.iconId === "note") ?? defaultSketchSymbol)
                : sketchSymbolRef.current;
            const style = sketchStyleSettingsRef.current;
            onCreateSketchDrawingRef.current?.({
              geometry: { coordinates: [event.lngLat.lng, event.lngLat.lat], type: "Point" },
              kind,
              label: activeSketchMode === "text" ? "Popisek" : preset.label,
              properties: { createdFrom: "map", fillPattern: sketchFillPatternRef.current, shape: preset.shape },
              style,
              symbol: sketchPresetToSymbolInput(preset),
              visibility: "private"
            });
            onSketchModeChangeRef.current?.("select");
            return;
          }
          if (isSketchDraftMode(activeSketchMode)) {
            setSketchDraftPoints((current) =>
              [...current, { lat: event.lngLat.lat, lon: event.lngLat.lng }].slice(0, 200)
            );
            return;
          }
          if (zoneCreationActiveRef.current) {
            setZoneDraftPoints((current) =>
              [...current, { lat: event.lngLat.lat, lon: event.lngLat.lng }].slice(0, 80)
            );
            return;
          }
          if (activeSketchMode === "select") {
            const clickedSketchEditHandle = queryRenderedFeatureByLayerPriority(map, event.point, [
              sketchEditVertexLayerId,
              sketchEditMidpointLayerId
            ]);
            if (clickedSketchEditHandle) {
              return;
            }
            const clickedSketch = queryRenderedFeatureByLayerPriority(map, event.point, [
              sketchPointIconLayerId,
              sketchPointLayerId,
              sketchLabelLayerId,
              sketchLineLayerId,
              sketchFillLayerId
            ]);
            const properties = isRecord(clickedSketch?.properties) ? clickedSketch.properties : {};
            const drawingId = stringProperty(properties.drawingId);
            const drawing = sketchDrawingsRef.current.find((candidate) => candidate.id === drawingId);
            if (drawing) {
              setSelectedSharedLiveLocationId(null);
              setSelectedEmergencyRouteInfo(null);
              onSelectEmergencyRouteRef.current?.(null);
              onSelectSketchDrawingRef.current?.(drawing);
              return;
            }
            setSelectedSketchVertexIndex(null);
            setSelectedSharedLiveLocationId(null);
            setSelectedEmergencyRouteInfo(null);
            onSelectEmergencyRouteRef.current?.(null);
            onSelectSketchDrawingRef.current?.(null);
            return;
          }
          if (editingZoneIdRef.current) {
            const clickedEditHandle = queryRenderedFeatureByLayerPriority(map, event.point, [
              aoiEditVertexLayerId,
              aoiEditMidpointLayerId
            ]);
            if (clickedEditHandle) {
              return;
            }
            setSelectedEditVertexIndex(null);
            return;
          }
          const clickedCluster = queryRenderedFeatureByLayerPriority(map, event.point, mapClusterClickLayerIds);
          if (clickedCluster) {
            return;
          }
          const clickedEmergencyRoute = queryRenderedFeatureByLayerPriority(map, event.point, [
            emergencyRoutePointLayerId,
            emergencyRouteLineLayerId,
            emergencyRouteFillLayerId
          ]);
          if (clickedEmergencyRoute) {
            event.preventDefault();
            const properties = isRecord(clickedEmergencyRoute.properties) ? clickedEmergencyRoute.properties : {};
            const routeSelection = emergencyRouteSelectionContext(properties, emergencyRoute);
            const routeInfo: EmergencyRouteSelectionInfo = {
              canActivate: routeSelection.canActivate,
              card: formatEmergencyRouteSelectionCard(properties, emergencyRoute),
              coordinate: [event.lngLat.lng, event.lngLat.lat],
              routeId: routeSelection.routeId
            };
            setSelectedSharedLiveLocationId(null);
            onClearSelectionRef.current?.();
            setSelectedEmergencyRouteInfo(routeInfo);
            onSelectEmergencyRouteRef.current?.(routeInfo);
            return;
          }
          const clickedFeature = queryRenderedFeatureByLayerPriority(map, event.point, mapFeatureClickPriorityLayerIds);
          if (selectRenderedFeature(clickedFeature)) {
            setSelectedEmergencyRouteInfo(null);
            return;
          }
          setSelectedSharedLiveLocationId(null);
          setSelectedEmergencyRouteInfo(null);
          onSelectEmergencyRouteRef.current?.(null);
          onClearSelectionRef.current?.();
        };
        map.on("dragstart", handleUserMapInteraction);
        map.on("movestart", handleUserMapInteraction);
        map.on("pitchstart", handleUserMapInteraction);
        map.on("rotatestart", handleUserMapInteraction);
        map.on("zoomstart", handleUserMapInteraction);
        map.on("click", handleMapClick);
        const updateMapBearing = () => setMapBearingDeg(normalizeCompassDegrees(map.getBearing()));
        const handleMoveEnd = () => {
          updateMapBearing();
          emitMapViewport(map, onViewChangeRef, onBoundsChangeRef);
        };
        map.on("rotate", updateMapBearing);
        map.on("moveend", handleMoveEnd);
        const handleTrackHover = (event: MapLayerMouseEvent) => {
          const objectId = event.features?.[0]?.properties?.objectId as string | undefined;
          if (objectId) {
            setHoveredObjectId(objectId);
          }
          map.getCanvas().style.cursor = "pointer";
        };
        const handleTrackLeave = () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "";
        };
        map.on("mouseenter", trackSymbolLayerId, handleTrackHover);
        map.on("mousemove", trackSymbolLayerId, handleTrackHover);
        map.on("mouseenter", trackLabelLayerId, handleTrackHover);
        map.on("mousemove", trackLabelLayerId, handleTrackHover);
        map.on("mouseenter", trackClusterSymbolLayerId, handleTrackHover);
        map.on("mousemove", trackClusterSymbolLayerId, handleTrackHover);
        map.on("mouseenter", trackClusterLabelLayerId, handleTrackHover);
        map.on("mousemove", trackClusterLabelLayerId, handleTrackHover);
        map.on("mouseenter", sharedLiveLocationLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", sharedLiveLocationLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", sharedLiveLocationAccuracyLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", trackClusterCircleLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", trackClusterCountLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", situationOsmClusterCircleLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", situationOsmClusterCountLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "zoom-in";
        });
        map.on("mouseenter", situationOsmClusterSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationOsmClusterLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationOsmSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationOsmDetailSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationMobileSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRadioPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRadioLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRadioLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRadioFillLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationTrafficSymbolLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationTrafficStopLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRiskPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRiskIconLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationFloodTrendLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationHydroReferenceIconLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationHydroReferenceTrendLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationHydroReferenceDetailIconLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationHydroReferenceDetailTrendLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationHydroReferenceLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationRiskLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherPriorityLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherConditionLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherDetailLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherWindLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherValueLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherCameraSelectedLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherCameraLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherForecastIconLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherForecastLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherForecastLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationWeatherForecastFillLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationAirQualityPointLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationAirQualityLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationSafetyAlertLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationSafetyAlertFillLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationTrailRouteLabelLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationTrailRouteLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationLineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseenter", situationFillLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", trackSymbolLayerId, handleTrackLeave);
        map.on("mouseleave", trackLabelLayerId, handleTrackLeave);
        map.on("mouseleave", sharedLiveLocationLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", sharedLiveLocationLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", sharedLiveLocationAccuracyLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterCircleLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterCountLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmClusterCircleLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmClusterCountLayerId, () => {
          setHoveredObjectId(undefined);
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmClusterSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmClusterLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", trackClusterSymbolLayerId, handleTrackLeave);
        map.on("mouseleave", trackClusterLabelLayerId, handleTrackLeave);
        map.on("mouseleave", situationPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationOsmDetailSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationMobileSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRadioPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRadioLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRadioLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRadioFillLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationTrafficSymbolLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationTrafficStopLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRiskPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRiskIconLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationFloodTrendLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationHydroReferenceIconLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationHydroReferenceTrendLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationHydroReferenceDetailIconLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationHydroReferenceDetailTrendLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationHydroReferenceLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationRiskLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherPriorityLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherConditionLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherDetailLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherWindLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherValueLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherCameraSelectedLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherCameraLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherForecastIconLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherForecastLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherForecastLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationWeatherForecastFillLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationAirQualityPointLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationAirQualityLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationSafetyAlertLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationSafetyAlertFillLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationTrailRouteLabelLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationTrailRouteLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationLineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseleave", situationFillLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
        setMapReady(true);
        requestMapResize(map);
        updateMapBearing();
        emitMapViewport(map, onViewChangeRef, onBoundsChangeRef);
      })().catch((error: unknown) => {
        setMapError(error instanceof Error ? error.message : "NATO symboly nejsou dostupné.");
      });
    });
    map.on("error", (event) => {
      const message = event.error?.message ?? "Mapový podklad není dostupný.";
      if (isRecoverableMapError(message)) {
        return;
      }
      setMapError(message);
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      removeMapViewportResumeHandlers();
      map.off("idle", handleInitialMapIdle);
      mapCanvas.removeEventListener("webglcontextlost", handleWebGlContextLost);
      mapCanvas.removeEventListener("webglcontextrestored", handleWebGlContextRestored);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!mapReady || !containerRef.current || typeof ResizeObserver === "undefined" || mapResizeSuspended) {
      return;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      if (mapRef.current) {
        requestMapResize(mapRef.current);
      }
    });
    resizeObserverRef.current.observe(containerRef.current);
    if (mapRef.current) {
      requestMapResize(mapRef.current);
    }
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [mapReady, mapResizeSuspended]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    applyBasemapMode(map, mapBasemapMode, { webKitRuntime: webKitMapRuntime });
  }, [mapBasemapMode, mapReady, webKitMapRuntime]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(userLocationSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(
        userLocationToFeatureCollection(userLocation) as Parameters<GeoJSONSource["setData"]>[0]
      );
    }
  }, [mapReady, userLocation]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(sharedLiveLocationSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(sharedLiveLocationFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, sharedLiveLocationFeatureCollection]);

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
    const source = mapRef.current?.getSource(aoiDraftSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(aoiDraftFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [aoiDraftFeatureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(aoiEditSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(aoiEditFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [aoiEditFeatureCollection, mapReady]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(sketchSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(sketchFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, sketchFeatureCollection]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(sketchDraftSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(sketchDraftFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, sketchDraftFeatureCollection]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(sketchEditSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(sketchEditFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, sketchEditFeatureCollection]);

  React.useEffect(() => {
    if (!zoneCreationActive) {
      setZoneDraftPoints([]);
    }
  }, [zoneCreationActive]);

  React.useEffect(() => {
    setSelectedEditVertexIndex(null);
    draggedAoiVertexRef.current = null;
  }, [editingZoneId]);

  React.useEffect(() => {
    if (sketchMode !== "line" && sketchMode !== "polygon" && sketchMode !== "measurement") {
      setSketchDraftPoints([]);
    }
    if (sketchMode !== "select") {
      setSelectedSketchVertexIndex(null);
    }
  }, [sketchMode]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    const drawingMode = isSketchDraftMode(sketchMode) || sketchMode === "marker" || sketchMode === "text";
    if (drawingMode) {
      map.dragPan.disable();
    } else if (!mapInteractionSuspended && !draggedAoiVertexRef.current && !draggedSketchVertexRef.current) {
      map.dragPan.enable();
    }
  }, [mapInteractionSuspended, mapReady, sketchMode]);

  React.useEffect(() => {
    setSelectedSketchVertexIndex(null);
    draggedSketchVertexRef.current = null;
  }, [selectedSketchDrawingId]);

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
    const source = mapRef.current?.getSource(situationOsmClusterSourceId);
    if (mapReady && source && "setData" in source) {
      const clusterData = clusterTracks
        ? situationOsmClusterFeatureCollection
        : emptySituationContextFeatureCollection();
      (source as GeoJSONSource).setData(clusterData as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [clusterTracks, mapReady, situationOsmClusterFeatureCollection]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      setDynamicLegendItems([]);
      return undefined;
    }
    let frameId: number | null = null;
    const updateLegend = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const containerRect = containerRef.current?.getBoundingClientRect();
        const limit = visibleLegendLimitForMapSize(containerRect?.width ?? 0, containerRect?.height ?? 0);
        const layers = dynamicLegendLayerIds.filter((layerId) => Boolean(map.getLayer(layerId)));
        const renderedFeatures = layers.length > 0 ? map.queryRenderedFeatures(undefined, { layers }) : [];
        const nextItems = buildDynamicLegendItemsFromRenderedFeatureProperties(renderedFeatures, limit);
        setDynamicLegendItems((current) => (dynamicLegendItemsEqual(current, nextItems) ? current : nextItems));
      });
    };
    updateLegend();
    map.on("idle", updateLegend);
    map.on("moveend", updateLegend);
    map.on("zoomend", updateLegend);
    map.on("resize", updateLegend);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      map.off("idle", updateLegend);
      map.off("moveend", updateLegend);
      map.off("zoomend", updateLegend);
      map.off("resize", updateLegend);
    };
  }, [
    clusterTracks,
    featureCollection,
    mapReady,
    sharedLiveLocationFeatureCollection,
    situationFeatureCollection,
    situationOsmClusterFeatureCollection
  ]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(selectedTransitRouteSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(selectedRouteFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [mapReady, selectedRouteFeatureCollection]);

  React.useEffect(() => {
    const source = mapRef.current?.getSource(emergencyRouteSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(emergencyRouteFeatureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [emergencyRouteFeatureCollection, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || emergencyRouteFeatureCollection.features.length === 0) {
      return;
    }
    fitMapToEmergencyRoute(map, emergencyRouteFeatureCollection);
  }, [emergencyRouteFeatureCollection, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    syncSituationRasterOverlays(
      map,
      situationRasterOverlaySpecs(situationFeatures?.features ?? []),
      situationRasterOverlayIdsRef.current
    );
  }, [mapReady, situationFeatures]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!documentVisible || !mapReady || !map || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let expanded = false;
    const applyPulseFrame = () => {
      if (!map.getLayer(situationWeatherPulseLayerId)) {
        return;
      }
      expanded = !expanded;
      map.setPaintProperty(situationWeatherPulseLayerId, "circle-radius", weatherPulseRadiusExpression(expanded));
      map.setPaintProperty(situationWeatherPulseLayerId, "circle-opacity", weatherPulseOpacityExpression(expanded));
    };
    applyPulseFrame();
    const timer = window.setInterval(applyPulseFrame, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [documentVisible, mapReady]);

  const handledFocusUserLocationRequestRef = React.useRef(0);

  React.useEffect(() => {
    if (
      !mapReady ||
      !userLocation ||
      !isPendingMapFocusRequest(focusUserLocationRequest, handledFocusUserLocationRequestRef.current)
    ) {
      return;
    }
    handledFocusUserLocationRequestRef.current = focusUserLocationRequest;
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
  }, [featureCollection, mapReady]);

  React.useEffect(() => {
    const clusterSource = mapRef.current?.getSource(trackClusterSourceId);
    if (mapReady && clusterSource && "setData" in clusterSource) {
      const clusterData = clusterTracks ? featureCollection : emptyTrackFeatureCollection();
      (clusterSource as GeoJSONSource).setData(clusterData as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [clusterTracks, featureCollection, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    setTrackClusterVisibility(map, clusterTracks);
    setSituationOsmClusterVisibility(map, clusterTracks);
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
    if (!mapReady || !autoFit) {
      return;
    }

    const signature = buildFitSignature(positionedObjects, situationFeatureCollection);
    if (lastFitSignatureRef.current === signature) {
      return;
    }

    if (fitMapToVisibleContent(mapRef.current, positionedObjects, situationFeatureCollection)) {
      lastFitSignatureRef.current = signature;
    }
  }, [autoFit, mapReady, positionedObjects, situationFeatureCollection]);

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

  React.useEffect(() => {
    if (!mapFullscreen) {
      nativeHeadingStopRef.current?.();
      nativeHeadingStopRef.current = null;
      setCompassExpanded(false);
      return undefined;
    }
    if (nativeCompassAvailable() || deviceCompass.status === "unsupported" || deviceCompass.status === "denied") {
      return undefined;
    }
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const headingDeg = deviceCompassHeading(event);
      if (headingDeg === undefined) {
        setDeviceCompass((current) =>
          current.status === "active" ? { ...current, message: "Senzor zatím neposílá absolutní heading." } : current
        );
        return;
      }
      setDeviceCompass({
        headingDeg,
        message: "Heading zařízení dostupný.",
        status: "active"
      });
    };
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [deviceCompass.status, mapFullscreen]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }
    setMapInteractionSuspended(map, mapInteractionSuspended);
  }, [mapInteractionSuspended, mapReady]);

  async function requestCompassSensor() {
    if (nativeCompassAvailable()) {
      nativeHeadingStopRef.current?.();
      nativeHeadingStopRef.current = null;
      setDeviceCompass({ message: "Čekám na data z nativního kompasu.", status: "active" });
      try {
        nativeHeadingStopRef.current = await startNativeHeading((sample) => {
          const headingDeg = sample.trueHeadingDeg ?? sample.magneticHeadingDeg;
          setDeviceCompass({
            headingDeg,
            message: sample.valid
              ? `Nativní heading ±${Math.round(sample.accuracyDeg)}°.`
              : "Kompas vyžaduje kalibraci.",
            status: "active"
          });
        });
      } catch (error) {
        const denied = error instanceof NativeDeviceBridgeError && error.code.startsWith("PERMISSION_");
        setDeviceCompass({
          message: error instanceof Error ? error.message : "Nativní kompas není dostupný.",
          status: denied ? "denied" : "unsupported"
        });
      }
      return;
    }
    const permission = await requestDeviceOrientationPermission();
    if (permission === "unsupported") {
      setDeviceCompass({ message: "Prohlížeč neposkytuje orientační senzor.", status: "unsupported" });
      return;
    }
    if (permission === "denied") {
      setDeviceCompass({ message: "Přístup k orientačnímu senzoru je zamítnutý.", status: "denied" });
      return;
    }
    setDeviceCompass((current) => ({
      ...current,
      message: "Čekám na data ze senzoru zařízení.",
      status: "active"
    }));
  }

  const finishZoneDraft = React.useCallback(() => {
    if (zoneDraftPoints.length < 3) {
      return;
    }
    onCreateZonePolygonRef.current?.(zoneDraftPoints);
    setZoneDraftPoints([]);
  }, [zoneDraftPoints]);

  const removeLastZoneDraftPoint = React.useCallback(() => {
    setZoneDraftPoints((current) => current.slice(0, -1));
  }, []);

  const cancelZoneDraft = React.useCallback(() => {
    setZoneDraftPoints([]);
    onCancelZoneCreationRef.current?.();
  }, []);

  const deleteSelectedEditVertex = React.useCallback(() => {
    if (!editingZone || selectedEditVertexIndex === null || editingZonePoints.length <= 3) {
      return;
    }
    const nextPoints = editingZonePoints.filter((_, index) => index !== selectedEditVertexIndex);
    onUpdateZonePolygonRef.current?.(editingZone.id, nextPoints);
    setSelectedEditVertexIndex((current) => {
      if (current === null) {
        return null;
      }
      return Math.min(current, Math.max(0, nextPoints.length - 1));
    });
  }, [editingZone, editingZonePoints, selectedEditVertexIndex]);

  const finishSketchDraft = React.useCallback(() => {
    const mode = sketchModeRef.current;
    const minimum = mode === "polygon" ? 3 : 2;
    if (sketchDraftPoints.length < minimum) {
      return;
    }
    const kind: SketchDrawingKind =
      mode === "measurement"
        ? "measurement"
        : mode === "polygon"
          ? "polygon"
          : mode === "circle"
            ? "circle"
            : mode === "arrow"
              ? "arrow"
              : "line";
    const geometry = sketchGeometryFromPoints(kind, sketchDraftPoints);
    if (!geometry) {
      return;
    }
    const draftLineCoordinates = sketchDraftPoints.map((point): [number, number] => [point.lon, point.lat]);
    const measuredKm = measureSketchLine(draftLineCoordinates);
    const style = sketchStyleSettingsRef.current;
    const pattern = sketchFillPatternRef.current;
    onCreateSketchDrawingRef.current?.({
      geometry,
      kind,
      label: sketchDraftLabel(kind, measuredKm),
      properties:
        kind === "measurement"
          ? { fillPattern: "dash", measurementKm: measuredKm }
          : kind === "circle"
            ? { createdFrom: "map", fillPattern: pattern, radiusKm: measuredKm }
            : { createdFrom: "map", fillPattern: pattern },
      style: kind === "measurement" ? { stroke: "#facc15", fill: "#facc15", opacity: 0.08 } : style,
      symbol: { iconId: kind === "measurement" ? "measure" : kind, palette: "civil" },
      visibility: "private"
    });
    setSketchDraftPoints([]);
    onSketchModeChangeRef.current?.("select");
  }, [sketchDraftPoints]);

  const removeLastSketchDraftPoint = React.useCallback(() => {
    setSketchDraftPoints((current) => current.slice(0, -1));
  }, []);

  const deleteSelectedSketchVertex = React.useCallback(() => {
    if (!selectedSketchDrawing || selectedSketchVertexIndex === null) {
      return;
    }
    const points = sketchEditablePoints(selectedSketchDrawing);
    const minimum = selectedSketchDrawing.properties.kind === "polygon" ? 3 : 2;
    if (points.length <= minimum) {
      return;
    }
    const nextPoints = points.filter((_, index) => index !== selectedSketchVertexIndex);
    const geometry = sketchGeometryFromPoints(selectedSketchDrawing.properties.kind, nextPoints);
    if (geometry) {
      onUpdateSketchDrawingRef.current?.(selectedSketchDrawing.id, { geometry });
      setSelectedSketchVertexIndex((current) => {
        if (current === null) {
          return null;
        }
        return Math.min(current, Math.max(0, nextPoints.length - 1));
      });
    }
  }, [selectedSketchDrawing, selectedSketchVertexIndex]);

  const applySketchStyle = React.useCallback(
    (patch: Partial<SketchStyleSettings>) => {
      const nextStyle = {
        fill: patch.fill ?? sketchStyleSettingsRef.current.fill,
        lineWidth: patch.lineWidth ?? sketchStyleSettingsRef.current.lineWidth,
        opacity: patch.opacity ?? sketchStyleSettingsRef.current.opacity,
        stroke: patch.stroke ?? sketchStyleSettingsRef.current.stroke
      };
      setSketchFill(nextStyle.fill);
      setSketchLineWidth(nextStyle.lineWidth);
      setSketchOpacity(nextStyle.opacity);
      setSketchStroke(nextStyle.stroke);
      if (selectedSketchDrawing) {
        onUpdateSketchDrawingRef.current?.(selectedSketchDrawing.id, { style: nextStyle });
      }
    },
    [selectedSketchDrawing]
  );

  const applySketchFillPattern = React.useCallback(
    (pattern: SketchFillPattern) => {
      setSketchFillPattern(pattern);
      if (selectedSketchDrawing) {
        onUpdateSketchDrawingRef.current?.(selectedSketchDrawing.id, {
          properties: {
            ...(selectedSketchDrawing.properties.properties ?? {}),
            fillPattern: pattern
          }
        });
      }
    },
    [selectedSketchDrawing]
  );

  const applySketchSymbol = React.useCallback(
    (preset: SketchSymbolPreset) => {
      setSketchSymbol(preset);
      if (
        selectedSketchDrawing &&
        (selectedSketchDrawing.properties.kind === "marker" ||
          selectedSketchDrawing.properties.kind === "point" ||
          selectedSketchDrawing.properties.kind === "text")
      ) {
        onUpdateSketchDrawingRef.current?.(selectedSketchDrawing.id, {
          label: preset.label,
          properties: {
            ...(selectedSketchDrawing.properties.properties ?? {}),
            shape: preset.shape
          },
          symbol: sketchPresetToSymbolInput(preset)
        });
      }
    },
    [selectedSketchDrawing]
  );

  const activeSketchTool = React.useMemo(
    () => sketchToolItems.find((item) => item.mode === sketchMode) ?? sketchToolItems[0]!,
    [sketchMode]
  );
  const ActiveSketchToolIcon = activeSketchTool.Icon;
  const handleSketchToolChange = React.useCallback(
    (mode: SketchToolMode) => {
      onSketchModeChangeRef.current?.(mode);
      if (mobileSketchControlsOpen) {
        setSketchToolsExpanded(false);
      }
    },
    [mobileSketchControlsOpen]
  );
  const showSketchSymbolPalette =
    sketchMode === "marker" ||
    Boolean(
      selectedSketchDrawing &&
      (selectedSketchDrawing.properties.kind === "marker" ||
        selectedSketchDrawing.properties.kind === "point" ||
        selectedSketchDrawing.properties.kind === "text")
    );
  const beginSketchPaletteDrag = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (mobileSketchControlsOpen || !sketchToolsExpanded) {
        return;
      }
      const containerRect = containerRef.current?.getBoundingClientRect();
      const paletteRect = sketchPaletteRef.current?.getBoundingClientRect();
      if (!containerRect || !paletteRect) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const currentPosition = sketchPalettePosition ?? {
        x: paletteRect.left - containerRect.left,
        y: paletteRect.top - containerRect.top
      };
      sketchPaletteDragRef.current = {
        height: paletteRect.height,
        originX: currentPosition.x,
        originY: currentPosition.y,
        startX: event.clientX,
        startY: event.clientY,
        width: paletteRect.width
      };
      setSketchPaletteDragging(true);
    },
    [mobileSketchControlsOpen, sketchPalettePosition, sketchToolsExpanded]
  );
  React.useEffect(() => {
    if (!sketchPaletteDragging) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = sketchPaletteDragRef.current;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!drag || !containerRect) {
        return;
      }
      const paletteRect = sketchPaletteRef.current?.getBoundingClientRect();
      const paletteWidth = paletteRect?.width ?? drag.width;
      const paletteHeight = paletteRect?.height ?? drag.height;
      const nextX = drag.originX + event.clientX - drag.startX;
      const nextY = drag.originY + event.clientY - drag.startY;
      setSketchPalettePosition({
        x: clampValue(nextX, 10, Math.max(10, containerRect.width - paletteWidth - 10)),
        y: clampValue(nextY, 10, Math.max(10, containerRect.height - paletteHeight - 10))
      });
    };
    const handlePointerUp = () => {
      sketchPaletteDragRef.current = null;
      setSketchPaletteDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [sketchPaletteDragging]);
  const sketchPaletteStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!sketchToolsExpanded || mobileSketchControlsOpen || !sketchPalettePosition) {
      return undefined;
    }
    return {
      bottom: "auto",
      left: `${sketchPalettePosition.x}px`,
      right: "auto",
      top: `${sketchPalettePosition.y}px`,
      transform: "none"
    };
  }, [mobileSketchControlsOpen, sketchPalettePosition, sketchToolsExpanded]);

  const beginMapControlsDrag = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (mapControlsCollapsed) {
        return;
      }
      const containerRect = containerRef.current?.getBoundingClientRect();
      const controlsRect = mapControlsRef.current?.getBoundingClientRect();
      if (!containerRect || !controlsRect) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const currentPosition = mapControlsPosition ?? {
        x: controlsRect.left - containerRect.left,
        y: controlsRect.top - containerRect.top
      };
      mapControlsDragRef.current = {
        height: controlsRect.height,
        originX: currentPosition.x,
        originY: currentPosition.y,
        startX: event.clientX,
        startY: event.clientY,
        width: controlsRect.width
      };
      setMapControlsDragging(true);
    },
    [mapControlsCollapsed, mapControlsPosition]
  );

  React.useEffect(() => {
    if (!mapControlsDragging) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = mapControlsDragRef.current;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!drag || !containerRect) {
        return;
      }
      const controlsRect = mapControlsRef.current?.getBoundingClientRect();
      const controlsWidth = controlsRect?.width ?? drag.width;
      const controlsHeight = controlsRect?.height ?? drag.height;
      const nextX = drag.originX + event.clientX - drag.startX;
      const nextY = drag.originY + event.clientY - drag.startY;
      setMapControlsPosition({
        x: clampValue(nextX, 8, Math.max(8, containerRect.width - controlsWidth - 8)),
        y: clampValue(nextY, 8, Math.max(8, containerRect.height - controlsHeight - 8))
      });
    };
    const handlePointerUp = () => {
      mapControlsDragRef.current = null;
      setMapControlsDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [mapControlsDragging]);

  const mapControlsStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!mapControlsPosition) {
      return undefined;
    }
    return {
      left: `${mapControlsPosition.x}px`,
      right: "auto",
      top: `${mapControlsPosition.y}px`
    };
  }, [mapControlsPosition]);

  const beginSelectionPopoverDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("button,a,input,textarea,select")) {
        return;
      }
      const containerRect = containerRef.current?.getBoundingClientRect();
      const popoverRect = selectionPopoverRef.current?.getBoundingClientRect();
      if (!containerRect || !popoverRect) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const currentPosition = selectionPopoverPosition ?? {
        x: popoverRect.left - containerRect.left,
        y: popoverRect.top - containerRect.top
      };
      selectionPopoverDragRef.current = {
        detachedAtStart: selectionPopoverPosition !== null,
        height: popoverRect.height,
        originX: currentPosition.x,
        originY: currentPosition.y,
        startX: event.clientX,
        startY: event.clientY,
        width: popoverRect.width
      };
      setSelectionPopoverPosition(currentPosition);
      setSelectionPopoverDragging(true);
    },
    [selectionPopoverPosition]
  );

  React.useEffect(() => {
    if (!selectionPopoverDragging) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = selectionPopoverDragRef.current;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!drag || !containerRect) {
        return;
      }
      const popoverRect = selectionPopoverRef.current?.getBoundingClientRect();
      const popoverWidth = popoverRect?.width ?? drag.width;
      const popoverHeight = popoverRect?.height ?? drag.height;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.detachedAtStart && Math.hypot(deltaX, deltaY) < 4) {
        return;
      }
      const nextX = drag.originX + deltaX;
      const nextY = drag.originY + deltaY;
      setSelectionPopoverPosition({
        x: clampValue(nextX, 8, Math.max(8, containerRect.width - popoverWidth - 8)),
        y: clampValue(nextY, 8, Math.max(8, containerRect.height - popoverHeight - 8))
      });
    };
    const handlePointerUp = () => {
      selectionPopoverDragRef.current = null;
      setSelectionPopoverDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [selectionPopoverDragging]);

  const selectionPopoverDetached = Boolean(selectionPopoverPosition);
  const selectionPopoverStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (selectionPopoverPosition) {
      return {
        left: `${selectionPopoverPosition.x}px`,
        top: `${selectionPopoverPosition.y}px`
      };
    }
    if (!selectionPopupPoint) {
      return undefined;
    }
    return {
      "--popover-arrow-x": `${selectionPopupPoint.arrowX}px`,
      "--popover-gap": `${selectionPopupPoint.yOffset}px`,
      left: `${selectionPopupPoint.x}px`,
      top: `${selectionPopupPoint.y}px`
    } as React.CSSProperties;
  }, [selectionPopoverPosition, selectionPopupPoint]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedAnchorCoordinate) {
      setSelectionPopupPoint(null);
      return undefined;
    }
    const updatePosition = () => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        setSelectionPopupPoint(null);
        return;
      }
      const point = map.project({ lng: selectedAnchorCoordinate[0], lat: selectedAnchorCoordinate[1] });
      const popoverGap = selectionPopoverCollapsed ? 44 : 78;
      const expandedPopupMaxWidth = window.matchMedia?.("(max-width: 720px)").matches ? 300 : 320;
      const popupWidth = selectionPopoverCollapsed
        ? Math.min(148, Math.max(112, containerRect.width - 28))
        : Math.min(expandedPopupMaxWidth, Math.max(236, containerRect.width - 28));
      const popupHalfWidth = popupWidth / 2;
      const horizontalPadding = 14;
      const x = clampValue(
        point.x,
        popupHalfWidth + horizontalPadding,
        Math.max(popupHalfWidth + horizontalPadding, containerRect.width - popupHalfWidth - horizontalPadding)
      );
      const placement: "above" | "below" = point.y < 150 ? "below" : "above";
      const arrowX = clampValue(point.x - x + popupHalfWidth, 18, Math.max(18, popupWidth - 18));
      setSelectionPopupPoint({
        arrowX,
        placement,
        x,
        yOffset: placement === "above" ? popoverGap : 30,
        y: clampValue(point.y, 20, Math.max(20, containerRect.height - 20))
      });
    };
    updatePosition();
    map.on("move", updatePosition);
    map.on("zoom", updatePosition);
    map.on("resize", updatePosition);
    return () => {
      map.off("move", updatePosition);
      map.off("zoom", updatePosition);
      map.off("resize", updatePosition);
    };
  }, [mapReady, selectedAnchorCoordinate, selectionPopoverCollapsed]);

  const missingPositionCount = objects.length - positionedObjects.length;
  const emergencyRouteCardMessage =
    emergencyRouteStatus === "ready"
      ? formatEmergencyRouteCardSummary(emergencyRoute, emergencyRouteMessage)
      : emergencyRouteMessage;

  return (
    <div
      className={[
        "map-container",
        `basemap-${mapBasemapMode}`,
        webKitMapRuntime ? "webkit-map-runtime" : "",
        `sketch-cursor-${sketchMode}`,
        mapFullscreen ? "fullscreen" : "",
        radioPointPickActive ? "radio-point-pick-active" : "",
        mobileSketchControlsOpen ? "mobile-sketch-controls-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="map-canvas" ref={containerRef} aria-label="Georeferencovaná situační mapa" />
      {!mapTilesReady && !mapError ? (
        <div className="map-loading-overlay" aria-live="polite">
          <div className="map-loading-card">
            <span className="map-loading-spinner" aria-hidden="true" />
            <div>
              <strong>Načítám mapový podklad</strong>
              <span>Připravuji dlaždice pro aktuální výřez.</span>
            </div>
          </div>
        </div>
      ) : null}
      {zoneCreationActive ? (
        <div className="map-zone-create-hint">
          <strong>Kreslení zóny</strong>
          <span>
            {zoneDraftPoints.length < 3
              ? `Přidejte alespoň 3 body (${zoneDraftPoints.length}/3).`
              : `${zoneDraftPoints.length} bodů připraveno.`}
          </span>
          <div className="map-zone-create-actions">
            <button disabled={zoneDraftPoints.length < 3} onClick={finishZoneDraft} type="button">
              Dokončit polygon
            </button>
            <button disabled={zoneDraftPoints.length === 0} onClick={removeLastZoneDraftPoint} type="button">
              Zpět bod
            </button>
            <button onClick={cancelZoneDraft} type="button">
              Zrušit
            </button>
          </div>
        </div>
      ) : null}
      {editingZone ? (
        <div className="map-zone-create-hint map-zone-edit-hint">
          <strong>Editace zóny: {editingZone.name}</strong>
          <span>Tažením posuňte roh. Modré body mezi hranami vloží nový bod. Vybraný roh lze smazat.</span>
          <div className="map-zone-create-actions">
            <button
              disabled={selectedEditVertexIndex === null || editingZonePoints.length <= 3}
              onClick={deleteSelectedEditVertex}
              type="button"
            >
              Smazat bod
            </button>
            <button onClick={() => setSelectedEditVertexIndex(null)} type="button">
              Zrušit výběr
            </button>
            <button onClick={() => onCancelZoneEditingRef.current?.()} type="button">
              Hotovo
            </button>
          </div>
        </div>
      ) : null}
      {reportLocationPickActive ? (
        <div className="map-zone-create-hint">Kliknutím do mapy určíte polohu hlášení</div>
      ) : null}
      {radioPointPickActive ? (
        <div className="map-zone-create-hint radio-map-pick-hint">
          <strong>Výběr bodu pro rádio</strong>
          <span>Kliknutím do mapy nastavíte {radioPointPickLabel ?? "vstupní bod výpočtu"}.</span>
        </div>
      ) : null}
      <div
        className={[
          "map-sketch-palette",
          sketchToolsExpanded ? "expanded" : "collapsed",
          sketchPaletteDragging ? "dragging" : "",
          sketchPalettePosition && sketchToolsExpanded && !mobileSketchControlsOpen ? "moved" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={stopMapToolbarEvent}
        onDoubleClick={stopMapToolbarEvent}
        onPointerDown={stopMapToolbarEvent}
        ref={sketchPaletteRef}
        style={sketchPaletteStyle}
      >
        <div className={`map-sketch-toolbar ${sketchToolsExpanded ? "expanded" : "collapsed"}`}>
          <button
            aria-label={sketchToolsExpanded ? "Skrýt nástroje zákresu" : "Zobrazit nástroje zákresu"}
            className="map-sketch-toggle"
            onClick={() => setSketchToolsExpanded((current) => !current)}
            type="button"
          >
            {sketchToolsExpanded ? <ChevronDown size={17} /> : <Palette size={17} />}
          </button>
          {sketchToolsExpanded ? (
            <div className="map-sketch-tool-grid">
              {sketchToolItems.map(({ Icon, label, mode }) => (
                <button
                  aria-pressed={sketchMode === mode}
                  className={`map-sketch-tool-button ${sketchMode === mode ? "active" : ""}`}
                  key={mode}
                  onClick={() => handleSketchToolChange(mode)}
                  title={label}
                  type="button"
                >
                  <Icon size={17} strokeWidth={2.2} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ) : (
            <button
              className="map-sketch-tool-button active compact"
              onClick={() => setSketchToolsExpanded(true)}
              type="button"
            >
              <ActiveSketchToolIcon size={17} strokeWidth={2.2} />
              <span>{activeSketchTool.label}</span>
            </button>
          )}
        </div>
        {sketchToolsExpanded ? (
          <div
            className="map-sketch-style-panel"
            onClick={stopMapToolbarEvent}
            onDoubleClick={stopMapToolbarEvent}
            onPointerDown={stopMapToolbarEvent}
            onWheel={stopMapToolbarEvent}
          >
            <div className="map-sketch-style-header">
              <Palette size={16} />
              <strong>Zákres</strong>
              <span>{selectedSketchDrawing ? "upravujete vybraný prvek" : "styl pro nový prvek"}</span>
              <button
                aria-label="Přesunout paletu zákresu"
                className="map-sketch-palette-drag"
                onPointerDown={beginSketchPaletteDrag}
                title="Přesunout paletu"
                type="button"
              >
                <Move size={15} strokeWidth={2.2} />
              </button>
            </div>
            <div className="map-sketch-style-grid">
              <div className="map-sketch-style-section">
                <span>Tah</span>
                <div className="map-sketch-swatches">
                  {sketchColorSwatches.map((color) => (
                    <button
                      aria-label={`Barva tahu ${color}`}
                      className={sketchStroke === color ? "active" : ""}
                      key={`stroke-${color}`}
                      onClick={() => applySketchStyle({ stroke: color })}
                      style={{ "--swatch-color": color } as React.CSSProperties}
                      type="button"
                    />
                  ))}
                  <input
                    aria-label="Vlastní barva tahu"
                    onChange={(event) => applySketchStyle({ stroke: event.target.value })}
                    type="color"
                    value={sketchStroke}
                  />
                </div>
              </div>
              <div className="map-sketch-style-section">
                <span>Výplň</span>
                <div className="map-sketch-swatches">
                  {sketchColorSwatches.map((color) => (
                    <button
                      aria-label={`Barva výplně ${color}`}
                      className={sketchFill === color ? "active" : ""}
                      key={`fill-${color}`}
                      onClick={() => applySketchStyle({ fill: color })}
                      style={{ "--swatch-color": color } as React.CSSProperties}
                      type="button"
                    />
                  ))}
                  <input
                    aria-label="Vlastní barva výplně"
                    onChange={(event) => applySketchStyle({ fill: event.target.value })}
                    type="color"
                    value={sketchFill}
                  />
                </div>
              </div>
              <label className="map-sketch-range">
                <span>Šířka {sketchLineWidth}px</span>
                <input
                  max={12}
                  min={1}
                  onChange={(event) => applySketchStyle({ lineWidth: Number(event.target.value) })}
                  step={1}
                  type="range"
                  value={sketchLineWidth}
                />
              </label>
              <label className="map-sketch-range">
                <span>Průhlednost {Math.round(sketchOpacity * 100)}%</span>
                <input
                  max={0.9}
                  min={0.05}
                  onChange={(event) => applySketchStyle({ opacity: Number(event.target.value) })}
                  step={0.05}
                  type="range"
                  value={sketchOpacity}
                />
              </label>
              <div className="map-sketch-fill-patterns">
                {(
                  [
                    ["solid", "Plná"],
                    ["outline", "Obrys"],
                    ["hatch", "Šrafy"],
                    ["dash", "Čár."]
                  ] as Array<[SketchFillPattern, string]>
                ).map(([pattern, label]) => (
                  <button
                    className={sketchFillPattern === pattern ? "active" : ""}
                    key={pattern}
                    onClick={() => applySketchFillPattern(pattern)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {showSketchSymbolPalette ? (
              <div className="map-sketch-symbol-section">
                <span>Symbol</span>
                <div className="map-sketch-symbol-grid">
                  {sketchSymbolPresets.map((preset) => {
                    const Icon = sketchSymbolIcons[preset.iconId] ?? MapPin;
                    return (
                      <button
                        aria-label={preset.label}
                        className={sketchSymbol.iconId === preset.iconId ? "active" : ""}
                        key={preset.iconId}
                        onClick={() => applySketchSymbol(preset)}
                        title={preset.label}
                        type="button"
                      >
                        <Icon size={16} strokeWidth={2.2} />
                        <span>{preset.glyph}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {isSketchDraftMode(sketchMode) ? (
        <div className="map-zone-create-hint map-sketch-create-hint">
          <strong>{sketchMode === "measurement" ? "Měření" : "Kreslení"}</strong>
          <span>{sketchDraftHint(sketchMode, sketchDraftPoints)}</span>
          <div className="map-zone-create-actions">
            <button
              disabled={sketchDraftPoints.length < (sketchMode === "polygon" ? 3 : 2)}
              onClick={finishSketchDraft}
              type="button"
            >
              Uložit
            </button>
            <button disabled={sketchDraftPoints.length === 0} onClick={removeLastSketchDraftPoint} type="button">
              Zpět bod
            </button>
            <button onClick={() => onSketchModeChangeRef.current?.("pan")} type="button">
              Zrušit
            </button>
          </div>
        </div>
      ) : null}
      {selectedSketchDrawing && sketchMode === "select" ? (
        <div className="map-zone-create-hint map-sketch-edit-hint">
          <strong>Zákres: {selectedSketchDrawing.properties.label}</strong>
          <span>Rohy lze táhnout, modré body vkládají další bod. Zákres je samostatná vrstva.</span>
          <div className="map-zone-create-actions">
            <button
              disabled={
                selectedSketchVertexIndex === null ||
                sketchEditablePoints(selectedSketchDrawing).length <=
                  (selectedSketchDrawing.properties.kind === "polygon" ? 3 : 2)
              }
              onClick={deleteSelectedSketchVertex}
              type="button"
            >
              Smazat bod
            </button>
            <button onClick={() => setSelectedSketchVertexIndex(null)} type="button">
              Zrušit výběr
            </button>
            <button
              onClick={() => {
                if (window.confirm("Smazat vybraný zákres?")) {
                  onDeleteSketchDrawingRef.current?.(selectedSketchDrawing.id);
                }
              }}
              type="button"
            >
              Smazat
            </button>
          </div>
        </div>
      ) : null}
      {mapFullscreen ? (
        <FullscreenCompassWidget
          deviceCompass={deviceCompass}
          expanded={compassExpanded}
          mapBearingDeg={mapBearingDeg}
          userHeadingDeg={normalizeCompassDegrees(userLocation?.headingDeg)}
          onRequestSensor={() => void requestCompassSensor()}
          onResetNorth={() => mapRef.current?.easeTo({ bearing: 0, duration: 180, pitch: 0 })}
          onToggle={() => setCompassExpanded((current) => !current)}
        />
      ) : null}
      <div
        className={[
          "map-control-palette",
          mapControlsCollapsed ? "collapsed" : "expanded",
          mapControlsDragging ? "dragging" : "",
          mapControlsPosition ? "moved" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={stopMapToolbarEvent}
        onDoubleClick={stopMapToolbarEvent}
        onPointerDown={stopMapToolbarEvent}
        onWheel={stopMapToolbarEvent}
        ref={mapControlsRef}
        style={mapControlsStyle}
      >
        {mapControlsCollapsed ? (
          <button
            aria-label="Zobrazit ovládání mapy"
            className="map-control-main"
            onClick={() => onMapControlsCollapsedChange(false)}
            title="Zobrazit ovládání mapy"
            type="button"
          >
            <Maximize2 size={17} strokeWidth={2.2} />
          </button>
        ) : (
          <>
            <button
              aria-label="Přesunout ovládání mapy"
              className="map-control-drag"
              onPointerDown={beginMapControlsDrag}
              title="Přesunout ovládání mapy"
              type="button"
            >
              <Move size={15} strokeWidth={2.2} />
            </button>
            <button
              aria-pressed={autoFit}
              className={`map-control-button ${autoFit ? "active" : ""}`}
              onClick={() => {
                const nextAutoFit = !autoFit;
                onAutoFitChange(nextAutoFit);
                if (
                  nextAutoFit &&
                  fitMapToVisibleContent(mapRef.current, positionedObjects, situationFeatureCollection)
                ) {
                  lastFitSignatureRef.current = buildFitSignature(positionedObjects, situationFeatureCollection);
                }
              }}
              title="Přizpůsobit mapu viditelným prvkům"
              type="button"
            >
              <MousePointer2 size={16} strokeWidth={2.2} />
              <span>Přiblížit</span>
            </button>
            <button
              aria-label="Přiblížit mapu"
              className="map-control-button icon-only"
              onClick={() => mapRef.current?.zoomIn({ duration: 160 })}
              title="Přiblížit mapu"
              type="button"
            >
              <Plus size={16} strokeWidth={2.3} />
            </button>
            <button
              aria-label="Oddálit mapu"
              className="map-control-button icon-only"
              onClick={() => mapRef.current?.zoomOut({ duration: 160 })}
              title="Oddálit mapu"
              type="button"
            >
              <Minus size={16} strokeWidth={2.3} />
            </button>
            <button
              aria-label="Srovnat sever"
              className="map-control-button icon-only"
              onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 180, pitch: 0 })}
              title="Srovnat sever"
              type="button"
            >
              <Compass size={16} strokeWidth={2.2} />
            </button>
            <button
              aria-label="Přejít na moji polohu"
              className="map-control-button"
              onClick={() => onRequestUserLocation()}
              title="Přejít na moji polohu"
              type="button"
            >
              <MapPin size={16} strokeWidth={2.2} />
              <span>Poloha</span>
            </button>
            <button
              aria-label={userLocationFollowEnabled ? "Vypnout sledování polohy" : "Sledovat moji polohu"}
              aria-pressed={userLocationFollowEnabled}
              className={`map-control-button ${userLocationFollowEnabled ? "active" : ""}`}
              onClick={() => onUserLocationFollowChange(!userLocationFollowEnabled)}
              title={userLocationFollowEnabled ? "Vypnout sledování polohy" : "Sledovat moji polohu"}
              type="button"
            >
              <Navigation size={16} strokeWidth={2.2} />
              <span>Sledovat</span>
            </button>
            <button
              aria-pressed={mapFullscreen}
              className={`map-control-button ${mapFullscreen ? "active" : ""}`}
              onClick={() => setMapFullscreen((current) => !current)}
              title={mapFullscreen ? "Ukončit celou obrazovku" : "Zobrazit mapu přes celou obrazovku"}
              type="button"
            >
              {mapFullscreen ? <Minimize2 size={16} strokeWidth={2.2} /> : <Maximize2 size={16} strokeWidth={2.2} />}
              <span>{mapFullscreen ? "Zmenšit" : "Mapa"}</span>
            </button>
            <button
              aria-label="Skrýt ovládání mapy"
              className="map-control-button icon-only"
              onClick={() => onMapControlsCollapsedChange(true)}
              title="Skrýt ovládání mapy"
              type="button"
            >
              <ChevronUp size={16} strokeWidth={2.2} />
            </button>
          </>
        )}
      </div>
      {selectionCard && selectionPopupPoint && selectionPopoverStyle ? (
        <div
          className={`map-object-popover ${selectionCard.variant ? `variant-${selectionCard.variant}` : ""} ${!selectionPopoverDetached && selectionPopupPoint.placement === "below" ? "below" : ""} ${selectionPopoverCollapsed ? "collapsed" : ""} ${selectionPopoverDetached ? "detached" : ""} ${selectionPopoverDragging ? "dragging" : ""} ${selectionCard.statusTone ? `tone-${selectionCard.statusTone}` : ""}`}
          onClick={stopMapToolbarEvent}
          onDoubleClick={stopMapToolbarEvent}
          onPointerDown={stopMapToolbarEvent}
          onWheel={stopMapToolbarEvent}
          ref={selectionPopoverRef}
          style={selectionPopoverStyle}
        >
          <div className="map-object-popover-header" onPointerDown={beginSelectionPopoverDrag}>
            <span>{selectionCard.eyebrow}</span>
            <div className="map-object-popover-actions">
              <button
                aria-label={
                  selectionPopoverDetached ? "Připnout mini detail zpět k bodu" : "Mini detail je připnutý k bodu"
                }
                onClick={(event) => {
                  stopMapToolbarEvent(event);
                  setSelectionPopoverPosition(null);
                }}
                title={selectionPopoverDetached ? "Připnout zpět k bodu" : "Připnuto k bodu"}
                type="button"
              >
                {selectionPopoverDetached ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button
                aria-label={selectionPopoverCollapsed ? "Rozbalit popis" : "Minimalizovat popis"}
                onClick={() => setSelectionPopoverCollapsed((current) => !current)}
                title={selectionPopoverCollapsed ? "Rozbalit popis" : "Minimalizovat popis"}
                type="button"
              >
                {selectionPopoverCollapsed ? <ChevronDown size={14} /> : <Minimize2 size={14} />}
              </button>
              <button aria-label="Zrušit výběr" onClick={clearMapSelection} title="Zrušit výběr" type="button">
                <X size={14} />
              </button>
            </div>
          </div>
          {selectionPopoverCollapsed ? (
            <div className="map-object-popover-compact">
              <strong>{selectionCard.title}</strong>
              <small>{selectionCard.compactSubtitle}</small>
            </div>
          ) : (
            <>
              <strong>{selectionCard.title}</strong>
              <small>{selectionCard.subtitle}</small>
              {selectionCard.metaItems.length > 0 ? (
                <div className="map-object-popover-meta">
                  {selectionCard.metaItems.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              {selectionCard.detailRows?.length ? (
                <div className="map-object-popover-details">
                  {(selectedEmergencyRouteInfo ? selectionCard.detailRows.slice(0, 4) : selectionCard.detailRows).map(
                    (row) => (
                      <div key={`${row.label}:${row.value}`}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    )
                  )}
                </div>
              ) : null}
              {!selectedEmergencyRouteInfo && selectionCard.elevationProfile ? (
                <RouteElevationProfileView profile={selectionCard.elevationProfile} />
              ) : null}
              {!selectedEmergencyRouteInfo && selectionCard.analysisSections?.length ? (
                <div className="map-object-popover-sections">
                  {selectionCard.analysisSections.map((section) => (
                    <div className="map-object-popover-section" key={section.title}>
                      <span>{section.title}</span>
                      {section.items.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedEmergencyRouteInfo?.routeId &&
              selectedEmergencyRouteInfo.canActivate &&
              onActivateEmergencyRoute ? (
                <div className="map-object-popover-route-actions">
                  <button
                    className="map-object-popover-route primary"
                    onClick={(event) => {
                      stopMapToolbarEvent(event);
                      onActivateEmergencyRoute(selectedEmergencyRouteInfo.routeId!);
                      setSelectedEmergencyRouteInfo(null);
                      onSelectEmergencyRoute?.(null);
                    }}
                    type="button"
                  >
                    <ArrowRight size={14} strokeWidth={2.2} />
                    <span>Použít variantu</span>
                  </button>
                </div>
              ) : null}
              {!selectedEmergencyRouteInfo &&
              selectedAnchorCoordinate &&
              (onRequestRouteToPoint ||
                onStartNavigationToPoint ||
                onRequestNearestAccessToPoint ||
                onRequestIsochroneFromPoint) ? (
                <div className="map-object-popover-route-actions">
                  {onRequestRouteToPoint ? (
                    <>
                      <button
                        className="map-object-popover-route"
                        disabled={emergencyRouteStatus === "loading"}
                        onClick={(event) => {
                          stopMapToolbarEvent(event);
                          onRequestRouteToPoint(
                            {
                              label: selectionCard.title,
                              lat: selectedAnchorCoordinate[1],
                              lon: selectedAnchorCoordinate[0]
                            },
                            "car"
                          );
                        }}
                        type="button"
                      >
                        <Car size={14} strokeWidth={2.2} />
                        <span>{emergencyRouteStatus === "loading" ? "Počítám trasu..." : "Trasa autem"}</span>
                      </button>
                      <button
                        className="map-object-popover-route"
                        disabled={emergencyRouteStatus === "loading"}
                        onClick={(event) => {
                          stopMapToolbarEvent(event);
                          onRequestRouteToPoint(
                            {
                              label: selectionCard.title,
                              lat: selectedAnchorCoordinate[1],
                              lon: selectedAnchorCoordinate[0]
                            },
                            "walking"
                          );
                        }}
                        type="button"
                      >
                        <Compass size={14} strokeWidth={2.2} />
                        <span>Trasa pěšky</span>
                      </button>
                    </>
                  ) : null}
                  {onStartNavigationToPoint ? (
                    <>
                      <button
                        className="map-object-popover-route primary"
                        disabled={emergencyRouteStatus === "loading"}
                        onClick={(event) => {
                          stopMapToolbarEvent(event);
                          onStartNavigationToPoint(
                            {
                              label: selectionCard.title,
                              lat: selectedAnchorCoordinate[1],
                              lon: selectedAnchorCoordinate[0]
                            },
                            "car"
                          );
                        }}
                        type="button"
                      >
                        <Navigation size={14} strokeWidth={2.2} />
                        <span>Navigovat autem</span>
                      </button>
                      <button
                        className="map-object-popover-route primary"
                        disabled={emergencyRouteStatus === "loading"}
                        onClick={(event) => {
                          stopMapToolbarEvent(event);
                          onStartNavigationToPoint(
                            {
                              label: selectionCard.title,
                              lat: selectedAnchorCoordinate[1],
                              lon: selectedAnchorCoordinate[0]
                            },
                            "walking"
                          );
                        }}
                        type="button"
                      >
                        <Navigation size={14} strokeWidth={2.2} />
                        <span>Navigovat pěšky</span>
                      </button>
                    </>
                  ) : null}
                  {onRequestNearestAccessToPoint ? (
                    <button
                      className="map-object-popover-route"
                      disabled={emergencyRouteStatus === "loading"}
                      onClick={(event) => {
                        stopMapToolbarEvent(event);
                        onRequestNearestAccessToPoint({
                          label: selectionCard.title,
                          lat: selectedAnchorCoordinate[1],
                          lon: selectedAnchorCoordinate[0]
                        });
                      }}
                      type="button"
                    >
                      <MapPin size={14} strokeWidth={2.2} />
                      <span>Nejbližší přístup</span>
                    </button>
                  ) : null}
                  {onRequestIsochroneFromPoint ? (
                    <button
                      className="map-object-popover-route"
                      disabled={emergencyRouteStatus === "loading"}
                      onClick={(event) => {
                        stopMapToolbarEvent(event);
                        onRequestIsochroneFromPoint({
                          label: selectionCard.title,
                          lat: selectedAnchorCoordinate[1],
                          lon: selectedAnchorCoordinate[0]
                        });
                      }}
                      type="button"
                    >
                      <Compass size={14} strokeWidth={2.2} />
                      <span>Dosah 15 min</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!selectedEmergencyRouteInfo && selectedRouteFeatureCollection.features.length > 0 ? (
                <div className="map-object-popover-route">
                  <ArrowRight size={14} strokeWidth={2.2} />
                  <span>Trasa je zvýrazněná v mapě</span>
                </div>
              ) : null}
              {!selectedEmergencyRouteInfo && emergencyRouteFeatureCollection.features.length > 0 ? (
                <div className="map-object-popover-route">
                  <Compass size={14} strokeWidth={2.2} />
                  <span>Zásahová trasa je zvýrazněná v mapě</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {emergencyRouteStatus !== "idle" && emergencyRouteStatus !== "ready" && emergencyRouteCardMessage ? (
        <div className={`map-emergency-route-card ${emergencyRouteStatus}`}>
          <div className="map-emergency-route-card-body">
            <strong>Zásahová trasa</strong>
            <span>{emergencyRouteCardMessage}</span>
          </div>
          <div className="map-emergency-route-card-actions">
            {onClearEmergencyRoute ? (
              <button
                aria-label="Skrýt zásahovou trasu"
                onClick={(event) => {
                  stopMapToolbarEvent(event);
                  setSelectedEmergencyRouteInfo(null);
                  onClearEmergencyRoute();
                }}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {onStartReport ? (
        <button
          className="map-report-button"
          onClick={(event) => {
            stopMapToolbarEvent(event);
            onStartReport();
          }}
          onDoubleClick={stopMapToolbarEvent}
          onPointerDown={stopMapToolbarEvent}
          onWheel={stopMapToolbarEvent}
          title="Přidat komunitní hlášení s polohou, popisem a fotkou"
          type="button"
        >
          <Camera size={18} />
          <span>Nahlásit</span>
        </button>
      ) : null}
      <div
        className={`map-legend ${mapLegendCollapsed ? "collapsed" : "expanded"}`}
        onClick={stopMapToolbarEvent}
        onDoubleClick={stopMapToolbarEvent}
        onPointerDown={stopMapToolbarEvent}
      >
        <button
          aria-expanded={!mapLegendCollapsed}
          aria-label={mapLegendCollapsed ? "Zobrazit legendu mapy" : "Skrýt legendu mapy"}
          className="map-legend-toggle"
          onClick={() => onMapLegendCollapsedChange(!mapLegendCollapsed)}
          type="button"
        >
          <HelpCircle size={17} />
        </button>
        {mapLegendCollapsed ? null : (
          <div className="map-legend-items">
            {dynamicLegendItems.length > 0 ? (
              dynamicLegendItems.map((item) => <DynamicLegendItemView item={item} key={item.key} />)
            ) : (
              <>
                <LegendItem disposition="friend" color="#3b82f6" label="Vlastní" />
                <LegendItem disposition="hostile" color="#ef4444" label="Rizikové" />
                <LegendItem disposition="neutral" color="#22c55e" label="Neutrální" />
                <LegendItem disposition="unknown" color="#facc15" label="Neznámé" />
              </>
            )}
            {showHistory ? <LineLegendItem label="Historie" /> : null}
            {showPrediction ? <LineLegendItem dashed label="Predikce" /> : null}
            {showProximityAlertRadius && userLocation ? (
              <RadiusLegendItem active={hasProximityAlerts} label="Výstražný perimetr" />
            ) : null}
            {aoiRuleFeatureCollection.features.length > 0 ? (
              <RadiusLegendItem active={false} label="Uživatelská zóna" />
            ) : null}
            {alertAreaFeatureCollection.features.length > 0 ? <RadiusLegendItem active label="Alert vrstva" /> : null}
            {situationFeatureCollection.features.length > 0 ? <SituationLegendItem label="Situační kontext" /> : null}
            {hasMobileCoverageFeatures ? <CoverageLegendItem /> : null}
            {clusterTracks ? <ClusterLegendItem label="Shluky" /> : null}
          </div>
        )}
      </div>
      {clusterInfo ? <ClusterPanel cluster={clusterInfo} onClose={() => setClusterInfo(null)} /> : null}
      {missingPositionCount > 0 ? (
        <div className="map-notice">{missingPositionCount} objektů bez polohy není v mapě.</div>
      ) : null}
      {mapError ? <div className="map-notice error">Mapový podklad: {mapError}</div> : null}
      {emptyMessage &&
      objects.length === 0 &&
      !hasSituationContextEnabled &&
      situationFeatureCollection.features.length === 0 ? (
        <div className="map-empty">{emptyMessage}</div>
      ) : null}
    </div>
  );
}

function FullscreenCompassWidget({
  deviceCompass,
  expanded,
  mapBearingDeg,
  userHeadingDeg,
  onRequestSensor,
  onResetNorth,
  onToggle
}: {
  deviceCompass: DeviceCompassState;
  expanded: boolean;
  mapBearingDeg: number | undefined;
  userHeadingDeg: number | undefined;
  onRequestSensor: () => void;
  onResetNorth: () => void;
  onToggle: () => void;
}) {
  const normalizedMapBearing = normalizeCompassDegrees(mapBearingDeg) ?? 0;
  const sensorHeading = normalizeCompassDegrees(deviceCompass.headingDeg);
  const movementHeading = normalizeCompassDegrees(userHeadingDeg);
  const effectiveDeviceHeading = sensorHeading ?? movementHeading;
  const statusLabel = formatCompassStatus(deviceCompass, movementHeading);
  return (
    <div
      className={`map-compass-widget ${expanded ? "expanded" : "collapsed"}`}
      onClick={stopMapToolbarEvent}
      onDoubleClick={stopMapToolbarEvent}
      onPointerDown={stopMapToolbarEvent}
      onWheel={stopMapToolbarEvent}
    >
      <button
        aria-expanded={expanded}
        aria-label="Buzola a natočení mapy"
        className="map-compass-bubble"
        onClick={onToggle}
        title="Buzola a natočení mapy"
        type="button"
      >
        <Compass size={17} strokeWidth={2.2} />
        <span>{formatCompassDegrees(normalizedMapBearing)}</span>
      </button>
      {expanded ? (
        <div className="map-compass-panel">
          <div className="map-compass-dial" aria-hidden="true">
            <span className="map-compass-cardinal north">S</span>
            <span className="map-compass-cardinal east">V</span>
            <span className="map-compass-cardinal south">J</span>
            <span className="map-compass-cardinal west">Z</span>
            <span className="map-compass-map-arrow" style={{ transform: `rotate(${-normalizedMapBearing}deg)` }} />
            {effectiveDeviceHeading !== undefined ? (
              <span
                className="map-compass-device-arrow"
                style={{ transform: `rotate(${effectiveDeviceHeading - normalizedMapBearing}deg)` }}
              />
            ) : null}
          </div>
          <dl className="map-compass-readout">
            <div>
              <dt>Mapa</dt>
              <dd>{formatCompassDegrees(normalizedMapBearing)}</dd>
            </div>
            <div>
              <dt>Zařízení</dt>
              <dd>{effectiveDeviceHeading !== undefined ? formatCompassDegrees(effectiveDeviceHeading) : "n/a"}</dd>
            </div>
            <div>
              <dt>Stav</dt>
              <dd>{statusLabel}</dd>
            </div>
          </dl>
          <div className="map-compass-actions">
            <button onClick={onResetNorth} type="button">
              Sever
            </button>
            <button
              disabled={deviceCompass.status === "unsupported" || deviceCompass.status === "denied"}
              onClick={onRequestSensor}
              type="button"
            >
              Buzola
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function initialDeviceCompassState(): DeviceCompassState {
  if (nativeCompassAvailable()) {
    return { message: "Nativní buzolu lze aktivovat po tapnutí.", status: "idle" };
  }
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return { message: "Prohlížeč neposkytuje orientační senzor.", status: "unsupported" };
  }
  return { message: "Buzolu lze aktivovat po tapnutí.", status: "idle" };
}

type DeviceOrientationPermissionResult = "denied" | "granted" | "unsupported";

async function requestDeviceOrientationPermission(): Promise<DeviceOrientationPermissionResult> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return "unsupported";
  }
  const OrientationEventConstructor = window.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<PermissionState>;
      })
    | undefined;
  if (typeof OrientationEventConstructor?.requestPermission !== "function") {
    return "granted";
  }
  try {
    const permission = await OrientationEventConstructor.requestPermission();
    return permission === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

function deviceCompassHeading(event: DeviceOrientationEvent): number | undefined {
  const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof webkitHeading === "number" && Number.isFinite(webkitHeading)) {
    return normalizeCompassDegrees(webkitHeading);
  }
  if (event.absolute === true && typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
    return normalizeCompassDegrees(360 - event.alpha);
  }
  return undefined;
}

function normalizeCompassDegrees(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return ((value % 360) + 360) % 360;
}

function formatCompassDegrees(value: number | undefined): string {
  return value === undefined ? "n/a" : `${Math.round(value)}°`;
}

function formatCompassStatus(deviceCompass: DeviceCompassState, movementHeading: number | undefined): string {
  if (deviceCompass.status === "active" && deviceCompass.headingDeg !== undefined) {
    return "senzor aktivní";
  }
  if (movementHeading !== undefined) {
    return "směr pohybu";
  }
  if (deviceCompass.status === "denied") {
    return "zamítnuto";
  }
  if (deviceCompass.status === "unsupported") {
    return "nedostupné";
  }
  return deviceCompass.message ?? "čeká";
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

function requestMapResize(map: maplibregl.Map): void {
  const run = () => {
    if (!map.getContainer().isConnected) {
      return;
    }
    map.resize();
    map.triggerRepaint();
  };

  run();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
    requestAnimationFrame(() => requestAnimationFrame(run));
  }
  window.setTimeout(run, 120);
  window.setTimeout(run, 420);
  window.setTimeout(run, 900);
}

export function registerMapViewportResumeHandlers(onResume: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const cleanups: Array<() => void> = [];
  const addListener = (target: EventTarget | null | undefined, eventName: string) => {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    target.addEventListener(eventName, onResume, { passive: true });
    cleanups.push(() => target.removeEventListener(eventName, onResume));
  };

  addListener(window, "resize");
  addListener(window, "focus");
  addListener(window, "pageshow");
  addListener(window, "orientationchange");
  addListener(typeof document === "undefined" ? null : document, "visibilitychange");
  addListener(window.visualViewport, "resize");
  addListener(window.visualViewport, "scroll");
  addListener(window.screen?.orientation, "change");

  return () => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };
}

export async function warmRasterBasemapTileCache(map: maplibregl.Map, tiles: string): Promise<void> {
  if (typeof fetch !== "function" || !tiles.includes("{z}") || !tiles.includes("{x}") || !tiles.includes("{y}")) {
    return;
  }

  const center = map.getCenter();
  const z = clampInteger(Math.floor(map.getZoom()), 0, 19);
  const centerTile = lonLatToTileCoordinate(center.lng, center.lat, z);
  const maxTile = Math.max(0, 2 ** z - 1);
  const urls = new Set<string>();

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      urls.add(
        rasterTileUrl(
          tiles,
          z,
          clampInteger(centerTile.x + dx, 0, maxTile),
          clampInteger(centerTile.y + dy, 0, maxTile)
        )
      );
    }
  }

  await Promise.allSettled(
    Array.from(urls).map((url) =>
      fetch(url, {
        cache: "force-cache",
        credentials: "omit",
        mode: "cors"
      })
    )
  );
}

function lonLatToTileCoordinate(lon: number, lat: number, z: number): { x: number; y: number } {
  const clampedLat = clampValue(lat, -85.05112878, 85.05112878);
  const latRad = (clampedLat * Math.PI) / 180;
  const tileCount = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * tileCount);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tileCount);

  return {
    x: clampInteger(x, 0, Math.max(0, tileCount - 1)),
    y: clampInteger(y, 0, Math.max(0, tileCount - 1))
  };
}

function rasterTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function setMapInteractionSuspended(map: maplibregl.Map, suspended: boolean): void {
  if (suspended) {
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    return;
  }
  enableMapInteractions(map);
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
  const normalLayerIds = [trackHoverHaloLayerId, trackSelectedHaloLayerId, trackSymbolLayerId, trackLabelLayerId];
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

function setSituationOsmClusterVisibility(map: maplibregl.Map, clusterPoints: boolean): void {
  const normalLayerIds = [situationOsmSymbolLayerId, situationOsmDetailSymbolLayerId];
  const clusterLayerIds = [
    situationOsmClusterCircleLayerId,
    situationOsmClusterCountLayerId,
    situationOsmClusterSymbolLayerId,
    situationOsmClusterLabelLayerId
  ];

  normalLayerIds.forEach((layerId) => setLayerVisibility(map, layerId, !clusterPoints));
  clusterLayerIds.forEach((layerId) => setLayerVisibility(map, layerId, clusterPoints));
}

function setLayerVisibility(map: maplibregl.Map, layerId: string, visible: boolean): void {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

async function zoomToCluster(
  map: maplibregl.Map,
  event: MapLayerMouseEvent,
  sourceId: string,
  setClusterInfo: React.Dispatch<React.SetStateAction<ClusterInfo | null>>
): Promise<void> {
  const feature = event.features?.[0];
  const clusterId = Number(feature?.properties?.cluster_id);
  const pointCount = Number(feature?.properties?.point_count);
  const center = extractPointCoordinates(feature);
  const source = map.getSource(sourceId);
  if (
    !Number.isFinite(clusterId) ||
    !Number.isFinite(pointCount) ||
    !center ||
    !source ||
    !("getClusterExpansionZoom" in source)
  ) {
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

function raiseInteractivePointLayers(map: maplibregl.Map): void {
  for (const layerId of mapPointRaiseLayerIds) {
    if (map.getLayer(layerId)) {
      map.moveLayer(layerId);
    }
  }
}

function queryRenderedFeatureByLayerPriority(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
  layerIds: readonly string[]
): NonNullable<MapLayerMouseEvent["features"]>[number] | undefined {
  for (const layerId of layerIds) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    const feature = map.queryRenderedFeatures(point, { layers: [layerId] })[0];
    if (feature) {
      return feature as NonNullable<MapLayerMouseEvent["features"]>[number];
    }
  }
  return undefined;
}

function extractPointCoordinates(
  feature: NonNullable<MapLayerMouseEvent["features"]>[number] | undefined
): [number, number] | null {
  const coordinates = (feature?.geometry as { coordinates?: unknown } | undefined)?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function clusterLeafToInfo(feature: unknown): ClusterInfo["leaves"][number] | null {
  const properties = isRecord((feature as { properties?: unknown })?.properties)
    ? (feature as { properties: Record<string, unknown> }).properties
    : null;
  if (!properties) {
    return null;
  }
  const situationLabel =
    stringProperty(properties.weatherLabel) ??
    stringProperty(properties.riskMapLabel) ??
    stringProperty(properties.weatherCameraLabel) ??
    stringProperty(properties.airQualityLabel) ??
    stringProperty(properties.mobileNetworkLabel) ??
    stringProperty(properties.coverageLabel) ??
    stringProperty(properties.mapLabel);
  return {
    affiliation: stringProperty(properties.affiliation) ?? "UNKNOWN",
    label:
      situationLabel ??
      stringProperty(properties.label) ??
      stringProperty(properties.objectId) ??
      stringProperty(properties.featureId) ??
      "bod",
    objectType: stringProperty(properties.objectType) ?? stringProperty(properties.layer) ?? "bod",
    status:
      stringProperty(properties.status) ??
      stringProperty(properties.situationStatusLabel) ??
      stringProperty(properties.quality) ??
      "n/a"
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function situationFeaturesToFeatureCollection(
  collection: SituationFeatureCollectionResponse | null,
  selectedFeatureId?: string,
  mapSymbolMode: PublicFlightSymbolMode = "civil",
  selectedStableKey?: string
): SituationContextFeatureCollection {
  const features: SituationContextFeatureCollection["features"] = [];
  const requestedMobileTechnology = normalizeMobileNetworkTechnology(collection?.query.technology);
  const hasSelectedSafetyAlert = Boolean(
    (selectedFeatureId || selectedStableKey) &&
    (collection?.features ?? []).some(
      (feature) =>
        isSituationFeatureSelected(feature, selectedFeatureId, selectedStableKey) &&
        isSafetyAlertPolygonFeature(feature)
    )
  );
  for (const feature of collection?.features ?? []) {
    if (isSituationRasterOverlayFeature(feature)) {
      continue;
    }
    if (isUnsafeMobileNetworkFeature(feature, requestedMobileTechnology)) {
      continue;
    }
    const renderedFeature = renderSituationFeature(
      feature,
      selectedFeatureId,
      mapSymbolMode,
      hasSelectedSafetyAlert,
      selectedStableKey
    );
    features.push(renderedFeature);
    const pulseFeature = buildWeatherPulseFeature(feature, renderedFeature.properties);
    if (pulseFeature) {
      features.push(pulseFeature);
    }
  }
  return {
    type: "FeatureCollection",
    features
  };
}

function situationOsmPointsToClusterFeatureCollection(
  collection: SituationContextFeatureCollection
): SituationContextFeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.filter(
      (feature) => feature.geometry.type === "Point" && feature.properties.osmPoi === true
    )
  };
}

const czechiaMobileNetworkEnvelope = {
  west: 11.8,
  south: 48.5,
  east: 19.2,
  north: 51.2
};
const maxMobileNetworkCellSpanDegrees = 0.75;
const maxMobileNetworkCellAreaDegrees = 0.25;

function isUnsafeMobileNetworkFeature(feature: SituationFeature, requestedTechnology: string | undefined): boolean {
  if (feature.properties.layer !== "mobile_network") {
    return false;
  }
  if (
    feature.properties.readModel === false ||
    (feature.properties.sourceId === "mobile_network_model" && feature.properties.readModel !== true)
  ) {
    return true;
  }
  if (/^mobile_network:aggregate:mixed:/iu.test(feature.properties.featureId)) {
    return true;
  }
  const technology = normalizeMobileNetworkTechnology(feature.properties.technology);
  if (requestedTechnology && technology && technology !== requestedTechnology) {
    return true;
  }
  if (requestedTechnology && technology === "mixed") {
    return true;
  }
  const bounds = geometryBoundsWgs84(feature.geometry);
  if (!bounds) {
    return true;
  }
  const [west, south, east, north] = bounds;
  if (
    east < czechiaMobileNetworkEnvelope.west ||
    west > czechiaMobileNetworkEnvelope.east ||
    north < czechiaMobileNetworkEnvelope.south ||
    south > czechiaMobileNetworkEnvelope.north
  ) {
    return true;
  }
  const width = Math.abs(east - west);
  const height = Math.abs(north - south);
  return (
    width > maxMobileNetworkCellSpanDegrees ||
    height > maxMobileNetworkCellSpanDegrees ||
    width * height > maxMobileNetworkCellAreaDegrees
  );
}

function normalizeMobileNetworkTechnology(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : undefined;
  if (normalized === "2G" || normalized === "4G" || normalized === "5G" || normalized === "MIXED") {
    return normalized.toLowerCase();
  }
  return undefined;
}

function situationRasterOverlaySpecs(features: SituationFeature[]): SituationRasterOverlaySpec[] {
  return features.flatMap((feature) => {
    const spec = situationRasterOverlaySpec(feature);
    return spec ? [spec] : [];
  });
}

function situationRasterOverlaySpec(feature: SituationFeature): SituationRasterOverlaySpec | null {
  if (!isSituationRasterOverlayFeature(feature)) {
    return null;
  }
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const raster = isRecord(providerProperties.raster) ? providerProperties.raster : {};
  const url = stringProperty(raster.url);
  const bounds = rasterBoundsWgs84(raster) ?? geometryBoundsWgs84(feature.geometry);
  if (!url || !bounds) {
    return null;
  }
  const overlayId = sanitizeMapLibreId(feature.properties.featureId || String(feature.id ?? "raster"));
  const rasterOpacity = recordNumber(raster, "opacity");
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : {};
  const providerRendering = isRecord(providerProperties.rendering) ? providerProperties.rendering : {};
  const opacity = clampUnit(
    rasterOpacity ?? recordNumber(rendering, "opacity") ?? recordNumber(providerRendering, "opacity") ?? 0.58
  );
  const [west, south, east, north] = bounds;
  return {
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south]
    ],
    id: overlayId,
    layerId: `${situationRasterOverlayLayerPrefix}-${overlayId}`,
    opacity,
    sourceId: `${situationRasterOverlaySourcePrefix}-${overlayId}`,
    url: rasterOverlayProxyUrl(url)
  };
}

function rasterOverlayProxyUrl(url: string): string {
  if (url.startsWith("/api/v1/map/raster-overlay")) {
    return url;
  }
  return `/api/v1/map/raster-overlay?url=${encodeURIComponent(url)}`;
}

function syncSituationRasterOverlays(
  map: maplibregl.Map,
  overlays: SituationRasterOverlaySpec[],
  activeOverlayIds: Set<string>
): void {
  const nextOverlayIds = new Set(overlays.map((overlay) => overlay.id));
  for (const overlayId of Array.from(activeOverlayIds)) {
    if (!nextOverlayIds.has(overlayId)) {
      removeSituationRasterOverlay(map, overlayId);
      activeOverlayIds.delete(overlayId);
    }
  }
  for (const overlay of overlays) {
    const source = map.getSource(overlay.sourceId);
    if (source) {
      const imageSource = source as {
        updateImage?: (options: { coordinates: RasterOverlayCoordinates; url: string }) => void;
      };
      imageSource.updateImage?.({ coordinates: overlay.coordinates, url: overlay.url });
    } else {
      map.addSource(overlay.sourceId, {
        coordinates: overlay.coordinates,
        type: "image",
        url: overlay.url
      } as SourceSpecification);
    }
    if (!map.getLayer(overlay.layerId)) {
      const beforeLayerId = map.getLayer(situationFillLayerId) ? situationFillLayerId : undefined;
      map.addLayer(
        {
          id: overlay.layerId,
          paint: {
            "raster-fade-duration": 0,
            "raster-opacity": overlay.opacity
          },
          source: overlay.sourceId,
          type: "raster"
        },
        beforeLayerId
      );
    } else {
      map.setPaintProperty(overlay.layerId, "raster-opacity", overlay.opacity);
    }
    activeOverlayIds.add(overlay.id);
  }
}

function removeSituationRasterOverlay(map: maplibregl.Map, overlayId: string): void {
  const layerId = `${situationRasterOverlayLayerPrefix}-${overlayId}`;
  const sourceId = `${situationRasterOverlaySourcePrefix}-${overlayId}`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function isSituationRasterOverlayFeature(feature: SituationFeature): boolean {
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : {};
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const providerRendering = isRecord(providerProperties.rendering) ? providerProperties.rendering : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    stringProperty(rendering.mode) === "raster_overlay" ||
    stringProperty(providerRendering.mode) === "raster_overlay" ||
    stringProperty(providerProperties.renderAs) === "raster_overlay" ||
    stringProperty(tags.renderAs) === "raster_overlay" ||
    stringProperty(tags.geometryRole) === "raster_extent" ||
    feature.properties.layerId === "public.weather.radar_reflectivity" ||
    feature.properties.layerId === "public.weather.radar_precipitation" ||
    feature.properties.layerId === "public.weather.radar_nowcast" ||
    feature.properties.layerId === "public.safety.thunderstorm_risk" ||
    feature.properties.layer === "weather_radar_reflectivity" ||
    feature.properties.layer === "weather_radar_precipitation" ||
    feature.properties.layer === "weather_radar_nowcast" ||
    feature.properties.layer === "weather_thunderstorm_risk"
  );
}

function rasterBoundsWgs84(raster: Record<string, unknown>): [number, number, number, number] | null {
  const raw = raster.boundsWgs84;
  if (!Array.isArray(raw) || raw.length < 4) {
    return null;
  }
  const west = Number(raw[0]);
  const south = Number(raw[1]);
  const east = Number(raw[2]);
  const north = Number(raw[3]);
  return Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)
    ? [west, south, east, north]
    : null;
}

function geometryBoundsWgs84(geometry: SituationFeature["geometry"]): [number, number, number, number] | null {
  const points: Array<[number, number]> = [];
  collectGeometryCoordinates(geometry.coordinates, points);
  if (points.length === 0) {
    return null;
  }
  const bounds = points.reduce(
    (acc, [lon, lat]) => ({
      east: Math.max(acc.east, lon),
      north: Math.max(acc.north, lat),
      south: Math.min(acc.south, lat),
      west: Math.min(acc.west, lon)
    }),
    { east: -Infinity, north: -Infinity, south: Infinity, west: Infinity }
  );
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

function sanitizeMapLibreId(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "raster"
  );
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function coverageOpacityForFeature(feature: SituationFeature): number | undefined {
  if (feature.properties.layer !== "mobile_coverage") {
    return undefined;
  }
  const confidence = numberProperty(feature.properties.confidence);
  if (confidence === undefined) {
    return undefined;
  }
  return 0.08 + clampUnit(confidence) * 0.18;
}

function coverageLineOpacityForFeature(feature: SituationFeature): number | undefined {
  if (feature.properties.layer !== "mobile_coverage") {
    return undefined;
  }
  const confidence = numberProperty(feature.properties.confidence);
  if (confidence === undefined) {
    return undefined;
  }
  return 0.42 + clampUnit(confidence) * 0.28;
}

function renderSituationFeature(
  feature: SituationFeature,
  selectedFeatureId: string | undefined,
  mapSymbolMode: PublicFlightSymbolMode,
  hasSelectedSafetyAlert = false,
  selectedStableKey?: string
): SituationContextFeatureCollection["features"][number] {
  const selected = isSituationFeatureSelected(feature, selectedFeatureId, selectedStableKey);
  const safetyAlertLayer = safetyAlertLayerKind(feature);
  return {
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      ...buildSituationRenderProperties(feature, mapSymbolMode),
      ...(safetyAlertLayer
        ? {
            safetyAlertDimmed: hasSelectedSafetyAlert && !selected,
            safetyAlertLayer
          }
        : {}),
      selected
    },
    type: "Feature"
  };
}

function isSituationFeatureSelected(
  feature: SituationFeature,
  selectedFeatureId?: string,
  selectedStableKey?: string
): boolean {
  if (selectedFeatureId && feature.properties.featureId === selectedFeatureId) {
    return true;
  }
  if (!selectedStableKey) {
    return false;
  }
  return transportSelectionKey(feature) === selectedStableKey;
}

function isSafetyAlertPolygonFeature(feature: SituationFeature): boolean {
  return (
    (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
    Boolean(safetyAlertLayerKind(feature))
  );
}

function safetyAlertLayerKind(feature: SituationFeature): "warnings" | "weather_alerts" | undefined {
  const identifiers = [
    feature.properties.layer,
    feature.properties.layerId,
    feature.properties.providerLayerId
  ].flatMap((value) => (typeof value === "string" ? [value] : []));
  if (
    identifiers.some(
      (value) =>
        value === "weather_alerts" || value === "safety.weather_alerts" || value === "public.safety.weather_alerts"
    )
  ) {
    return "weather_alerts";
  }
  if (
    identifiers.some(
      (value) => value === "warnings" || value === "safety.warnings" || value === "public.safety.warnings"
    )
  ) {
    return "warnings";
  }
  return undefined;
}

function buildWeatherPulseFeature(
  feature: SituationFeature,
  properties: SituationContextFeatureCollection["features"][number]["properties"]
): SituationContextFeatureCollection["features"][number] | null {
  if (feature.properties.layer !== "weather_precipitation_grid") {
    return null;
  }
  const precipitationMm = properties.weatherPrecipitationMm;
  if (precipitationMm === undefined || precipitationMm <= 0.02) {
    return null;
  }
  const coordinates = geometryVisualCentroid(feature.geometry);
  if (!coordinates) {
    return null;
  }
  const intensity = Math.min(1, Math.max(0.18, Math.sqrt(precipitationMm) / 2.4));
  return {
    geometry: {
      coordinates,
      type: "Point"
    },
    properties: {
      ...properties,
      mapLabel: undefined,
      mapPointSuppressed: true,
      weatherGrid: false,
      weatherMetricLabel: undefined,
      weatherObservation: false,
      weatherPulse: true,
      weatherPulseColor: properties.weatherFillColor ?? "#38bdf8",
      weatherPulseOpacity: 0.18 + intensity * 0.28,
      weatherPulseRadius: 6 + intensity * 12
    },
    type: "Feature"
  };
}

function selectionAnchorCoordinate(
  object: CopObject | null,
  situationFeature: SituationFeature | null,
  sketchDrawing: SketchDrawingFeature | null
): [number, number] | null {
  if (object && hasPosition(object)) {
    return [object.position.lon, object.position.lat];
  }
  if (situationFeature) {
    return geometryVisualCentroid(situationFeature.geometry);
  }
  if (sketchDrawing) {
    return sketchGeometryVisualCentroid(sketchDrawing.geometry);
  }
  return null;
}

function selectedTransitRouteToFeatureCollection(
  feature: SituationFeature,
  detailRouteShape?: unknown,
  detail?: TransitVehicleDetailResponse | null
): SelectedRouteFeatureCollection {
  if (feature.properties.layer !== "traffic" || !resolveTransportPresentation(feature)) {
    return emptySelectedRouteFeatureCollection();
  }
  if (!transitRouteShapeAvailable(detail)) {
    return emptySelectedRouteFeatureCollection();
  }
  const coordinates = extractTransitRouteCoordinates(feature, detailRouteShape);
  if (!coordinates || coordinates.length < 2) {
    return emptySelectedRouteFeatureCollection();
  }
  const label = formatSituationFeatureTitle(feature);
  const stopPoints = transitRouteStopPoints(detail);
  const pointFeatures =
    stopPoints.length > 0
      ? stopPoints.map((stop) => ({
          geometry: { type: "Point" as const, coordinates: stop.coordinate },
          properties: { featureId: feature.properties.featureId, kind: "route-stop" as const, label: stop.label },
          type: "Feature" as const
        }))
      : routeWaypointCoordinates(coordinates).map((coordinate) => ({
          geometry: { type: "Point" as const, coordinates: coordinate },
          properties: { featureId: feature.properties.featureId, kind: "route-waypoint" as const, label },
          type: "Feature" as const
        }));
  return {
    type: "FeatureCollection",
    features: [
      {
        geometry: { type: "LineString", coordinates },
        properties: { featureId: feature.properties.featureId, kind: "route-line", label },
        type: "Feature"
      },
      ...pointFeatures
    ]
  };
}

function selectedTransitRouteShapeForMap(
  explicitRouteShape: unknown,
  detail: TransitVehicleDetailResponse | null | undefined
): unknown {
  if (!transitRouteShapeAvailable(detail)) {
    return null;
  }
  return explicitRouteShape ?? detail?.routeShape ?? detail?.route?.shape ?? null;
}

function transitRouteShapeAvailable(detail: TransitVehicleDetailResponse | null | undefined): boolean {
  return detail?.quality?.routeShapeAvailable === true || detail?.quality?.shapeAvailable === true;
}

function transitRouteStopPoints(
  detail: TransitVehicleDetailResponse | null | undefined
): Array<{ coordinate: [number, number]; label: string }> {
  return transitDetailStops(detail)
    .map((stop, index) => ({
      coordinate: transitStopCoordinate(stop),
      label: transitStopLabel(stop) ?? `Zastávka ${index + 1}`,
      sequence: stop.stopSequence ?? stop.sequence ?? index
    }))
    .filter((stop): stop is { coordinate: [number, number]; label: string; sequence: number } =>
      Boolean(stop.coordinate)
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ coordinate, label }) => ({ coordinate, label }));
}

function transitDetailStops(detail: TransitVehicleDetailResponse | null | undefined): TransitStopTime[] {
  const stops = Array.isArray(detail?.stops) ? detail.stops : [];
  const stopTimes = Array.isArray(detail?.stopTimes) ? detail.stopTimes : [];
  const merged = [...stops, ...stopTimes];
  const seen = new Set<string>();
  return merged.filter((stop, index) => {
    const key = stop.stopId ?? `${transitStopLabel(stop) ?? "stop"}:${stop.stopSequence ?? stop.sequence ?? index}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function transitStopCoordinate(stop: TransitStopTime): [number, number] | null {
  const lon = Number(stop.position?.lon);
  const lat = Number(stop.position?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }
  return [lon, lat];
}

function transitStopLabel(stop: TransitStopTime | null | undefined): string | null {
  const label = stop?.stopName ?? stop?.name;
  return typeof label === "string" && label.trim().length > 0 ? label.trim() : null;
}

function extractTransitRouteCoordinates(
  feature: SituationFeature,
  detailRouteShape?: unknown
): Array<[number, number]> | null {
  const detailCoordinates = lineCoordinatesFromUnknown(detailRouteShape);
  if (detailCoordinates && detailCoordinates.length >= 2) {
    return detailCoordinates;
  }
  if (feature.geometry.type === "LineString" && feature.geometry.coordinates.length >= 2) {
    return feature.geometry.coordinates;
  }
  const properties = feature.properties as unknown as Record<string, unknown>;
  const candidates = [
    properties.routeShape,
    properties.routeGeometry,
    properties.shape,
    properties.route,
    properties.providerProperties,
    properties.metrics,
    properties.tags
  ];
  for (const candidate of candidates) {
    const coordinates = lineCoordinatesFromUnknown(candidate);
    if (coordinates && coordinates.length >= 2) {
      return coordinates;
    }
  }
  return null;
}

function lineCoordinatesFromUnknown(value: unknown, depth = 0): Array<[number, number]> | null {
  if (depth > 5) {
    return null;
  }
  if (Array.isArray(value)) {
    const coordinates = normalizeLineCoordinates(value);
    return coordinates.length >= 2 ? coordinates : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (stringProperty(value.type) === "LineString") {
    const coordinates = lineCoordinatesFromUnknown(value.coordinates, depth + 1);
    if (coordinates) {
      return coordinates;
    }
  }
  if (stringProperty(value.type) === "MultiLineString" && Array.isArray(value.coordinates)) {
    const candidates = value.coordinates
      .map((candidate) => lineCoordinatesFromUnknown(candidate, depth + 1))
      .filter((candidate): candidate is Array<[number, number]> => Boolean(candidate && candidate.length >= 2));
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
    }
  }
  const directKeys = [
    "coordinates",
    "geometry",
    "routeShape",
    "routeGeometry",
    "shape",
    "route",
    "lineString",
    "path",
    "points"
  ];
  for (const key of directKeys) {
    const coordinates = lineCoordinatesFromUnknown(value[key], depth + 1);
    if (coordinates) {
      return coordinates;
    }
  }
  return null;
}

function normalizeLineCoordinates(value: unknown[]): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  for (const item of value) {
    let lon: number;
    let lat: number;
    if (Array.isArray(item) && item.length >= 2) {
      lon = Number(item[0]);
      lat = Number(item[1]);
    } else if (isRecord(item)) {
      lon = recordNumber(item, "lon") ?? recordNumber(item, "lng") ?? recordNumber(item, "longitude") ?? Number.NaN;
      lat = recordNumber(item, "lat") ?? recordNumber(item, "latitude") ?? Number.NaN;
    } else {
      return [];
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return [];
    }
    coordinates.push([lon, lat]);
  }
  return coordinates;
}

function routeWaypointCoordinates(coordinates: Array<[number, number]>): Array<[number, number]> {
  if (coordinates.length < 2) {
    return [];
  }
  const indexes = new Set<number>([0, coordinates.length - 1]);
  if (coordinates.length > 6) {
    indexes.add(Math.floor(coordinates.length / 2));
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => coordinates[index]!)
    .filter(Boolean);
}

function sketchGeometryVisualCentroid(geometry: SketchGeometry): [number, number] | null {
  const points: Array<[number, number]> = [];
  collectGeometryCoordinates(geometry.coordinates, points);
  if (points.length === 0) {
    return null;
  }
  const bounds = points.reduce(
    (acc, point) => ({
      east: Math.max(acc.east, point[0]),
      north: Math.max(acc.north, point[1]),
      south: Math.min(acc.south, point[1]),
      west: Math.min(acc.west, point[0])
    }),
    { east: -Infinity, north: -Infinity, south: Infinity, west: Infinity }
  );
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

function geometryVisualCentroid(geometry: SituationFeature["geometry"]): [number, number] | null {
  const points: Array<[number, number]> = [];
  collectGeometryCoordinates(geometry.coordinates, points);
  if (points.length === 0) {
    return null;
  }
  const bounds = points.reduce(
    (acc, point) => ({
      east: Math.max(acc.east, point[0]),
      north: Math.max(acc.north, point[1]),
      south: Math.min(acc.south, point[1]),
      west: Math.min(acc.west, point[0])
    }),
    { east: -Infinity, north: -Infinity, south: Infinity, west: Infinity }
  );
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

function collectGeometryCoordinates(value: unknown, points: Array<[number, number]>): void {
  if (!Array.isArray(value)) {
    return;
  }
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    const lon = value[0];
    const lat = value[1];
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      points.push([lon, lat]);
    }
    return;
  }
  for (const child of value) {
    collectGeometryCoordinates(child, points);
  }
}

function buildSituationRenderProperties(
  feature: SituationFeature,
  mapSymbolMode: PublicFlightSymbolMode = "civil"
): Partial<SituationContextFeatureCollection["features"][number]["properties"]> {
  const status = situationFeatureStatus(feature);
  if (isTakGatewayFeature(feature)) {
    return {
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone,
      takGateway: true
    };
  }
  if (isMissionArenaFeature(feature)) {
    const role = missionArenaFeatureRole(feature);
    return {
      mapLabel: missionArenaMapLabel(feature),
      missionArena: true,
      missionArenaRole: role,
      missionArenaTeamColor: feature.properties.teamColor,
      situationStatusColor: missionArenaFeatureColor(feature),
      situationStatusLabel: role === "task_state" ? "ÚKOL" : role === "team_state" ? "TÝM" : "EVENT",
      situationStatusTone: "info"
    };
  }
  if (isBoundaryReferenceFeature(feature)) {
    return {
      boundaryLabel: formatBoundaryLabel(feature),
      boundaryReference: true,
      mapLabel: formatBoundaryLabel(feature),
      situationStatusColor: "#8cb6d8",
      situationStatusLabel: "HRANICE",
      situationStatusTone: "info"
    };
  }
  if (feature.properties.layer === "flight_airports") {
    return {
      osmCategoryLabel: "Letiště",
      osmPoi: true,
      osmSymbolKey: getOsmCategoryIconKey("airport"),
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  if (isCommunicationTowerFeature(feature)) {
    const referenceStatus = communicationTowerReferenceStatus();
    return {
      communicationTower: true,
      mobileNetworkLabel: formatCommunicationTowerLabel(feature),
      mobileSymbolKey: getMobileNetworkIconKey(referenceStatus.tone),
      situationStatusColor: referenceStatus.color,
      situationStatusLabel: referenceStatus.label,
      situationStatusTone: referenceStatus.tone
    };
  }
  if (isRadioOverlayFeature(feature)) {
    return buildRadioOverlayRenderProperties(feature);
  }
  const trailRoute = resolveTrailRoutePresentation(feature);
  if (trailRoute) {
    return {
      mapLabel: trailRoute.label,
      situationStatusColor: trailRoute.color,
      situationStatusLabel: "TRASA",
      situationStatusTone: "info",
      trailRoute: true,
      trailRouteColor: trailRoute.color,
      trailRouteLabel: trailRoute.label,
      trailRouteMode: trailRoute.mode
    };
  }
  const trailPoi = resolveTrailPoiPresentation(feature);
  if (trailPoi) {
    return {
      osmCategoryLabel: trailPoi.label,
      osmPoi: true,
      osmSymbolKey: getOsmCategoryIconKey(trailPoi.iconId),
      situationStatusColor: trailPoi.color,
      situationStatusLabel: "OUTDOOR",
      situationStatusTone: "info",
      trailPoi: true,
      trailPoiCategory: trailPoi.category,
      trailPoiLabel: trailPoi.label
    };
  }
  const communityPlace = resolveCommunityPlacePresentation(feature);
  if (communityPlace) {
    return {
      osmCategoryLabel: communityPlace.label,
      osmPoi: true,
      osmSymbolKey: getOsmCategoryIconKey(communityPlace.iconId),
      situationStatusColor: communityPlace.color,
      situationStatusLabel: "REFERENCE",
      situationStatusTone: "info"
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
  if (feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network") {
    return {
      coverageColor: status.color,
      coverageLabel: formatCoverageLabel(feature),
      coverageLineOpacity: coverageLineOpacityForFeature(feature),
      coverageOpacity: coverageOpacityForFeature(feature),
      coverageQuality: normalizeCoverageQuality(feature.properties.quality),
      coverageTechnology: feature.properties.technology,
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
  if (feature.properties.layer === "traffic") {
    return buildTrafficRenderProperties(feature, mapSymbolMode, status);
  }
  if (isSyntheticWarningPoint(feature)) {
    return {
      mapPointSuppressed: true,
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  if (isMapWebcamFeature(feature)) {
    const label = formatWeatherWebcamLabel(feature);
    return {
      mapPointSuppressed: true,
      situationStatusColor: "#38bdf8",
      situationStatusLabel: "KAMERA",
      situationStatusTone: "info",
      weatherCamera: true,
      weatherCameraLabel: label,
      weatherObservation: false
    };
  }
  if (isWeatherForecastAreaFeature(feature)) {
    const presentation = weatherForecastPresentation(feature);
    const symbolKey = recordString(presentation, "symbolKey");
    const riskScore = weatherForecastRiskScore(feature, presentation);
    const riskLevel = weatherForecastRiskLevel(feature, presentation);
    const colors = weatherForecastColors(riskScore, riskLevel, status.color);
    const label = weatherForecastMapLabel(feature, presentation);
    return {
      mapLabel: label,
      mapPointSuppressed: feature.geometry.type !== "Point" ? true : undefined,
      situationStatusColor: colors.fill,
      situationStatusLabel: weatherForecastStatusLabel(riskScore, riskLevel),
      situationStatusTone:
        weatherForecastTone(riskScore, riskLevel) === "bad"
          ? "critical"
          : weatherForecastTone(riskScore, riskLevel) === "warn"
            ? "warning"
            : "info",
      weatherForecastArea: true,
      weatherForecastDetailUrl: weatherForecastDetailUrl(feature),
      weatherForecastFillColor: colors.fill,
      weatherForecastLabel: label,
      weatherForecastLineColor: colors.line,
      weatherForecastRiskLevel: riskLevel,
      weatherForecastRiskScore: riskScore,
      weatherForecastSubtitle: weatherForecastSubtitle(feature, presentation),
      weatherForecastSymbolKey: getWeatherConditionIconKey(symbolKey ?? "measurement")
    };
  }
  if (isRiskFeature(feature)) {
    const kind = riskIconKind(feature);
    const floodStage = kind === "flood" ? floodStageValue(feature) : undefined;
    const floodTrend = kind === "flood" ? floodTrendDirection(feature.properties.trend) : undefined;
    const floodTone = kind === "flood" ? floodStageTone(floodStage) : undefined;
    const hydroMapPriority = kind === "flood" ? hydroMapPriorityScore(feature, floodStage, floodTrend) : undefined;
    return {
      riskFeature: true,
      ...(kind === "flood" && floodTrend && floodTone
        ? {
            floodStageLabel:
              typeof floodStage === "number" && floodStage > 0 ? `${Math.round(floodStage)}. SPA` : "bez SPA",
            floodTrendIconKey: getFloodTrendIconKey(floodTrend, floodTone),
            floodTrendLabel: floodTrendShortLabel(feature.properties.trend),
            hydroMapPriority
          }
        : {}),
      riskIconKey: getRiskIconKey(kind),
      riskKind: kind,
      riskMapLabel: formatRiskMapLabel(feature, status),
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  if (feature.properties.layer === "air_quality" || feature.properties.layer === "air_quality_grid") {
    const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
    const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
    const airQualityIndex = weatherMetricValue(feature, metrics, "airQualityIndex");
    const airQualityLevel =
      recordString(tags, "airQualityLevel") ??
      stringProperty(feature.properties.status) ??
      stringProperty(feature.properties.quality);
    const dominantPollutant = recordString(tags, "dominantPollutant");
    const color = airQualityColor(airQualityIndex, airQualityLevel, status.color);
    const label = formatAirQualityMapLabel(airQualityIndex, dominantPollutant, airQualityLevel);
    const weatherGrid = feature.properties.layer === "air_quality_grid" && feature.geometry.type !== "Point";
    return {
      airQualityDominantPollutant: dominantPollutant,
      airQualityFeature: true,
      airQualityIndex,
      airQualityLabel: label,
      airQualityLevel,
      mapLabel: label,
      mapPointSuppressed: weatherGrid ? true : undefined,
      situationStatusColor: color,
      situationStatusLabel: formatAirQualityStatusLabel(airQualityIndex, airQualityLevel, status.label),
      situationStatusTone: airQualityTone(airQualityIndex, airQualityLevel, status.tone),
      weatherFillColor: weatherGrid ? color : undefined,
      weatherFillOpacity: weatherGrid ? weatherGridFillOpacity(feature) : undefined,
      weatherGrid: weatherGrid ? true : undefined,
      weatherGridKind: weatherGrid ? "air_quality" : undefined,
      weatherLineColor: weatherGrid ? color : undefined,
      weatherMetricLabel: weatherGrid ? label.replace("\n", " ") : undefined
    };
  }
  if (!isWeatherContextFeature(feature)) {
    return {
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const aviationCategory = aviationFlightCategory(feature);
  const temperatureC = weatherMetricValue(feature, metrics, "temperatureC");
  const windSpeedMps = weatherMetricValue(feature, metrics, "windSpeedMps");
  const windGustMps = weatherMetricValue(feature, metrics, "windGustMps");
  const windDirectionDeg = recordNumber(metrics, "windDirectionDeg");
  const precipitationMm = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
  const cloudCoverPercent = recordNumber(metrics, "cloudCoverPercent");
  const humidityPercent = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
  const pressureHpa = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
  const stationIcao = stringProperty(tags.icaoId);
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  const weatherGrid = isWeatherGridFeature(feature);
  const currentWeatherSummary = isCurrentWeatherSummaryFeature(feature);
  const color = weatherContextColor(feature, status.color);
  const weatherDisplay = weatherDisplayRecord(feature);
  const chmiMeasuredStation =
    feature.properties.sourceId === "chmi_weather_stations" || providerLayerId?.includes("chmi_station") === true;
  const weatherCondition = weatherDisplay
    ? {
        iconId: weatherDisplayIconId(weatherDisplay, {
          humidityPercent,
          precipitationMm,
          temperatureC,
          windSpeedMps
        }),
        label: weatherDisplayConditionLabel(weatherDisplay)
      }
    : resolveWeatherConditionPresentation(
        feature,
        metrics,
        temperatureC,
        windSpeedMps,
        precipitationMm,
        cloudCoverPercent,
        humidityPercent,
        chmiMeasuredStation
      );
  const weatherStationLabel = formatWeatherStationLabel(feature, currentWeatherSummary);
  const weatherLabel = aviationCategory
    ? formatAviationWeatherMapLabel(stationIcao, aviationCategory.label)
    : weatherGrid
      ? formatWeatherContextMapLabel(feature, temperatureC, windSpeedMps, precipitationMm, humidityPercent, pressureHpa)
      : (weatherDisplayString(weatherDisplay, "label") ??
        formatWeatherObservationMapLabel(
          weatherStationLabel,
          weatherCondition.label,
          temperatureC,
          windSpeedMps,
          precipitationMm
        ));
  const weatherHeadline = aviationCategory
    ? undefined
    : (weatherDisplayString(weatherDisplay, "title") ??
      (currentWeatherSummary ? "Počasí ve středu oblasti" : formatWeatherFeatureHeadline(feature)));
  const weatherObservation =
    !weatherGrid && (currentWeatherSummary || feature.properties.layer !== "weather" || chmiMeasuredStation);
  const weatherMapPriority = weatherObservation
    ? weatherObservationMapPriority(temperatureC, windSpeedMps, windGustMps, precipitationMm, status.tone)
    : undefined;
  const displayTone = weatherDisplayTone(weatherDisplay);
  return {
    weatherCloudCoverPercent: cloudCoverPercent,
    weatherConditionLabel: weatherCondition.label,
    weatherFillColor: weatherGrid ? color : undefined,
    weatherFillOpacity: weatherGrid ? weatherGridFillOpacity(feature) : undefined,
    weatherFlightCategoryColor: aviationCategory ? aviationCategory.color : undefined,
    weatherGrid: weatherGrid ? true : undefined,
    weatherGridKind: weatherGrid ? feature.properties.layer : undefined,
    weatherHeadline,
    weatherLabel,
    weatherLineColor: weatherGrid ? color : undefined,
    weatherMapPriority,
    weatherMetricLabel: weatherGrid ? weatherLabel.replace("\n", " ") : undefined,
    weatherObservation,
    weatherSubtitle: aviationCategory
      ? undefined
      : (weatherDisplayString(weatherDisplay, "subtitle") ?? formatWeatherFeatureSubtitle(feature)),
    weatherPrecipitationMm: precipitationMm,
    weatherStationIcao: stationIcao,
    weatherStationLabel: weatherDisplayString(weatherDisplay, "title") ?? weatherStationLabel,
    weatherSymbolKey: weatherObservation ? getWeatherConditionIconKey(weatherCondition.iconId) : undefined,
    weatherTemperatureC: temperatureC,
    weatherValueLabel: weatherObservation
      ? formatWeatherValueLabel(weatherDisplay, temperatureC, windSpeedMps, precipitationMm, humidityPercent)
      : undefined,
    weatherWindDirectionDeg: windDirectionDeg,
    weatherWindSpeedMps: windSpeedMps,
    mapPointSuppressed: weatherGrid ? true : undefined,
    situationStatusColor: color,
    situationStatusLabel:
      weatherDisplayString(weatherDisplay, "badgeLabel") ?? weatherContextStatusLabel(feature, status.label),
    situationStatusTone: displayTone ?? status.tone
  };
}

function isSyntheticWarningPoint(feature: SituationFeature): boolean {
  return feature.geometry.type === "Point" && feature.properties.layer === "warnings";
}

function isRiskFeature(feature: SituationFeature): boolean {
  const tokens = riskTokens(feature);
  const presentation = riskPresentationIconKind(feature);
  return (
    feature.properties.layer === "warnings" ||
    feature.properties.layer === "weather_alerts" ||
    feature.properties.layer === "flood" ||
    feature.properties.layer === "fire" ||
    Boolean(presentation) ||
    ["fire", "wildfire", "flood", "warning", "weather_alert", "storm", "risk"].some((token) => tokens.includes(token))
  );
}

function riskIconKind(feature: SituationFeature): RiskIconId {
  const presentation = riskPresentationIconKind(feature);
  if (presentation) {
    return presentation;
  }
  const tokens = riskTokens(feature);
  if (feature.properties.layer === "fire" || tokens.includes("fire") || tokens.includes("wildfire")) {
    return "fire";
  }
  if (
    feature.properties.layer === "flood" ||
    tokens.includes("flood") ||
    tokens.includes("hydro") ||
    tokens.includes("water")
  ) {
    return "flood";
  }
  if (
    feature.properties.layer === "weather_alerts" ||
    tokens.includes("weather") ||
    tokens.includes("storm") ||
    tokens.includes("wind")
  ) {
    return "weather";
  }
  if (feature.properties.layer === "warnings" || tokens.includes("warning")) {
    return "warning";
  }
  return "unknown";
}

function riskPresentationIconKind(feature: SituationFeature): RiskIconId | undefined {
  const presentation = riskPresentation(feature);
  const iconKey = normalizeSituationCategory(stringProperty(presentation.iconKey));
  const styleKey = normalizeSituationCategory(stringProperty(presentation.styleKey));
  const code = [iconKey, styleKey].filter(Boolean).join(" ");
  if (!code) {
    return undefined;
  }
  if (code.includes("fire")) {
    return "fire";
  }
  if (code.includes("flood") || code.includes("hydro") || code.includes("water")) {
    return "flood";
  }
  if (
    code.includes("weather") ||
    code.includes("storm") ||
    code.includes("wind") ||
    code.includes("rain") ||
    code.includes("snow") ||
    code.includes("temperature")
  ) {
    return "weather";
  }
  if (code.includes("warning") || code.includes("alert") || code.includes("smog") || code.includes("air_quality")) {
    return "warning";
  }
  return undefined;
}

function riskPresentation(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function formatRiskMapLabel(feature: SituationFeature, status: { label: string }): string {
  const presentation = riskPresentation(feature);
  const headline =
    stringProperty(presentation.label) ??
    stringProperty(presentation.title) ??
    feature.properties.headline ??
    feature.properties.areaName ??
    feature.properties.label;
  const category = riskMapCategoryLabel(feature);
  if (feature.properties.layer === "flood") {
    const floodName = feature.properties.riverName ?? feature.properties.areaName ?? headline;
    const stage = floodStageValue(feature);
    const suffix = [typeof stage === "number" && stage > 0 ? `${Math.round(stage)}. SPA` : undefined]
      .filter(Boolean)
      .join(" · ");
    return [compactRiskHeadline(floodName), suffix].filter(Boolean).join(" ") || status.label || category;
  }
  if (!headline || headline === feature.properties.featureId) {
    return `${category}\n${status.label}`;
  }
  return `${category}\n${compactRiskHeadline(headline)}`;
}

function riskTokens(feature: SituationFeature): string {
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const taxonomy = isRecord(providerProperties.taxonomy) ? providerProperties.taxonomy : {};
  return [
    feature.properties.category,
    feature.properties.typeCode,
    feature.properties.sourceCode,
    feature.properties.iconHint,
    feature.properties.styleHint,
    feature.properties.status,
    feature.properties.severity,
    stringProperty(providerProperties.typeCode),
    stringProperty(providerProperties.sourceCode),
    stringProperty(providerProperties.domain),
    stringProperty(taxonomy.typeCode),
    stringProperty(taxonomy.sourceCode),
    stringProperty(taxonomy.domain),
    stringProperty(taxonomy.category)
  ]
    .map((value) => normalizeSituationCategory(value))
    .filter(Boolean)
    .join(" ");
}

function isBoundaryReferenceFeature(feature: SituationFeature): boolean {
  return (
    feature.properties.layer === "boundary_admin" ||
    feature.properties.layer === "boundary_country" ||
    feature.properties.layer === "boundary_region" ||
    feature.properties.layer === "boundary_district" ||
    feature.properties.layer === "boundary_orp" ||
    feature.properties.layer === "boundary_municipality" ||
    feature.properties.layer === "place_settlements" ||
    feature.properties.layerId === "public.boundary.admin" ||
    feature.properties.layerId?.startsWith("public.boundary.") === true ||
    feature.properties.layerId === "public.place.settlements" ||
    feature.properties.providerLayerId === "boundary.admin" ||
    feature.properties.providerLayerId?.startsWith("boundary.") === true ||
    feature.properties.providerLayerId === "place.settlements" ||
    normalizeSituationCategory(feature.properties.category) === "admin_boundary"
  );
}

function isWeatherContextFeature(feature: SituationFeature): boolean {
  return (
    feature.properties.layer === "weather" ||
    feature.properties.layer === "weather_temperature_grid" ||
    feature.properties.layer === "weather_wind_field" ||
    feature.properties.layer === "weather_precipitation_grid" ||
    feature.properties.layer === "weather_humidity_grid" ||
    feature.properties.layer === "weather_pressure_grid"
  );
}

function isWeatherForecastAreaFeature(feature: SituationFeature): boolean {
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return (
    feature.properties.layer === "weather_forecast_area" ||
    feature.properties.layerId === "public.weather.forecast_area" ||
    feature.properties.sourceId === "weather_forecast" ||
    providerLayerId === "weather.forecast_area" ||
    providerLayerId === "weather_forecast_area" ||
    providerLayerId === "public.weather.forecast_area"
  );
}

function weatherForecastProviderProperties(feature: SituationFeature): Record<string, unknown> {
  return isRecord(feature.properties.providerProperties) ? feature.properties.providerProperties : {};
}

function weatherForecastPresentation(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = weatherForecastProviderProperties(feature);
  return isRecord(providerProperties.presentation) ? providerProperties.presentation : {};
}

function weatherForecastDisplay(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = weatherForecastProviderProperties(feature);
  return isRecord(providerProperties.display) ? providerProperties.display : {};
}

function weatherForecastDetailUrl(feature: SituationFeature): string | undefined {
  const providerProperties = weatherForecastProviderProperties(feature);
  const display = weatherForecastDisplay(feature);
  const forecast = isRecord(providerProperties.weatherForecast) ? providerProperties.weatherForecast : {};
  return (
    recordString(display, "chartUrl") ??
    recordString(display, "detailUrl") ??
    recordString(forecast, "detailUrl") ??
    recordString(providerProperties, "detailUrl")
  );
}

function weatherForecastRiskScore(
  feature: SituationFeature,
  presentation: Record<string, unknown>
): number | undefined {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return recordNumber(metrics, "riskScore") ?? recordNumber(presentation, "riskScore");
}

function weatherForecastRiskLevel(
  feature: SituationFeature,
  presentation: Record<string, unknown>
): string | undefined {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return (
    recordString(presentation, "riskLevel") ??
    recordString(metrics, "riskLevel") ??
    stringProperty(feature.properties.severity) ??
    stringProperty(feature.properties.status)
  );
}

function weatherForecastColors(
  riskScore: number | undefined,
  riskLevel: string | undefined,
  fallback: string
): { fill: string; line: string } {
  const normalized = normalizeSituationCategory(riskLevel);
  const score =
    riskScore ??
    (normalized.includes("critical") || normalized.includes("extreme") || normalized.includes("veryhigh")
      ? 0.9
      : normalized.includes("high") || normalized.includes("warning")
        ? 0.72
        : normalized.includes("medium") || normalized.includes("moderate") || normalized.includes("advisory")
          ? 0.48
          : normalized.includes("low") || normalized.includes("minor")
            ? 0.22
            : 0);
  if (score >= 0.75) {
    return { fill: "#ef4444", line: "#b91c1c" };
  }
  if (score >= 0.5) {
    return { fill: "#f97316", line: "#c2410c" };
  }
  if (score >= 0.25) {
    return { fill: "#facc15", line: "#ca8a04" };
  }
  if (score > 0) {
    return { fill: "#a3e635", line: "#65a30d" };
  }
  return { fill: fallback, line: "#38bdf8" };
}

function weatherForecastTone(riskScore: number | undefined, riskLevel: string | undefined): "bad" | "ok" | "warn" {
  const normalized = normalizeSituationCategory(riskLevel);
  const score = riskScore ?? 0;
  if (score >= 0.75 || normalized.includes("critical") || normalized.includes("extreme")) {
    return "bad";
  }
  if (
    score >= 0.25 ||
    normalized.includes("warning") ||
    normalized.includes("advisory") ||
    normalized.includes("moderate")
  ) {
    return "warn";
  }
  return "ok";
}

function weatherForecastStatusLabel(riskScore: number | undefined, riskLevel: string | undefined): string {
  const tone = weatherForecastTone(riskScore, riskLevel);
  if (tone === "bad") {
    return "VYSOKÉ RIZIKO";
  }
  if (tone === "warn") {
    return "RIZIKO";
  }
  return "PŘEDPOVĚĎ";
}

function weatherForecastMapLabel(feature: SituationFeature, presentation: Record<string, unknown>): string {
  return (
    recordString(presentation, "mapLabel") ??
    recordString(presentation, "label") ??
    feature.properties.areaName ??
    feature.properties.label ??
    feature.properties.headline ??
    "Předpověď"
  );
}

function weatherForecastSubtitle(feature: SituationFeature, presentation: Record<string, unknown>): string {
  const providerProperties = weatherForecastProviderProperties(feature);
  const forecast = isRecord(providerProperties.weatherForecast) ? providerProperties.weatherForecast : {};
  const properties = feature.properties as unknown as Record<string, unknown>;
  return [
    recordString(presentation, "subtitle") ??
      recordString(forecast, "summary") ??
      recordString(properties, "description") ??
      recordString(properties, "summary"),
    sourceDisplayName(feature.properties.sourceId)
  ]
    .filter(Boolean)
    .join(" · ");
}

function isWeatherWebcamFeature(feature: SituationFeature): boolean {
  if (isOutdoorWebcamFeature(feature)) {
    return false;
  }
  const camera = weatherWebcamProviderMetadata(feature);
  const category = normalizeSituationCategory(feature.properties.category);
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return (
    feature.properties.layerId === "public.weather.webcams" ||
    feature.properties.sourceId === "chmi_weather_webcams" ||
    providerLayerId === "weather.webcams" ||
    providerLayerId === "weather_webcams" ||
    providerLayerId === "chmi_weather_webcams" ||
    category === "weather_webcam" ||
    category === "webcam" ||
    Boolean(stringProperty(camera.detailUrl) || stringProperty(camera.snapshotUrl))
  );
}

function isOutdoorWebcamFeature(feature: SituationFeature): boolean {
  const category = normalizeSituationCategory(feature.properties.category);
  const providerLayerId = stringProperty(feature.properties.providerLayerId);
  return (
    feature.properties.layer === "outdoor_webcams" ||
    feature.properties.layerId === "public.outdoor.webcams" ||
    providerLayerId === "outdoor.webcams" ||
    providerLayerId === "outdoor_webcams" ||
    providerLayerId === "public.outdoor.webcams" ||
    category === "outdoor_webcam" ||
    category === "tourism_webcam"
  );
}

function isMapWebcamFeature(feature: SituationFeature): boolean {
  return isWeatherWebcamFeature(feature) || isOutdoorWebcamFeature(feature);
}

function weatherWebcamProviderMetadata(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  return isRecord(providerProperties.camera) ? providerProperties.camera : {};
}

function formatWeatherWebcamLabel(feature: SituationFeature): string {
  const camera = weatherWebcamProviderMetadata(feature);
  const label =
    stringProperty(camera.label) ??
    stringProperty(camera.name) ??
    stringProperty(camera.title) ??
    feature.properties.headline ??
    feature.properties.label ??
    (isOutdoorWebcamFeature(feature) ? "Turistická webkamera" : "Webkamera ČHMÚ");
  return normalizeWeatherWebcamDisplayLabel(label);
}

function normalizeWeatherWebcamDisplayLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  return /^ČHMÚ webkamera\s+\d/i.test(trimmed) ? "Webkamera ČHMÚ" : trimmed;
}

function isCurrentWeatherSummaryFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    feature.properties.layerId === "public.weather.current" ||
    feature.properties.providerLayerId === "weather.open_meteo" ||
    (feature.properties.layer === "weather" && feature.properties.sourceId === "open_meteo") ||
    stringProperty(tags.mapDisplayHint) === "weather_observation_point"
  );
}

function isAviationWeatherFeature(feature: SituationFeature): boolean {
  return (
    feature.properties.sourceId === "aviation_weather" || feature.properties.category === "aviation_weather_station"
  );
}

function isWeatherGridFeature(feature: SituationFeature): boolean {
  if (feature.geometry.type === "Point") {
    return false;
  }
  return (
    feature.properties.layer === "weather_temperature_grid" ||
    feature.properties.layer === "weather_wind_field" ||
    feature.properties.layer === "weather_precipitation_grid" ||
    feature.properties.layer === "weather_humidity_grid" ||
    feature.properties.layer === "weather_pressure_grid"
  );
}

function weatherGridFillOpacity(feature: SituationFeature): number {
  switch (feature.properties.layer) {
    case "weather_precipitation_grid":
      return 0.34;
    case "weather_temperature_grid":
      return 0.3;
    case "air_quality_grid":
      return 0.28;
    case "weather_humidity_grid":
      return 0.24;
    case "weather_pressure_grid":
      return 0.2;
    case "weather_wind_field":
      return 0.18;
    default:
      return 0.24;
  }
}

function formatBoundaryLabel(feature: SituationFeature): string {
  return feature.properties.areaName ?? feature.properties.headline ?? feature.properties.label ?? "Správní hranice";
}

function riskLabelForKind(kind: RiskIconId): string {
  const labels: Record<RiskIconId, string> = {
    fire: "Požár",
    flood: "Vodní stav",
    unknown: "Riziko",
    warning: "Výstraha",
    weather: "Počasí"
  };
  return labels[kind];
}

function riskMapCategoryLabel(feature: SituationFeature): string {
  const presentation = riskPresentation(feature);
  const label = stringProperty(presentation.label) ?? stringProperty(presentation.title);
  if (label) {
    return compactRiskHeadline(label);
  }
  return riskLabelForKind(riskIconKind(feature));
}

function riskDefaultColor(feature: SituationFeature): string {
  switch (riskIconKind(feature)) {
    case "fire":
      return "#fb923c";
    case "flood":
      return floodRiskColor(feature);
    case "weather":
      return "#facc15";
    case "warning":
      return "#ef4444";
    default:
      return "#a78bfa";
  }
}

function compactRiskHeadline(value: string | undefined): string {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.length > 22 ? `${compact.slice(0, 21)}…` : compact;
}

function floodStageValue(feature: SituationFeature): number | undefined {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  return numberProperty(feature.properties.floodStage) ?? recordNumber(metrics, "floodActivityLevel");
}

function floodRiskColor(feature: SituationFeature): string {
  const stage = floodStageValue(feature);
  if (stage === undefined || stage <= 0) {
    return "#22c55e";
  }
  if (stage === 1) {
    return "#facc15";
  }
  return "#ef4444";
}

function floodStageTone(value: number | undefined): FloodStageTone {
  if (value === undefined || value <= 0) {
    return "ok";
  }
  if (value === 1) {
    return "warn";
  }
  return "critical";
}

function hydroMapPriorityScore(
  feature: SituationFeature,
  floodStage: number | undefined,
  trend: FloodTrendDirection | undefined
): number {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  let priority = 35;
  if (floodStage !== undefined) {
    if (floodStage >= 3) {
      priority = Math.max(priority, 100);
    } else if (floodStage >= 2) {
      priority = Math.max(priority, 92);
    } else if (floodStage >= 1) {
      priority = Math.max(priority, 82);
    }
  }
  if (trend === "rising") {
    priority = Math.max(priority, 76);
  } else if (trend === "falling") {
    priority = Math.max(priority, 58);
  }

  const waterLevelCm = numberProperty(feature.properties.waterLevelCm) ?? recordNumber(metrics, "waterLevelCm");
  const spa1Cm = recordNumber(metrics, "spa1Cm");
  const discharge =
    numberProperty(feature.properties.discharge) ??
    recordNumber(metrics, "discharge") ??
    recordNumber(metrics, "flowM3s");
  const spa1FlowM3s = recordNumber(metrics, "spa1FlowM3s");
  const levelRatio = spa1Cm && spa1Cm > 0 && waterLevelCm !== undefined ? waterLevelCm / spa1Cm : undefined;
  const flowRatio = spa1FlowM3s && spa1FlowM3s > 0 && discharge !== undefined ? discharge / spa1FlowM3s : undefined;
  const thresholdRatio = Math.max(levelRatio ?? 0, flowRatio ?? 0);
  if (thresholdRatio >= 1) {
    priority = Math.max(priority, 82);
  } else if (thresholdRatio >= 0.8) {
    priority = Math.max(priority, 72);
  } else if (thresholdRatio >= 0.6) {
    priority = Math.max(priority, 62);
  }
  return priority;
}

function floodTrendDirection(value: string | undefined): FloodTrendDirection {
  switch (value) {
    case "rising":
      return "rising";
    case "falling":
      return "falling";
    case "stable":
      return "stable";
    default:
      return "stable";
  }
}

function floodTrendShortLabel(value: string | undefined): string {
  switch (floodTrendDirection(value)) {
    case "rising":
      return "stoupá";
    case "falling":
      return "klesá";
    case "stable":
      return "stabilní";
  }
}

function isCommunicationTowerFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const providerLayerId = feature.properties.providerLayerId ?? stringProperty(providerProperties.providerLayerId);
  return (
    feature.properties.layer === "mobile" &&
    normalizeSituationCategory(feature.properties.category) === "communications_tower" &&
    (feature.properties.sourceId === "osm_postgis" ||
      feature.properties.layerId === "reference.infrastructure.communications" ||
      providerLayerId === "mobile.osm_postgis.communications" ||
      stringProperty(tags.referenceOnly) === "true" ||
      stringProperty(providerTags.referenceOnly) === "true")
  );
}

function isRadioInputFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return feature.properties.sourceId === "radio_los_input" || stringProperty(tags.radioInput) === "true";
}

function isRadioOverlayFeature(feature: SituationFeature): boolean {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return (
    isRadioInputFeature(feature) ||
    feature.properties.sourceId === "radio_los_model" ||
    feature.properties.layerId?.startsWith("analysis.radio.") === true ||
    stringProperty(tags.radioOverlay) === "true"
  );
}

function formatRadioInputFeatureLabel(feature: SituationFeature): string {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return stringProperty(tags.radioInputRoleLabel) ?? feature.properties.label ?? "Radio vstup";
}

function buildRadioOverlayRenderProperties(
  feature: SituationFeature
): Partial<SituationContextFeatureCollection["features"][number]["properties"]> {
  const input = isRadioInputFeature(feature);
  const quality = normalizeCoverageQuality(feature.properties.quality);
  const status = input ? { color: "#38bdf8", label: "VSTUP", tone: "info" } : mobileCoverageStatus(quality);
  const confidence = clampUnit(numberProperty(feature.properties.confidence) ?? (input ? 1 : 0.55));
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const mode =
    stringProperty(tags.radioOverlayMode) ??
    feature.properties.layerId?.replace(/^analysis\.radio\./u, "") ??
    (input ? "input" : "coverage");
  const kind = input ? "input" : mode;
  const label = input
    ? formatRadioInputFeatureLabel(feature)
    : (feature.properties.label ?? feature.properties.summary ?? status.label);
  const fillOpacity = input ? 0.06 : 0.08 + confidence * 0.2;
  const lineOpacity = input ? 0.86 : 0.48 + confidence * 0.34;
  return {
    coverageColor: status.color,
    coverageLabel: label,
    coverageLineOpacity: lineOpacity,
    coverageOpacity: fillOpacity,
    coverageQuality: quality,
    mapLabel: label,
    mapPointSuppressed: feature.geometry.type === "Point" ? true : undefined,
    radioFillColor: status.color,
    radioFillOpacity: fillOpacity,
    radioLabel: feature.geometry.type === "Point" ? label : undefined,
    radioLineColor: input ? "#38bdf8" : status.color,
    radioLineOpacity: lineOpacity,
    radioOverlay: true,
    radioOverlayKind: kind,
    radioPointColor: input ? "#38bdf8" : status.color,
    radioPointHaloColor: input ? "#e0f2fe" : status.color,
    situationStatusColor: status.color,
    situationStatusLabel: status.label,
    situationStatusTone: status.tone
  };
}

function situationFeatureStatus(feature: SituationFeature): { color: string; label: string; tone: string } {
  if (isMissionArenaFeature(feature)) {
    const role = missionArenaFeatureRole(feature);
    return {
      color: missionArenaFeatureColor(feature),
      label:
        role === "task_state"
          ? missionArenaTaskRoleLabel(feature)
          : role === "team_state"
            ? (missionArenaTeamLabel(feature) ?? "TÝM")
            : feature.properties.runtimeMode === "live"
              ? "LIVE"
              : "EVENT",
      tone: "info"
    };
  }
  if (feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network") {
    const coverage = mobileCoverageStatus(feature.properties.quality);
    return feature.properties.stale
      ? {
          ...coverage,
          label: `${coverage.label} · starší data`,
          tone: coverage.tone === "info" ? "warning" : coverage.tone
        }
      : coverage;
  }
  if (isCommunicationTowerFeature(feature)) {
    return communicationTowerReferenceStatus();
  }
  if (feature.properties.layer === "flight_airports") {
    return { color: "#38bdf8", label: "REFERENČNÍ", tone: "info" };
  }
  if (feature.properties.layer === "flight_airspaces") {
    const severity = feature.properties.severity?.trim().toLowerCase();
    if (severity === "critical") {
      return { color: "#ef4444", label: "KRITICKÝ", tone: "critical" };
    }
    if (severity === "warning") {
      return { color: "#facc15", label: "OMEZENÍ", tone: "warning" };
    }
    return { color: "#38bdf8", label: "PROSTOR", tone: "info" };
  }
  if (isRiskFeature(feature)) {
    const rawRisk = (
      feature.properties.hazardSeverity ??
      feature.properties.severity ??
      feature.properties.status ??
      feature.properties.urgency ??
      "info"
    )
      .trim()
      .toLowerCase();
    if (["critical", "extreme", "severe", "danger", "emergency", "red"].includes(rawRisk)) {
      return { color: "#ef4444", label: "KRITICKÉ", tone: "critical" };
    }
    if (["warning", "high", "orange", "watch"].includes(rawRisk)) {
      return { color: "#fb923c", label: "VÝSTRAHA", tone: "warning" };
    }
    if (["advisory", "moderate", "yellow", "limited"].includes(rawRisk)) {
      return { color: "#facc15", label: "UPOZORNĚNÍ", tone: "advisory" };
    }
    if (["ok", "green", "info", "low"].includes(rawRisk)) {
      return { color: riskDefaultColor(feature), label: "INFO", tone: "info" };
    }
    return { color: riskDefaultColor(feature), label: rawRisk.toUpperCase(), tone: "unknown" };
  }
  if (feature.properties.stale) {
    return { color: "#facc15", label: "starší data", tone: "warning" };
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
  const raw =
    stringProperty(tags.status) ??
    stringProperty(tags.networkStatus) ??
    stringProperty(metrics.status) ??
    stringProperty(metrics.networkStatus) ??
    feature.properties.severity ??
    "info";
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

function communicationTowerReferenceStatus(): { color: string; label: string; tone: string } {
  return { color: "#8cb6d8", label: "REFERENČNÍ", tone: "reference" };
}

function mobileCoverageStatus(quality: string | undefined): { color: string; label: string; tone: string } {
  switch (normalizeCoverageQuality(quality)) {
    case "good":
      return { color: "#22c55e", label: "DOBRÉ", tone: "info" };
    case "fair":
      return { color: "#facc15", label: "SLUŠNÉ", tone: "warning" };
    case "weak":
      return { color: "#fb923c", label: "SLABÉ", tone: "advisory" };
    case "none":
      return { color: "#ef4444", label: "BEZ SIGNÁLU", tone: "critical" };
    default:
      return { color: "#64748b", label: "NEZNÁMÉ", tone: "unknown" };
  }
}

function normalizeCoverageQuality(quality: string | undefined): string {
  const normalized = quality?.trim().toLowerCase();
  return normalized === "good" ||
    normalized === "fair" ||
    normalized === "weak" ||
    normalized === "none" ||
    normalized === "unknown"
    ? normalized
    : "unknown";
}

function formatCoverageLabel(feature: SituationFeature): string {
  const technology = feature.properties.technology ?? "MOBILE";
  const status = mobileCoverageStatus(feature.properties.quality);
  return `${technology} ${status.label}`;
}

function aviationFlightCategory(feature: SituationFeature): { color: string; label: string; tone: string } | null {
  if (
    feature.properties.sourceId !== "aviation_weather" &&
    feature.properties.category !== "aviation_weather_station"
  ) {
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
  const raw =
    stringProperty(tags.accessTechnology) ??
    stringProperty(tags.catTechnology) ??
    stringProperty(tags.networkType) ??
    stringProperty(tags.networkGeneration) ??
    stringProperty(tags.technology) ??
    stringProperty(tags.radioAccessTechnology) ??
    stringProperty(tags.rat) ??
    stringProperty(tags.standard) ??
    stringProperty(tags.type) ??
    stringProperty(metrics.accessTechnology) ??
    stringProperty(metrics.catTechnology) ??
    stringProperty(metrics.networkType) ??
    stringProperty(metrics.networkGeneration) ??
    stringProperty(metrics.technology) ??
    stringProperty(metrics.radioAccessTechnology) ??
    stringProperty(metrics.rat) ??
    stringProperty(metrics.standard) ??
    stringProperty(metrics.type) ??
    stringProperty(feature.properties.category);

  return normalizeMobileNetworkLabel(raw) ?? "MOBILE";
}

function formatCommunicationTowerLabel(feature: SituationFeature): string {
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const label = abbreviateCommunicationTowerLabel(feature.properties.label);
  if (label) {
    return label;
  }
  const towerType = stringProperty(tags.towerType) ?? stringProperty(tags.communication);
  return abbreviateCommunicationTowerLabel(towerType) ?? "BTS";
}

function abbreviateCommunicationTowerLabel(raw: string | undefined): string | undefined {
  const label = raw?.trim();
  if (!label) {
    return undefined;
  }
  const normalized = normalizeCompactAscii(label);
  if (!normalized || genericCommunicationTowerLabels.has(normalized)) {
    return undefined;
  }
  if (normalized.includes("gsmr")) {
    return "GSM-R";
  }
  if (
    (normalized.includes("5g") || normalized.includes("nr")) &&
    (normalized.includes("4g") || normalized.includes("lte"))
  ) {
    return "4G/5G";
  }
  if (normalized.includes("5g") || normalized.includes("nr")) {
    return "5G";
  }
  if (normalized.includes("4g") || normalized.includes("lte")) {
    return "4G";
  }
  if (normalized.includes("gsm")) {
    return "GSM";
  }
  if (normalized.includes("ceskeradiokomunikace")) {
    return "CRA";
  }
  if (
    normalized.includes("mobilephone") ||
    normalized.includes("cellular") ||
    normalized.includes("basestation") ||
    normalized.includes("bts")
  ) {
    return "BTS";
  }
  if (normalized.includes("television") || normalized === "tv") {
    return "TV";
  }
  if (normalized.includes("microwave")) {
    return "MW";
  }
  if (normalized.includes("radio")) {
    return "RAD";
  }
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) {
    const acronym = words
      .slice(0, 4)
      .map((word) => word[0]?.toUpperCase())
      .join("");
    if (acronym.length >= 2 && acronym.length <= 5) {
      return acronym;
    }
  }
  const compact = label.replace(/\s+/g, " ").toUpperCase();
  return compact.length > 0 ? (compact.length > 8 ? `${compact.slice(0, 7)}…` : compact) : undefined;
}

function normalizeMobileNetworkLabel(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.toLowerCase().replace(/[_\s.-]+/g, "");
  if (
    (normalized.includes("5g") || normalized.includes("nr")) &&
    (normalized.includes("4g") || normalized.includes("lte"))
  ) {
    return "4G/5G";
  }
  if (normalized.includes("5g") || normalized.includes("nr")) {
    return "5G";
  }
  if (normalized.includes("4g") || normalized.includes("lte")) {
    return "4G";
  }
  if (
    normalized.includes("3g") ||
    normalized.includes("umts") ||
    normalized.includes("wcdma") ||
    normalized.includes("hspa")
  ) {
    return "3G";
  }
  if (
    normalized.includes("2g") ||
    normalized.includes("gsm") ||
    normalized.includes("gprs") ||
    normalized.includes("edge")
  ) {
    return "2G";
  }
  if (normalized.includes("mobile") || normalized.includes("cellular") || normalized.includes("network")) {
    return "MOBILE";
  }
  const compact = raw.trim().replace(/\s+/g, " ").toUpperCase();
  return compact.length > 0 ? compact.slice(0, 10) : undefined;
}

function buildTrafficRenderProperties(
  feature: SituationFeature,
  mapSymbolMode: PublicFlightSymbolMode,
  status: { color: string; label: string; tone: string }
): Partial<SituationContextFeatureCollection["features"][number]["properties"]> {
  const presentation = resolveTransportPresentation(feature);
  if (!presentation) {
    return {
      situationStatusColor: status.color,
      situationStatusLabel: status.label,
      situationStatusTone: status.tone
    };
  }
  void mapSymbolMode;
  const color = feature.properties.stale ? status.color : presentation.color;
  if (presentation.kind === "stop") {
    return {
      mapLabel: presentation.stopName ?? presentation.mapLabel,
      situationStatusColor: color,
      situationStatusLabel: "ZASTÁVKA",
      situationStatusTone: status.tone,
      trafficRouteType: presentation.kind,
      trafficStaticStop: true,
      trafficStopName: presentation.stopName ?? presentation.mapLabel,
      trafficSymbolKey: getTransitIconKey("stop")
    };
  }
  return {
    mapLabel: presentation.mapLabel,
    situationStatusColor: color,
    situationStatusLabel: presentation.label.toUpperCase(),
    situationStatusTone: status.tone,
    trafficHeadingDeg: presentation.headingDeg,
    trafficRouteShortName: presentation.mapLabel,
    trafficRouteType: presentation.kind,
    trafficSymbolKey: getTransitIconKey(presentation.kind),
    trafficTransit: true
  };
}

const genericCommunicationTowerLabels = new Set([
  "communication",
  "communications",
  "communicationtower",
  "communicationstower",
  "communicationstowers",
  "communicationmast",
  "communicationmasts",
  "telecommunication",
  "telecommunications",
  "telecom",
  "tower",
  "mast",
  "yes"
]);

function normalizeCompactAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_\s./-]+/g, "");
}

function resolveOsmCategoryPresentation(
  feature: SituationFeature
): { iconId: OsmCategoryIconId; label: string } | null {
  if (feature.properties.sourceId !== "osm_postgis") {
    return null;
  }
  const normalized = normalizeSituationCategory(feature.properties.category);
  if (
    [
      "hospital",
      "clinic",
      "doctors",
      "healthcare_hospital",
      "healthcare_clinic",
      "healthcare_doctor",
      "ambulance_station"
    ].includes(normalized)
  ) {
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

function resolveTrailRoutePresentation(
  feature: SituationFeature
): { color: string; label: string; mode: string } | null {
  if (feature.properties.layer !== "trail_routes") {
    return null;
  }
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const trail = isRecord(providerProperties.trail) ? providerProperties.trail : {};
  const display = isRecord(providerProperties.display) ? providerProperties.display : {};
  const mode = normalizeSituationCategory(recordString(trail, "mode") ?? feature.properties.category);
  const ref = recordString(trail, "ref") ?? recordString(display, "label");
  const modeLabel = trailRouteModeLabel(mode);
  const label = [ref, modeLabel].filter(Boolean).join(" · ") || feature.properties.label || "Turistická trasa";
  return {
    color: recordString(display, "colorHex") ?? recordString(display, "strokeColor") ?? trailRouteColor(mode),
    label,
    mode: mode || "trail_route"
  };
}

function resolveTrailPoiPresentation(
  feature: SituationFeature
): { category: string; color: string; iconId: OsmCategoryIconId; label: string } | null {
  if (feature.properties.layer !== "trail_poi") {
    return null;
  }
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const trailPoi = isRecord(providerProperties.trailPoi) ? providerProperties.trailPoi : {};
  const display = isRecord(providerProperties.display) ? providerProperties.display : {};
  const category = normalizeSituationCategory(recordString(trailPoi, "category") ?? feature.properties.category);
  const label =
    localizedDisplayValue(trailPoi.categoryLabelLocalized) ??
    recordString(display, "label") ??
    feature.properties.label ??
    trailPoiCategoryLabel(category);
  return {
    category,
    color: recordString(display, "colorHex") ?? "#84cc16",
    iconId: trailPoiIconId(category),
    label
  };
}

function resolveCommunityPlacePresentation(
  feature: SituationFeature
): { color: string; iconId: OsmCategoryIconId; label: string } | null {
  if (feature.properties.layer !== "community_places") {
    return null;
  }
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const community = isRecord(providerProperties.community) ? providerProperties.community : {};
  const display = isRecord(providerProperties.display) ? providerProperties.display : {};
  const category = normalizeSituationCategory(
    recordString(community, "categoryGroup") ?? recordString(community, "category") ?? feature.properties.category
  );
  const label =
    localizedDisplayValue(community.categoryLabelLocalized) ??
    recordString(display, "label") ??
    recordString(community, "categoryLabel") ??
    feature.properties.label ??
    communityPlaceCategoryLabel(category);
  return {
    color: recordString(display, "colorHex") ?? communityPlaceColor(category),
    iconId: communityPlaceIconId(category),
    label
  };
}

function localizedDisplayValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return stringProperty(value.cs) ?? stringProperty(value.en);
}

function trailRouteModeLabel(mode: string): string {
  switch (mode) {
    case "cycling_route":
      return "cyklo";
    case "foot_route":
      return "pěší";
    case "hiking_route":
      return "turistika";
    case "mtb_route":
      return "MTB";
    default:
      return mode || "trasa";
  }
}

function trailRouteColor(mode: string): string {
  switch (mode) {
    case "cycling_route":
      return "#38bdf8";
    case "mtb_route":
      return "#f97316";
    case "foot_route":
    case "hiking_route":
      return "#84cc16";
    default:
      return "#84cc16";
  }
}

function trailPoiCategoryLabel(category: string): string {
  switch (category) {
    case "camp":
      return "Tábořiště";
    case "emergency":
      return "Nouzový bod";
    case "food":
      return "Občerstvení";
    case "rental":
      return "Půjčovna";
    case "repair":
      return "Servis";
    case "shelter":
      return "Přístřešek";
    case "sleep":
      return "Ubytování";
    case "transport":
      return "Doprava";
    case "water":
      return "Voda";
    default:
      return "Outdoor bod";
  }
}

function trailPoiIconId(category: string): OsmCategoryIconId {
  switch (category) {
    case "camp":
    case "shelter":
    case "sleep":
      return "shelter";
    case "emergency":
      return "fire_station";
    case "transport":
      return "other";
    default:
      return "other";
  }
}

function communityPlaceCategoryLabel(category: string): string {
  switch (category) {
    case "accessibility":
      return "Přístupnost";
    case "aed":
    case "defibrillator":
      return "AED";
    case "charging":
    case "charging_station":
      return "Nabíjení";
    case "drinking_water":
    case "water":
      return "Voda";
    case "health":
    case "healthcare":
    case "pharmacy":
      return "Zdravotní bod";
    case "library":
      return "Knihovna";
    case "office":
    case "public_service":
    case "townhall":
      return "Veřejná služba";
    case "shower":
      return "Sprcha";
    case "shelter":
      return "Přístřeší";
    case "toilet":
    case "wc":
      return "WC";
    default:
      return "Komunitní místo";
  }
}

function communityPlaceIconId(category: string): OsmCategoryIconId {
  if (category.includes("aed") || category.includes("defibrillator")) {
    return "aed";
  }
  if (category.includes("toilet") || category === "wc") {
    return "toilet";
  }
  if (category.includes("water")) {
    return "water";
  }
  if (category.includes("shower")) {
    return "shower";
  }
  if (category.includes("charging")) {
    return "charging";
  }
  if (category.includes("pharmacy") || category.includes("health")) {
    return "pharmacy";
  }
  if (category.includes("shelter")) {
    return "shelter";
  }
  if (category.includes("library")) {
    return "library";
  }
  if (category.includes("office") || category.includes("townhall") || category.includes("public_service")) {
    return "townhall";
  }
  return "community";
}

function communityPlaceColor(category: string): string {
  switch (communityPlaceIconId(category)) {
    case "aed":
      return "#ef4444";
    case "charging":
      return "#facc15";
    case "pharmacy":
      return "#22c55e";
    case "shelter":
      return "#f59e0b";
    case "toilet":
      return "#a78bfa";
    case "water":
      return "#38bdf8";
    default:
      return "#14b8a6";
  }
}

function normalizeSituationCategory(category: string | undefined): string {
  return (category ?? "").toLowerCase().replace(/[\s.-]+/g, "_");
}

interface WeatherConditionPresentation {
  iconId: WeatherConditionIconId;
  label: string;
}

function formatWeatherStationLabel(feature: SituationFeature, currentWeatherSummary: boolean): string {
  if (currentWeatherSummary) {
    return "Střed mapy";
  }
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const station = isRecord(providerProperties.station) ? providerProperties.station : {};
  return (
    stringProperty(feature.properties.label) ??
    stringProperty(feature.properties.headline) ??
    recordString(tags, "stationName") ??
    recordString(tags, "name") ??
    recordString(providerProperties, "stationName") ??
    recordString(providerProperties, "name") ??
    recordString(station, "name") ??
    "Počasí"
  );
}

function formatWeatherObservationMapLabel(
  stationLabel: string,
  conditionLabel: string,
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined
): string {
  const metrics: string[] = [];
  if (temperatureC !== undefined) {
    metrics.push(`${Math.round(temperatureC)}°C`);
  }
  if (precipitationMm !== undefined && precipitationMm > 0) {
    metrics.push(`déšť ${formatPrecipitationAmount(precipitationMm)}/10 min`);
  } else if (windSpeedMps !== undefined && windSpeedMps >= 0.5) {
    metrics.push(`vítr ${Math.round(windSpeedMps)} m/s`);
  }
  const primary = truncateMapLabel(stationLabel, 22);
  const secondary = metrics.length > 0 ? metrics.slice(0, 2).join(" · ") : conditionLabel;
  return secondary ? `${primary}\n${secondary}` : primary;
}

function weatherObservationMapPriority(
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  windGustMps: number | undefined,
  precipitationMm: number | undefined,
  tone: string | undefined
): number {
  let priority = 55;
  if (tone === "critical") {
    priority = Math.max(priority, 100);
  } else if (tone === "warning") {
    priority = Math.max(priority, 90);
  } else if (tone === "advisory") {
    priority = Math.max(priority, 75);
  }
  if (precipitationMm !== undefined) {
    if (precipitationMm >= 2) {
      priority = Math.max(priority, 96);
    } else if (precipitationMm >= 0.3) {
      priority = Math.max(priority, 82);
    } else if (precipitationMm >= 0.05) {
      priority = Math.max(priority, 68);
    }
  }
  const strongestWindMps = Math.max(windSpeedMps ?? 0, windGustMps ?? 0);
  if (strongestWindMps >= 20) {
    priority = Math.max(priority, 96);
  } else if (strongestWindMps >= 12) {
    priority = Math.max(priority, 86);
  } else if (strongestWindMps >= 7) {
    priority = Math.max(priority, 72);
  }
  if (temperatureC !== undefined) {
    if (temperatureC >= 34 || temperatureC <= -12) {
      priority = Math.max(priority, 94);
    } else if (temperatureC >= 30 || temperatureC <= -6) {
      priority = Math.max(priority, 78);
    }
  }
  return priority;
}

function truncateMapLabel(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function resolveWeatherConditionPresentation(
  feature: SituationFeature,
  metrics: Record<string, unknown>,
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined,
  cloudCoverPercent: number | undefined,
  humidityPercent: number | undefined,
  preferMeasuredIcon = false
): WeatherConditionPresentation {
  const metadataRecords = weatherMetadataRecords(feature);
  const explicitIconId = firstRecordString(
    metadataRecords,
    "weatherSymbolKey",
    "weatherConditionKey",
    "conditionKey",
    "symbolKey",
    "iconKey",
    "icon"
  );
  const explicitLabel = firstRecordString(
    metadataRecords,
    "weatherConditionLabel",
    "conditionLabel",
    "weatherLabel",
    "badgeLabel",
    "condition"
  );
  if (explicitIconId) {
    const iconId = normalizeWeatherConditionIconId(explicitIconId);
    return { iconId, label: explicitLabel ?? weatherConditionDefaultLabel(iconId) };
  }

  const weatherCode =
    firstRecordNumber(metrics, "weatherCode", "wmoCode", "wmoWeatherCode", "openMeteoWeatherCode") ??
    firstRecordNumberFromRecords(metadataRecords, "weatherCode", "wmoCode", "wmoWeatherCode", "openMeteoWeatherCode");
  if (weatherCode !== undefined) {
    const iconId = weatherConditionIconFromWmoCode(weatherCode);
    return { iconId, label: explicitLabel ?? weatherConditionDefaultLabel(iconId) };
  }

  if (preferMeasuredIcon) {
    const iconId = measuredWeatherFallbackIconId(temperatureC, windSpeedMps, precipitationMm, humidityPercent);
    return { iconId, label: explicitLabel ?? weatherConditionDefaultLabel(iconId) };
  }

  const inferredIconId = inferWeatherConditionIconId(
    temperatureC,
    windSpeedMps,
    precipitationMm,
    cloudCoverPercent,
    humidityPercent
  );
  return { iconId: inferredIconId, label: explicitLabel ?? weatherConditionDefaultLabel(inferredIconId) };
}

function weatherDisplayRecord(feature: SituationFeature): Record<string, unknown> | undefined {
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  return isRecord(providerProperties.display) ? providerProperties.display : undefined;
}

function weatherDisplayString(display: Record<string, unknown> | undefined, key: string): string | undefined {
  return display ? recordString(display, key) : undefined;
}

function weatherDisplayIconId(
  display: Record<string, unknown>,
  metrics: {
    humidityPercent?: number;
    precipitationMm?: number;
    temperatureC?: number;
    windSpeedMps?: number;
  } = {}
): WeatherConditionIconId {
  const iconKey = recordString(display, "iconKey");
  const conditionMode = recordString(display, "conditionMode");
  if (iconKey) {
    const normalized = normalizeWeatherConditionIconId(iconKey);
    return normalized === "measurement" ? measurementWeatherIconId(display, metrics) : normalized;
  }
  if (conditionMode === "unclassified" || conditionMode === "measured") {
    return measurementWeatherIconId(display, metrics);
  }
  return "unknown";
}

function measurementWeatherIconId(
  display: Record<string, unknown>,
  metrics: {
    humidityPercent?: number;
    precipitationMm?: number;
    temperatureC?: number;
    windSpeedMps?: number;
  }
): WeatherConditionIconId {
  const primaryIcon = measurementIconFromText(recordString(display, "primaryValue"));
  if (primaryIcon) {
    return primaryIcon;
  }
  const sourceText = [
    recordString(display, "secondaryValue"),
    recordString(display, "tertiaryValue"),
    recordString(display, "label"),
    recordString(display, "subtitle")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    (metrics.precipitationMm ?? 0) > 0 ||
    sourceText.includes("sráž") ||
    sourceText.includes("déšť") ||
    sourceText.includes("rain")
  ) {
    return "measurement_rain";
  }
  if ((metrics.windSpeedMps ?? 0) >= 0.5 || sourceText.includes("vítr") || sourceText.includes("wind")) {
    return "measurement_wind";
  }
  if (
    metrics.temperatureC !== undefined ||
    /[-+]?\d+(?:[.,]\d+)?\s*°?\s*c\b/u.test(sourceText) ||
    sourceText.includes("teplot")
  ) {
    return "measurement_temperature";
  }
  if (metrics.humidityPercent !== undefined || sourceText.includes("vlhkost") || sourceText.includes("humidity")) {
    return "measurement_humidity";
  }
  return "measurement";
}

function measuredWeatherFallbackIconId(
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined,
  humidityPercent: number | undefined
): WeatherConditionIconId {
  if (precipitationMm !== undefined && precipitationMm > 0) {
    return temperatureC !== undefined && temperatureC <= 1.5 ? "snow" : "rain";
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 7) {
    return "wind";
  }
  if (temperatureC !== undefined) {
    return "measurement_temperature";
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 0.5) {
    return "measurement_wind";
  }
  if (humidityPercent !== undefined) {
    return "measurement_humidity";
  }
  return "measurement";
}

function measurementIconFromText(value: string | undefined): WeatherConditionIconId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.includes("sráž") ||
    normalized.includes("déšť") ||
    normalized.includes("rain") ||
    normalized.includes("mm")
  ) {
    return "measurement_rain";
  }
  if (normalized.includes("vítr") || normalized.includes("wind") || /\bm\/s\b/u.test(normalized)) {
    return "measurement_wind";
  }
  if (/[-+]?\d+(?:[.,]\d+)?\s*°?\s*c\b/u.test(normalized) || normalized.includes("teplot")) {
    return "measurement_temperature";
  }
  if (normalized.includes("vlhkost") || normalized.includes("humidity") || normalized.includes("%")) {
    return "measurement_humidity";
  }
  return undefined;
}

function formatWeatherValueLabel(
  display: Record<string, unknown> | undefined,
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined,
  humidityPercent: number | undefined
): string | undefined {
  const primaryValue = weatherDisplayString(display, "primaryValue");
  const normalizedPrimary = primaryValue ? compactWeatherDisplayValue(primaryValue) : undefined;
  if (normalizedPrimary) {
    return normalizedPrimary;
  }
  if (temperatureC !== undefined) {
    return `${Math.round(temperatureC)}°C`;
  }
  if (precipitationMm !== undefined && precipitationMm > 0) {
    return `${formatPrecipitationAmount(precipitationMm)}`;
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 0.5) {
    return `${Math.round(windSpeedMps)} m/s`;
  }
  if (humidityPercent !== undefined) {
    return `${Math.round(humidityPercent)}%`;
  }
  return undefined;
}

function compactWeatherDisplayValue(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "n/a") {
    return undefined;
  }
  const temperature = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*°?\s*C/i);
  if (temperature) {
    return `${Math.round(Number(temperature[1]!.replace(",", ".")))}°C`;
  }
  const wind = normalized.match(/(\d+(?:[.,]\d+)?)\s*m\/s/i);
  if (wind) {
    return `${Math.round(Number(wind[1]!.replace(",", ".")))} m/s`;
  }
  const humidity = normalized.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (humidity) {
    return `${Math.round(Number(humidity[1]!.replace(",", ".")))}%`;
  }
  return truncateMapLabel(normalized, 8);
}

function weatherDisplayConditionLabel(display: Record<string, unknown>): string {
  const badgeLabel = recordString(display, "badgeLabel");
  if (badgeLabel) {
    return badgeLabel;
  }
  switch (recordString(display, "conditionMode")) {
    case "observed":
      return "autoritativní stav";
    case "measured":
    case "unclassified":
      return "měření";
    case "estimated":
      return "odhad SIM";
    default:
      return weatherConditionDefaultLabel(weatherDisplayIconId(display));
  }
}

function weatherDisplayTone(display: Record<string, unknown> | undefined): string | undefined {
  const tone = weatherDisplayString(display, "badgeTone")?.toLowerCase();
  switch (tone) {
    case "critical":
    case "danger":
    case "error":
      return "critical";
    case "warning":
    case "warn":
    case "advisory":
      return "warning";
    case "ok":
    case "success":
    case "info":
      return "ok";
    case "neutral":
    case "unknown":
      return "info";
    default:
      return undefined;
  }
}

function weatherMetadataRecords(feature: SituationFeature): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [feature.properties as unknown as Record<string, unknown>];
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : undefined;
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : undefined;
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : undefined;
  const providerRendering =
    providerProperties && isRecord(providerProperties.rendering) ? providerProperties.rendering : undefined;
  const providerWeather =
    providerProperties && isRecord(providerProperties.weather) ? providerProperties.weather : undefined;
  const providerCondition =
    providerProperties && isRecord(providerProperties.condition) ? providerProperties.condition : undefined;
  const providerDisplay =
    providerProperties && isRecord(providerProperties.display) ? providerProperties.display : undefined;
  [tags, rendering, providerProperties, providerRendering, providerWeather, providerCondition, providerDisplay].forEach(
    (record) => {
      if (record) {
        records.push(record);
      }
    }
  );
  return records;
}

function firstRecordString(records: Record<string, unknown>[], ...keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = recordString(record, key);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function firstRecordNumberFromRecords(records: Record<string, unknown>[], ...keys: string[]): number | undefined {
  for (const record of records) {
    const value = firstRecordNumber(record, ...keys);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function weatherConditionIconFromWmoCode(code: number): WeatherConditionIconId {
  const rounded = Math.round(code);
  if (rounded === 0) {
    return "sun";
  }
  if (rounded >= 1 && rounded <= 2) {
    return "partly_cloudy";
  }
  if (rounded === 3) {
    return "cloud";
  }
  if (rounded === 45 || rounded === 48) {
    return "fog";
  }
  if ((rounded >= 51 && rounded <= 67) || (rounded >= 80 && rounded <= 82)) {
    return "rain";
  }
  if ((rounded >= 71 && rounded <= 77) || rounded === 85 || rounded === 86) {
    return "snow";
  }
  if (rounded >= 95 && rounded <= 99) {
    return "storm";
  }
  return "unknown";
}

function inferWeatherConditionIconId(
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined,
  cloudCoverPercent: number | undefined,
  humidityPercent: number | undefined
): WeatherConditionIconId {
  if (precipitationMm !== undefined && precipitationMm > 0) {
    if (temperatureC !== undefined && temperatureC <= 1.5) {
      return "snow";
    }
    return "rain";
  }
  if (humidityPercent !== undefined && humidityPercent >= 95 && (windSpeedMps === undefined || windSpeedMps < 3)) {
    return "fog";
  }
  if (windSpeedMps !== undefined && windSpeedMps >= 7) {
    return "wind";
  }
  if (cloudCoverPercent !== undefined) {
    if (cloudCoverPercent >= 85) {
      return "cloud";
    }
    if (cloudCoverPercent >= 35) {
      return "partly_cloudy";
    }
    return "sun";
  }
  if (temperatureC !== undefined || windSpeedMps !== undefined || humidityPercent !== undefined) {
    return "measurement";
  }
  return "unknown";
}

function weatherConditionDefaultLabel(iconId: WeatherConditionIconId): string {
  switch (iconId) {
    case "sun":
      return "jasno";
    case "partly_cloudy":
      return "polojasno";
    case "cloud":
      return "zataženo";
    case "fog":
      return "mlha";
    case "rain":
      return "déšť";
    case "snow":
      return "sníh";
    case "storm":
      return "bouřka";
    case "wind":
      return "vítr";
    case "measurement":
    case "measurement_temperature":
    case "measurement_wind":
    case "measurement_rain":
    case "measurement_humidity":
      return "měření";
    case "unknown":
      return "počasí";
  }
}

function formatWeatherMapLabel(
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined
): string {
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

function formatWeatherContextMapLabel(
  feature: SituationFeature,
  temperatureC: number | undefined,
  windSpeedMps: number | undefined,
  precipitationMm: number | undefined,
  humidityPercent: number | undefined,
  pressureHpa: number | undefined
): string {
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return temperatureC !== undefined ? `${Math.round(temperatureC)}°C` : "Teplota";
    case "weather_wind_field":
      return windSpeedMps !== undefined ? `${Math.round(windSpeedMps)} m/s` : "Vítr";
    case "weather_precipitation_grid":
      return precipitationMm !== undefined ? formatPrecipitationAmount(precipitationMm) : "Srážky";
    case "weather_humidity_grid":
      return humidityPercent !== undefined ? `${Math.round(humidityPercent)} %` : "Vlhkost";
    case "weather_pressure_grid":
      return pressureHpa !== undefined ? `${Math.round(pressureHpa)} hPa` : "Tlak";
    default:
      return formatWeatherMapLabel(temperatureC, windSpeedMps, precipitationMm);
  }
}

function weatherContextColor(feature: SituationFeature, fallback: string): string {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return temperatureColor(weatherMetricValue(feature, metrics, "temperatureC"), fallback);
    case "weather_wind_field":
      return windSpeedColor(weatherMetricValue(feature, metrics, "windSpeedMps"), fallback);
    case "weather_precipitation_grid":
      return precipitationColor(
        weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm"),
        fallback
      );
    case "weather_humidity_grid":
      return humidityColor(
        weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent"),
        fallback
      );
    case "weather_pressure_grid":
      return pressureColor(weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel"), fallback);
    default:
      return fallback;
  }
}

function weatherContextStatusLabel(feature: SituationFeature, fallback: string): string {
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return "Teplota";
    case "weather_wind_field":
      return "Vítr";
    case "weather_precipitation_grid":
      return "Srážky";
    case "weather_humidity_grid":
      return "Vlhkost";
    case "weather_pressure_grid":
      return "Tlak";
    default:
      return fallback;
  }
}

function weatherMetricValue(
  feature: SituationFeature,
  metrics: Record<string, unknown>,
  ...fallbackKeys: string[]
): number | undefined {
  const rendering = isRecord(feature.properties.rendering) ? feature.properties.rendering : {};
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const providerRendering = isRecord(providerProperties.rendering) ? providerProperties.rendering : {};
  const metricKey = stringProperty(rendering.valueMetric) ?? stringProperty(providerRendering.valueMetric);
  if (metricKey) {
    const metricValue = recordNumber(metrics, metricKey);
    if (metricValue !== undefined) {
      return metricValue;
    }
  }
  return recordNumber(metrics, "value") ?? firstRecordNumber(metrics, ...fallbackKeys);
}

function formatWeatherFeatureHeadline(feature: SituationFeature): string {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const temperatureC = weatherMetricValue(feature, metrics, "temperatureC");
  const windSpeedMps = weatherMetricValue(feature, metrics, "windSpeedMps");
  const precipitationMm = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
  const humidityPercent = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
  const pressureHpa = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
  switch (feature.properties.layer) {
    case "weather_temperature_grid":
      return temperatureC !== undefined ? `Teplota ${Math.round(temperatureC)} °C` : "Teplotní pole";
    case "weather_wind_field":
      return windSpeedMps !== undefined ? `Vítr ${Math.round(windSpeedMps)} m/s` : "Pole větru";
    case "weather_precipitation_grid":
      return precipitationMm !== undefined ? `Srážky: ${precipitationIntensityLabel(precipitationMm)}` : "Srážky";
    case "weather_humidity_grid":
      return humidityPercent !== undefined ? `Vlhkost ${Math.round(humidityPercent)} %` : "Vlhkost vzduchu";
    case "weather_pressure_grid":
      return pressureHpa !== undefined ? `Tlak ${Math.round(pressureHpa)} hPa` : "Tlak vzduchu";
    default:
      return feature.properties.headline ?? feature.properties.label ?? "Počasí";
  }
}

function formatWeatherFeatureSubtitle(feature: SituationFeature): string {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const value = weatherFeatureValueLabel(feature, metrics);
  const source = feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId);
  return [
    value,
    source,
    weatherDataQualityLabel(stringProperty(feature.properties.dataQuality)),
    feature.properties.stale ? "starší data" : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function weatherFeatureValueLabel(feature: SituationFeature, metrics: Record<string, unknown>): string | undefined {
  switch (feature.properties.layer) {
    case "weather_temperature_grid": {
      const value = weatherMetricValue(feature, metrics, "temperatureC");
      return value !== undefined ? `${Math.round(value)} °C` : undefined;
    }
    case "weather_wind_field": {
      const speed = weatherMetricValue(feature, metrics, "windSpeedMps");
      const direction = recordNumber(metrics, "windDirectionDeg");
      return (
        [
          speed !== undefined ? `${Math.round(speed)} m/s` : undefined,
          direction !== undefined ? `${Math.round(direction)}°` : undefined
        ]
          .filter(Boolean)
          .join(", ") || undefined
      );
    }
    case "weather_precipitation_grid": {
      const value = weatherMetricValue(feature, metrics, "precipitationMm", "precipitation10mMm");
      return value !== undefined ? `${formatPrecipitationAmount(value)} za 10 min` : undefined;
    }
    case "weather_humidity_grid": {
      const value = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
      return value !== undefined ? `${Math.round(value)} %` : undefined;
    }
    case "weather_pressure_grid": {
      const value = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
      return value !== undefined ? `${Math.round(value)} hPa` : undefined;
    }
    default:
      return undefined;
  }
}

function formatPrecipitationAmount(value: number): string {
  return value < 0.05 ? "0 mm" : `${value.toFixed(value < 1 ? 1 : 0)} mm`;
}

function precipitationIntensityLabel(value: number): string {
  if (value <= 0.02) {
    return "beze srážek";
  }
  if (value < 0.2) {
    return "mrholení";
  }
  if (value < 0.8) {
    return "slabé";
  }
  if (value < 2) {
    return "mírné";
  }
  if (value < 5) {
    return "výrazné";
  }
  return "silné";
}

function weatherDataQualityLabel(value: string | undefined): string | undefined {
  switch (value) {
    case "observed":
      return "měřeno";
    case "mixed":
      return "měřeno + model";
    case "modelled":
      return "model";
    default:
      return undefined;
  }
}

function sourceDisplayName(sourceId: string | undefined): string | undefined {
  switch (sourceId) {
    case "chmi_weather_stations":
      return "ČHMÚ";
    case "chmi_weather_webcams":
      return "ČHMÚ webkamery";
    case "open_meteo":
      return "Open-Meteo";
    case "weather_forecast":
      return "Předpověď počasí";
    case "aviation_weather":
      return "METAR/TAF";
    default:
      return sourceId;
  }
}

function formatAviationWeatherMapLabel(icaoId: string | undefined, flightCategory: string): string {
  return [icaoId, flightCategory].filter(Boolean).join("\n") || "METAR";
}

function formatAirQualityMapLabel(
  index: number | undefined,
  pollutant: string | undefined,
  level: string | undefined
): string {
  const normalizedPollutant = pollutant?.trim().toUpperCase();
  if (index !== undefined) {
    return normalizedPollutant ? `AQI ${Math.round(index)}\n${normalizedPollutant}` : `AQI ${Math.round(index)}`;
  }
  const label = formatAirQualityStatusLabel(index, level, "");
  return label || "AQ";
}

function formatAirQualityStatusLabel(index: number | undefined, level: string | undefined, fallback: string): string {
  if (index !== undefined) {
    if (index <= 1.5) {
      return "DOBRÁ";
    }
    if (index <= 2.5) {
      return "PŘIJATELNÁ";
    }
    if (index <= 3.5) {
      return "ZHORŠENÁ";
    }
    if (index <= 4.5) {
      return "ŠPATNÁ";
    }
    return "VELMI ŠPATNÁ";
  }
  const normalized = normalizeAirQualityLevel(level);
  if (normalized === "good") {
    return "DOBRÁ";
  }
  if (normalized === "fair") {
    return "PŘIJATELNÁ";
  }
  if (normalized === "moderate") {
    return "ZHORŠENÁ";
  }
  if (normalized === "poor") {
    return "ŠPATNÁ";
  }
  if (normalized === "very_poor") {
    return "VELMI ŠPATNÁ";
  }
  return fallback;
}

function airQualityColor(index: number | undefined, level: string | undefined, fallback: string): string {
  if (index !== undefined) {
    if (index <= 1.5) {
      return "#22c55e";
    }
    if (index <= 2.5) {
      return "#a3e635";
    }
    if (index <= 3.5) {
      return "#facc15";
    }
    if (index <= 4.5) {
      return "#fb923c";
    }
    return "#ef4444";
  }
  switch (normalizeAirQualityLevel(level)) {
    case "good":
      return "#22c55e";
    case "fair":
      return "#a3e635";
    case "moderate":
      return "#facc15";
    case "poor":
      return "#fb923c";
    case "very_poor":
      return "#ef4444";
    default:
      return fallback;
  }
}

function airQualityTone(index: number | undefined, level: string | undefined, fallback: string): string {
  if (index !== undefined) {
    if (index <= 2.5) {
      return "info";
    }
    if (index <= 3.5) {
      return "advisory";
    }
    if (index <= 4.5) {
      return "warning";
    }
    return "critical";
  }
  switch (normalizeAirQualityLevel(level)) {
    case "good":
    case "fair":
      return "info";
    case "moderate":
      return "advisory";
    case "poor":
      return "warning";
    case "very_poor":
      return "critical";
    default:
      return fallback;
  }
}

function temperatureColor(value: number | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (value < -5) {
    return "#60a5fa";
  }
  if (value < 5) {
    return "#38bdf8";
  }
  if (value < 18) {
    return "#22c55e";
  }
  if (value < 27) {
    return "#facc15";
  }
  if (value < 34) {
    return "#fb923c";
  }
  return "#ef4444";
}

function windSpeedColor(value: number | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (value < 3) {
    return "#8cb6d8";
  }
  if (value < 8) {
    return "#38bdf8";
  }
  if (value < 14) {
    return "#facc15";
  }
  if (value < 22) {
    return "#fb923c";
  }
  return "#ef4444";
}

function precipitationColor(value: number | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (value <= 0) {
    return "#8cb6d8";
  }
  if (value < 1) {
    return "#38bdf8";
  }
  if (value < 5) {
    return "#0ea5e9";
  }
  if (value < 15) {
    return "#6366f1";
  }
  return "#a855f7";
}

function humidityColor(value: number | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (value < 30) {
    return "#facc15";
  }
  if (value < 60) {
    return "#22c55e";
  }
  if (value < 85) {
    return "#38bdf8";
  }
  return "#0ea5e9";
}

function pressureColor(value: number | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (value < 995) {
    return "#a855f7";
  }
  if (value < 1010) {
    return "#38bdf8";
  }
  if (value < 1025) {
    return "#22c55e";
  }
  return "#facc15";
}

function weatherPulseRadiusExpression(expanded: boolean): ExpressionSpecification {
  const factor = expanded ? 1.7 : 0.82;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    ["*", ["coalesce", ["get", "weatherPulseRadius"], 7], factor * 0.72],
    10,
    ["*", ["coalesce", ["get", "weatherPulseRadius"], 9], factor],
    14,
    ["*", ["coalesce", ["get", "weatherPulseRadius"], 11], factor * 1.18]
  ] as ExpressionSpecification;
}

function weatherPulseOpacityExpression(expanded: boolean): ExpressionSpecification {
  return [
    "case",
    ["get", "stale"],
    expanded ? 0.08 : 0.14,
    expanded
      ? ["*", ["coalesce", ["get", "weatherPulseOpacity"], 0.24], 0.42]
      : ["coalesce", ["get", "weatherPulseOpacity"], 0.24]
  ] as ExpressionSpecification;
}

function normalizeAirQualityLevel(
  level: string | undefined
): "fair" | "good" | "moderate" | "poor" | "very_poor" | "unknown" {
  const normalized = level
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "unknown";
  }
  if (["good", "excellent", "low"].includes(normalized)) {
    return "good";
  }
  if (["fair", "acceptable", "ok"].includes(normalized)) {
    return "fair";
  }
  if (["moderate", "medium", "elevated"].includes(normalized)) {
    return "moderate";
  }
  if (["poor", "bad", "high", "unhealthy"].includes(normalized)) {
    return "poor";
  }
  if (["very_poor", "very_bad", "very_high", "hazardous"].includes(normalized)) {
    return "very_poor";
  }
  return "unknown";
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function firstRecordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = recordNumber(record, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function numberProperty(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordString(record: Record<string, unknown>, key: string): string | undefined {
  return stringProperty(record[key]);
}

export function visibleLegendLimitForMapSize(width: number, height: number): number {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const area = safeWidth * safeHeight;
  if (safeWidth < 390 || safeHeight < 280) {
    return 3;
  }
  if (safeWidth < 540 || area < 230_000) {
    return 4;
  }
  if (safeWidth < 760 || area < 430_000) {
    return 5;
  }
  if (safeWidth < 1080 || area < 760_000) {
    return 7;
  }
  return 10;
}

export function buildDynamicLegendItemsFromRenderedFeatureProperties(
  features: Array<{ id?: string | number; layer?: { id?: string }; properties?: unknown }>,
  limit: number
): DynamicLegendItem[] {
  const buckets = new Map<string, DynamicLegendBucket>();
  features.forEach((feature, index) => {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const candidate = dynamicLegendCandidateFromProperties(
      properties,
      `rendered:${feature.layer?.id ?? "layer"}:${feature.id ?? index}`
    );
    if (!candidate) {
      return;
    }
    const bucket =
      buckets.get(candidate.key) ??
      ({
        color: candidate.color,
        count: 0,
        disposition: candidate.disposition,
        identities: new Set<string>(),
        key: candidate.key,
        label: candidate.label,
        shape: candidate.shape
      } satisfies DynamicLegendBucket);
    if (!bucket.identities.has(candidate.identity)) {
      bucket.identities.add(candidate.identity);
      bucket.count += candidate.weight;
    }
    buckets.set(candidate.key, bucket);
  });
  return Array.from(buckets.values())
    .map(({ identities: _identities, ...item }) => item)
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "cs-CZ"))
    .slice(0, Math.max(0, Math.floor(limit)));
}

function dynamicLegendCandidateFromProperties(
  properties: Record<string, unknown>,
  fallbackIdentity: string
): DynamicLegendCandidate | null {
  const cluster = properties.cluster === true || properties.cluster === 1;
  if (cluster) {
    const identity = propertyIdentity(properties, "cluster_id") ?? fallbackIdentity;
    return {
      color: "#8cb6d8",
      identity: `cluster:${identity}`,
      key: "cluster",
      label: "Shluky",
      shape: "cluster",
      weight: Math.max(1, Math.round(numberProperty(properties.point_count) ?? 1))
    };
  }

  const objectId = stringProperty(properties.objectId);
  if (objectId) {
    const objectType = stringProperty(properties.objectType) ?? "UNKNOWN";
    const disposition = affiliationDispositionProperty(properties.symbolDisposition);
    const fallbackAffiliation = getAffiliationPresentation(stringProperty(properties.affiliation) ?? "UNKNOWN");
    return {
      color: stringProperty(properties.symbolColor) ?? fallbackAffiliation.color,
      disposition: disposition ?? fallbackAffiliation.disposition,
      identity: `object:${objectId}`,
      key: `object:${normalizeLegendKey(objectType)}`,
      label: objectTypeLegendLabel(objectType),
      shape: disposition === "hostile" ? "diamond" : "square",
      weight: 1
    };
  }

  const shareId = stringProperty(properties.shareId);
  if (shareId) {
    return {
      color: "#10b981",
      identity: `shared-location:${shareId}`,
      key: "shared-location",
      label: "Sdílené polohy",
      shape: "circle",
      weight: 1
    };
  }

  const drawingId = stringProperty(properties.drawingId);
  if (drawingId) {
    return {
      color: stringProperty(properties.stroke) ?? stringProperty(properties.color) ?? "#c8f08d",
      identity: `sketch:${drawingId}`,
      key: "sketch",
      label: "Zákresy",
      shape: "square",
      weight: 1
    };
  }

  const featureId = stringProperty(properties.featureId);
  if (featureId) {
    const label = situationLegendLabel(properties);
    return {
      color: stringProperty(properties.situationStatusColor) ?? situationLegendColor(properties),
      identity: `feature:${featureId}`,
      key: `situation:${normalizeLegendKey(label)}`,
      label,
      shape: "circle",
      weight: 1
    };
  }

  return null;
}

function propertyIdentity(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function affiliationDispositionProperty(value: unknown): AffiliationDisposition | undefined {
  if (value === "friend" || value === "hostile" || value === "neutral" || value === "pending" || value === "unknown") {
    return value;
  }
  return undefined;
}

function normalizeLegendKey(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "unknown"
  );
}

function objectTypeLegendLabel(objectType: string): string {
  const normalized = objectType.trim().toUpperCase();
  const labels: Record<string, string> = {
    AIRCRAFT: "Letadla",
    GROUND_UNIT: "Pozemní jednotky",
    INCIDENT: "Incidenty",
    MISSILE_TRACK: "Střely",
    REPORT: "Hlášení",
    RESCUE_ASSET: "Záchranné prostředky",
    UAV: "UAV",
    UNKNOWN: "Neznámé objekty",
    VEHICLE: "Vozidla"
  };
  return labels[normalized] ?? (normalized ? normalized.replaceAll("_", " ") : "Objekty");
}

function situationLegendLabel(properties: Record<string, unknown>): string {
  const layer = stringProperty(properties.layer) ?? stringProperty(properties.layerId) ?? "";
  if (
    properties.weatherForecastArea ||
    properties.weatherObservation ||
    properties.weatherGrid ||
    layer.includes("weather")
  ) {
    return "Počasí";
  }
  if (properties.weatherCamera) {
    return "Kamery";
  }
  if (properties.airQualityFeature || layer.includes("air_quality")) {
    return "Kvalita ovzduší";
  }
  if (properties.trafficTransit || layer.includes("traffic")) {
    return "Doprava";
  }
  if (properties.coverageQuality || properties.mobileSymbolKey || layer.includes("mobile")) {
    return "Mobilní síť";
  }
  if (properties.riskFeature || stringProperty(properties.riskKind)) {
    return stringProperty(properties.riskKind) === "flood" ? "Vodní rizika" : "Rizika";
  }
  if (properties.safetyAlertLayer || layer.includes("warning") || layer.includes("alert")) {
    return "Výstrahy";
  }
  if (properties.radioReference || layer.includes("radio")) {
    return "Radiové body";
  }
  if (properties.trailRoute || properties.trailPoi) {
    return "Outdoor";
  }
  if (properties.missionArena) {
    return "Mise";
  }
  if (properties.takGateway) {
    return "TAK";
  }
  if (properties.boundaryReference) {
    return "Hranice";
  }
  return (
    stringProperty(properties.osmCategoryLabel) ??
    stringProperty(properties.mapLabel) ??
    stringProperty(properties.situationStatusLabel) ??
    "Situační kontext"
  );
}

function situationLegendColor(properties: Record<string, unknown>): string {
  if (properties.weatherForecastArea || properties.weatherObservation || properties.weatherGrid) {
    return "#38bdf8";
  }
  if (properties.airQualityFeature) {
    return "#22c55e";
  }
  if (properties.trafficTransit) {
    return "#f97316";
  }
  if (properties.coverageQuality || properties.mobileSymbolKey) {
    return "#a3e635";
  }
  if (properties.riskFeature || properties.safetyAlertLayer) {
    return "#facc15";
  }
  return "#38bdf8";
}

function dynamicLegendItemsEqual(left: DynamicLegendItem[], right: DynamicLegendItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      if (!other) {
        return false;
      }
      return (
        item.color === other.color &&
        item.count === other.count &&
        item.disposition === other.disposition &&
        item.key === other.key &&
        item.label === other.label &&
        item.shape === other.shape
      );
    })
  );
}

interface TrackFeatureOptions {
  hoveredObjectId?: string;
  publicFlightSymbolMode?: PublicFlightSymbolMode;
}

export function objectsToTrackFeatureCollection(
  objects: CopObject[],
  selectedObjectId?: string,
  options: TrackFeatureOptions = {}
): TrackFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.filter(hasPosition).map((object) => {
      const symbol = resolveCopObjectSymbol(object);
      const affiliation = getAffiliationPresentation(object.affiliation);
      const publicFlight = isPublicFlightObject(object);
      const civilAircraftKind = publicFlight ? resolveCivilAircraftIconKind(object) : undefined;
      const civilAircraftTone = publicFlight ? resolveCivilAircraftIconTone(object) : undefined;
      const civilAircraftSymbolColor = publicFlight
        ? resolveCivilAircraftSymbolColor(object, civilAircraftTone ?? "normal")
        : affiliation.color;
      const standardSymbolKey = getNatoIconKey(object.objectType, object.affiliation);
      const displaySymbolKey =
        publicFlight && options.publicFlightSymbolMode !== "standard"
          ? getCivilAircraftIconKey(civilAircraftKind ?? "unknown", civilAircraftTone ?? "normal")
          : standardSymbolKey;
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
          hovered: object.objectId === options.hoveredObjectId,
          symbolCode: symbol.symbolCode,
          symbolKey: standardSymbolKey,
          displaySymbolKey,
          publicFlight,
          aircraftHeadingDeg: publicFlight ? resolveCivilAircraftRotationDeg(object) : undefined,
          civilAircraftKind,
          civilAircraftTone,
          label: formatTrackLabel(object),
          symbolColor:
            publicFlight && options.publicFlightSymbolMode !== "standard"
              ? civilAircraftSymbolColor
              : affiliation.color,
          symbolDisposition: affiliation.disposition
        }
      };
    })
  };
}

function resolveCivilAircraftIconKind(object: CopObject): CivilAircraftIconKind {
  const flightData = object.attributes?.flightData;
  const presentation = civilAircraftPresentation(object);
  if (isAirspaceMonoPresentation(presentation)) {
    const iconKind = normalizeCivilAircraftIconKind(
      stripSvgExtension(recordString(presentation, "iconFile") ?? recordString(presentation, "iconKey"))
    );
    if (iconKind) {
      return iconKind;
    }
  }
  const aircraft = isRecord(flightData?.aircraft) ? flightData.aircraft : {};
  const iconHint = normalizeCivilAircraftIconKind(
    stringProperty(aircraft.iconKey) ??
      stripSvgExtension(stringProperty(aircraft.iconFile)) ??
      stringProperty(aircraft.iconHint)
  );
  if (iconHint) {
    return iconHint;
  }

  const typeDesignator = normalizeCompactAscii(stringProperty(aircraft.typeDesignator) ?? "");
  const category = normalizeCompactAscii(stringProperty(aircraft.category) ?? "");
  const engineType = normalizeCompactAscii(stringProperty(aircraft.engineType) ?? "");
  const model = normalizeCompactAscii(stringProperty(aircraft.model) ?? "");
  const manufacturer = normalizeCompactAscii(stringProperty(aircraft.manufacturer) ?? "");
  const objectType = normalizeCompactAscii(object.objectType);
  const descriptor = `${typeDesignator} ${category} ${engineType} ${model} ${manufacturer} ${objectType}`;

  if (descriptor.includes("drone") || descriptor.includes("uav") || descriptor.includes("uas")) {
    if (descriptor.includes("quad")) {
      return "quadcopter_drone";
    }
    if (descriptor.includes("hexa")) {
      return "hexacopter_drone";
    }
    if (descriptor.includes("vtol")) {
      return "vtol_drone";
    }
    if (descriptor.includes("fpv") || descriptor.includes("racing")) {
      return "fpv_drone";
    }
    if (descriptor.includes("micro")) {
      return "micro_drone";
    }
    return "fixed_wing_drone";
  }
  if (descriptor.includes("tiltrotor") || typeDesignator.startsWith("v22")) {
    return "tiltrotor";
  }
  if (descriptor.includes("gyro") || descriptor.includes("autogyro")) {
    return "gyrocopter";
  }
  if (typeDesignator.startsWith("h") || descriptor.includes("helicopter") || descriptor.includes("rotorcraft")) {
    if (descriptor.includes("military") || descriptor.includes("attack")) {
      return "military_helicopter";
    }
    if (
      descriptor.includes("medical") ||
      descriptor.includes("ems") ||
      descriptor.includes("rescue") ||
      descriptor.includes("sar")
    ) {
      return "medical_helicopter";
    }
    if (["ch47", "ch46", "chinook"].some((token) => descriptor.includes(token))) {
      return "heavy_tandem_helicopter";
    }
    return descriptor.includes("light") ? "light_helicopter" : "medium_helicopter";
  }
  if (
    descriptor.includes("glider") ||
    typeDesignator.includes("glid") ||
    typeDesignator.startsWith("asw") ||
    typeDesignator.startsWith("dg")
  ) {
    return "glider";
  }
  if (descriptor.includes("seaplane") || descriptor.includes("amphib")) {
    return "seaplane";
  }
  if (descriptor.includes("aerobatic") || descriptor.includes("acrobatic")) {
    return "aerobatic_prop";
  }
  if (descriptor.includes("biplane")) {
    return "biplane";
  }
  if (descriptor.includes("ultralight") || descriptor.includes("microlight")) {
    return "ultralight";
  }
  if (
    descriptor.includes("fighter") ||
    ["f16", "f18", "f22", "f35", "gripen", "rafale", "eurofighter", "mig", "su"].some((token) =>
      descriptor.includes(token)
    )
  ) {
    return "fighter";
  }
  if (
    descriptor.includes("bomber") ||
    ["b1", "b2", "b52", "tu95", "tu160"].some((token) => typeDesignator.startsWith(token) || descriptor.includes(token))
  ) {
    return "military_bomber";
  }
  if (
    descriptor.includes("militarytransport") ||
    ["c130", "a400", "c17", "c5", "il76", "an12", "an124"].some((token) => descriptor.includes(token))
  ) {
    return "military_transport";
  }
  if (descriptor.includes("cargo") || descriptor.includes("freighter")) {
    return "cargo_aircraft";
  }
  if (
    descriptor.includes("business") ||
    descriptor.includes("bizjet") ||
    ["c25", "c55", "c56", "c68", "cl", "fa", "glf", "h25", "lj"].some((prefix) => typeDesignator.startsWith(prefix))
  ) {
    return "business_jet";
  }
  if (
    engineType.includes("turboprop") ||
    ["at", "dh", "pc", "sf", "tb", "yk"].some((prefix) => typeDesignator.startsWith(prefix))
  ) {
    return "turboprop";
  }
  if (["a38", "b74"].some((prefix) => typeDesignator.startsWith(prefix)) || descriptor.includes("jumbo")) {
    return "jumbo_airliner";
  }
  if (["a33", "a34", "a35", "b76", "b77", "b78", "dc10", "md11"].some((prefix) => typeDesignator.startsWith(prefix))) {
    return "wide_body_airliner";
  }
  if (["crj", "e1", "e2", "e7", "e9", "erj"].some((prefix) => typeDesignator.startsWith(prefix))) {
    return "regional_jet";
  }
  if (
    category.includes("light") ||
    category.includes("small") ||
    ["c1", "c2", "c3", "c4", "pa", "sr", "da", "be", "p2"].some((prefix) => typeDesignator.startsWith(prefix))
  ) {
    return descriptor.includes("twin") || ["be", "pa3", "pa4"].some((prefix) => typeDesignator.startsWith(prefix))
      ? "light_twin"
      : "light_single";
  }
  if (
    engineType.includes("jet") ||
    ["a", "b", "c", "e", "f", "m"].some((prefix) => typeDesignator.startsWith(prefix))
  ) {
    return "narrow_body_airliner";
  }
  return "narrow_body_airliner";
}

function resolveCivilAircraftIconTone(object: CopObject): CivilAircraftIconTone {
  const records = civilAircraftStatusRecords(object);
  if (hasCivilAircraftEmergency(records, object.status)) {
    return "emergency";
  }
  const presentationTone = resolveCivilAircraftPresentationTone(civilAircraftPresentation(object));
  if (presentationTone) {
    return presentationTone;
  }
  if (hasCivilAircraftDelay(records, object.status)) {
    return "delayed";
  }
  return "normal";
}

function resolveCivilAircraftSymbolColor(object: CopObject, tone: CivilAircraftIconTone): string {
  const presentationColor = normalizeHexColor(civilAircraftPresentation(object)?.colorHex);
  return presentationColor ?? civilAircraftIconToneColor(tone);
}

function resolveCivilAircraftRotationDeg(object: CopObject): number | undefined {
  const presentation = civilAircraftPresentation(object);
  if (presentation) {
    const rotateWithHeading = presentation.rotateWithHeading;
    if (rotateWithHeading === false) {
      return undefined;
    }
    const rotationDeg = numberProperty(presentation.rotationDeg);
    if (rotateWithHeading === true && rotationDeg !== undefined) {
      return normalizeHeadingDeg(rotationDeg);
    }
  }
  return normalizeHeadingDeg(object.movement?.headingDeg ?? object.headingDeg);
}

function civilAircraftPresentation(object: CopObject): Record<string, unknown> | undefined {
  const flightData = object.attributes?.flightData;
  return isRecord(flightData?.presentation) ? flightData.presentation : undefined;
}

function isAirspaceMonoPresentation(
  presentation: Record<string, unknown> | undefined
): presentation is Record<string, unknown> {
  return normalizeCompactAscii(recordString(presentation ?? {}, "iconSet") ?? "") === "airspaceiconsmonov1";
}

function resolveCivilAircraftPresentationTone(
  presentation: Record<string, unknown> | undefined
): CivilAircraftIconTone | undefined {
  if (!presentation) {
    return undefined;
  }
  const colorKey = normalizeCompactAscii(recordString(presentation, "colorKey") ?? "");
  if (colorKey === "emergency") {
    return "emergency";
  }
  if (colorKey === "delayed" || colorKey === "delay" || colorKey === "late") {
    return "delayed";
  }
  if (colorKey === "normal" || colorKey === "ok") {
    return "normal";
  }
  const colorHex = normalizeHexColor(presentation.colorHex)?.toLowerCase();
  if (colorHex === "#ef4444") {
    return "emergency";
  }
  if (colorHex === "#eab308" || colorHex === "#facc15") {
    return "delayed";
  }
  if (colorHex === "#22c55e") {
    return "normal";
  }
  return undefined;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  return match?.[1] ? `#${match[1].toLowerCase()}` : undefined;
}

function stripSvgExtension(value: string | undefined): string | undefined {
  return value
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.svg$/i, "");
}

function civilAircraftStatusRecords(object: CopObject): Array<Record<string, unknown>> {
  const attributes = isRecord(object.attributes) ? object.attributes : {};
  const flightData = isRecord(attributes.flightData) ? attributes.flightData : {};
  const aircraft = isRecord(flightData.aircraft) ? flightData.aircraft : {};
  const metadata = isRecord(flightData.metadata) ? flightData.metadata : {};
  const quality = isRecord(flightData.quality) ? flightData.quality : {};
  const status = isRecord(flightData.status) ? flightData.status : {};
  const emergency = isRecord(status.emergency) ? status.emergency : {};
  const delay = isRecord(status.delay) ? status.delay : {};
  const itinerary = isRecord(flightData.itinerary) ? flightData.itinerary : {};
  const route = isRecord(flightData.route) ? flightData.route : {};
  return [attributes, flightData, aircraft, metadata, quality, status, emergency, delay, itinerary, route];
}

function hasCivilAircraftEmergency(records: Array<Record<string, unknown>>, status: string): boolean {
  const normalizedStatus = normalizeCompactAscii(status);
  if (
    ["emergency", "distress", "mayday", "sos", "hijack", "radiofailure"].some((token) =>
      normalizedStatus.includes(token)
    )
  ) {
    return true;
  }
  if (firstRecordBoolean(records, ["emergency", "distress", "mayday", "hijack", "radioFailure", "active"]) === true) {
    return true;
  }
  const statusText = firstRecordText(records, [
    "alert",
    "alertStatus",
    "emergencyStatus",
    "flightStatus",
    "operationalStatus",
    "squawkStatus"
  ]);
  if (statusText) {
    const normalized = normalizeCompactAscii(statusText);
    if (
      ["emergency", "distress", "mayday", "panpan", "hijack", "radiofailure", "minfuel"].some((token) =>
        normalized.includes(token)
      )
    ) {
      return true;
    }
  }
  const squawk = firstRecordText(records, ["squawk", "transponderCode", "modeA", "modeACode"]);
  const normalizedSquawk = squawk?.replace(/\D/g, "");
  return normalizedSquawk === "7500" || normalizedSquawk === "7600" || normalizedSquawk === "7700";
}

function hasCivilAircraftDelay(records: Array<Record<string, unknown>>, status: string): boolean {
  const normalizedStatus = normalizeCompactAscii(status);
  if (["delay", "delayed", "late", "stale"].some((token) => normalizedStatus.includes(token))) {
    return true;
  }
  if (firstRecordBoolean(records, ["delayed", "late", "stale"]) === true) {
    return true;
  }
  const delaySeconds = firstRecordNumberFromRecords(
    records,
    "delaySeconds",
    "delaySec",
    "arrivalDelaySeconds",
    "departureDelaySeconds",
    "estimatedDelaySeconds",
    "scheduleDelaySeconds",
    "scheduledDelaySeconds"
  );
  if (delaySeconds !== undefined && delaySeconds > 60) {
    return true;
  }
  const delayMinutes = firstRecordNumberFromRecords(
    records,
    "delayMinutes",
    "arrivalDelayMinutes",
    "departureDelayMinutes"
  );
  if (delayMinutes !== undefined && delayMinutes > 1) {
    return true;
  }
  const delayStatus = firstRecordText(records, ["delayStatus", "scheduleStatus", "status"]);
  if (delayStatus) {
    const normalizedDelayStatus = normalizeCompactAscii(delayStatus);
    if (["delayed", "delay", "late"].some((token) => normalizedDelayStatus.includes(token))) {
      return true;
    }
    if (["unknown", "unavailable", "nodata", "none"].some((token) => normalizedDelayStatus.includes(token))) {
      return false;
    }
  }
  const positionAgeSeconds = firstRecordNumberFromRecords(
    records,
    "positionAgeSeconds",
    "ageSeconds",
    "trackAgeSeconds"
  );
  return positionAgeSeconds !== undefined && positionAgeSeconds > 180;
}

function firstRecordBoolean(records: Array<Record<string, unknown>>, keys: string[]): boolean | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const normalized = normalizeCompactAscii(value);
        if (normalized === "true" || normalized === "yes" || normalized === "ano") {
          return true;
        }
        if (normalized === "false" || normalized === "no" || normalized === "ne") {
          return false;
        }
      }
    }
  }
  return undefined;
}

function normalizeCivilAircraftIconKind(value: string | undefined): CivilAircraftIconKind | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s./-]+/g, "_");
  if (!normalized) {
    return undefined;
  }
  const aliases: Record<string, CivilAircraftIconKind> = {
    air_airliner_narrow: "narrow_body_airliner",
    air_airliner_wide: "wide_body_airliner",
    aircraft_01_small_ga: "light_single",
    aircraft_02_light_twin: "light_twin",
    aircraft_03_turboprop: "turboprop",
    aircraft_04_business_jet: "business_jet",
    aircraft_05_regional_jet: "regional_jet",
    aircraft_06_narrowbody_airliner: "narrow_body_airliner",
    aircraft_07_widebody_airliner: "wide_body_airliner",
    aircraft_08_jumbo_airliner: "jumbo_airliner",
    aircraft_09_cargo_freighter: "cargo_aircraft",
    aircraft_10_glider: "glider",
    aircraft_11_military_fighter: "fighter",
    aircraft_12_military_transport: "military_transport",
    aircraft_13_military_bomber: "military_bomber",
    aircraft_14_aerobatic_prop: "aerobatic_prop",
    aircraft_15_seaplane: "seaplane",
    aircraft_16_ultralight: "ultralight",
    aircraft_17_helicopter_light: "light_helicopter",
    aircraft_18_helicopter_medium: "medium_helicopter",
    aircraft_19_helicopter_heavy: "heavy_tandem_helicopter",
    aircraft_20_helicopter_military: "military_helicopter",
    air_business_jet: "business_jet",
    air_cargo: "cargo_aircraft",
    air_fighter: "fighter",
    air_glider: "glider",
    air_gyrocopter: "gyrocopter",
    air_light_single: "light_single",
    air_light_twin: "light_twin",
    air_military_transport: "military_transport",
    air_regional_jet: "regional_jet",
    air_seaplane: "seaplane",
    air_tiltrotor: "tiltrotor",
    air_turboprop: "turboprop",
    drone_fixed_wing: "fixed_wing_drone",
    drone_01_quadcopter: "quadcopter_drone",
    drone_02_hexacopter: "hexacopter_drone",
    drone_03_fixed_wing_uav: "fixed_wing_drone",
    drone_04_fpv_racing: "fpv_drone",
    drone_05_vtol_hybrid: "vtol_drone",
    drone_hexacopter: "hexacopter_drone",
    drone_micro: "micro_drone",
    drone_quadcopter: "quadcopter_drone",
    drone_vtol: "vtol_drone",
    heli_heavy_tandem: "heavy_tandem_helicopter",
    heli_light: "light_helicopter",
    heli_medical: "medical_helicopter",
    heli_medium: "medium_helicopter",
    narrowbody: "narrow_body_airliner",
    widebody: "wide_body_airliner"
  };
  return civilAircraftIconKinds.includes(normalized as CivilAircraftIconKind)
    ? (normalized as CivilAircraftIconKind)
    : aliases[normalized];
}

function normalizeHeadingDeg(value: number | null | undefined): number | undefined {
  const heading = Number(value);
  if (!Number.isFinite(heading)) {
    return undefined;
  }
  return ((heading % 360) + 360) % 360;
}

function formatObjectSelectionCard(object: CopObject): MapSelectionCard {
  if (isPublicFlightObject(object)) {
    return formatAircraftSelectionCard(object);
  }
  const subtitle = formatTrackSelectionSubtitle(object);
  return {
    compactSubtitle: subtitle,
    eyebrow: "Vybraný objekt",
    key: `object:${object.objectId}`,
    metaItems: [],
    subtitle,
    title: formatTrackLabel(object)
  };
}

function formatAircraftSelectionCard(object: CopObject): MapSelectionCard {
  const flightData = object.attributes?.flightData;
  const aircraft = isRecord(flightData?.aircraft) ? flightData.aircraft : {};
  const aircraftType = formatAircraftTypeLabel(aircraft);
  const registration = stringProperty(flightData?.registration);
  const icao24 = stringProperty(flightData?.icao24);
  const trackIdentity = formatTrackIdentity(flightData, object.objectId);
  const trackKeyKind = formatTrackKeyKindLabel(flightData?.trackKeyKind);
  const trackId = compactTrackIdentifier(stringProperty(flightData?.trackId) ?? object.objectId);
  const adsbCategory = formatAircraftAdsbCategoryLabel(aircraft);
  const aircraftClass = recordString(aircraft, "classKey") ?? recordString(aircraft, "aircraftClass");
  const route = formatAircraftRouteLabel(flightData);
  const altitude = formatAircraftAltitude(object);
  const compactAltitude = formatAircraftCompactAltitude(object);
  const speed = formatAircraftSpeed(object);
  const compactSpeed = formatAircraftCompactSpeed(object);
  const heading = formatAircraftHeading(object);
  const verticalRate = formatAircraftVerticalRate(object);
  const age = formatAircraftAge(object);
  const confidence = formatAircraftConfidence(object);
  const phase = formatAircraftPhaseLabel(flightData);
  const emergency = formatAircraftEmergencyDetail(flightData);
  const delay = formatAircraftDelayLabel(flightData);
  const aircraftTone = resolveCivilAircraftIconTone(object);
  const qualityTone = aircraftTone === "emergency" ? "bad" : aircraftTone === "delayed" ? "warn" : "ok";
  const subtitle =
    route ?? ([aircraftType, altitude, speed].filter(Boolean).join(" · ") || formatTrackSelectionSubtitle(object));
  const compactSubtitle = [compactAltitude, compactSpeed].filter(Boolean).join(" · ") || subtitle;
  const detailRows = [
    aircraftType ? { label: "Typ", value: aircraftType } : undefined,
    adsbCategory ? { label: "Kategorie", value: adsbCategory } : undefined,
    aircraftClass ? { label: "Třída", value: aircraftClass } : undefined,
    trackIdentity ? { label: "Identita stopy", value: trackIdentity } : undefined,
    trackKeyKind ? { label: "Typ identity", value: trackKeyKind } : undefined,
    trackId && trackId !== trackIdentity ? { label: "Track ID", value: trackId } : undefined,
    registration ? { label: "Registrace", value: registration } : undefined,
    icao24 ? { label: "ICAO24", value: icao24 } : undefined,
    route ? { label: "Trasa", value: route } : undefined,
    phase ? { label: "Fáze", value: phase } : undefined,
    emergency ? { label: "Nouze", value: emergency } : undefined,
    delay ? { label: "Zpoždění", value: delay } : undefined,
    altitude ? { label: "Výška", value: altitude } : undefined,
    speed ? { label: "Rychlost", value: speed } : undefined,
    heading ? { label: "Kurz", value: heading } : undefined,
    verticalRate ? { label: "Vertikální rychlost", value: verticalRate } : undefined,
    age ? { label: "Stáří", value: age } : undefined
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return {
    compactSubtitle,
    detailRows,
    eyebrow: route ? "Let" : "Letecký objekt",
    key: `object:${object.objectId}`,
    metaItems: [
      aircraftTone === "emergency" ? "nouze" : aircraftTone === "delayed" ? "zpožděné/starší data" : undefined,
      formatAircraftStatusLabel(object.status),
      confidence,
      stringProperty(flightData?.originCountry)
    ].filter(Boolean) as string[],
    statusTone: qualityTone,
    subtitle,
    title: formatTrackLabel(object),
    variant: "aircraft"
  };
}

function formatAircraftTypeLabel(aircraft: Record<string, unknown>): string | undefined {
  const designator = recordString(aircraft, "typeDesignator") ?? recordString(aircraft, "designator");
  const manufacturer = recordString(aircraft, "manufacturer");
  const model = recordString(aircraft, "model");
  const label = [designator, manufacturer, model].filter(Boolean).join(" / ");
  return label || undefined;
}

function formatAircraftRouteLabel(
  flightData: NonNullable<CopObject["attributes"]>["flightData"] | undefined
): string | undefined {
  if (!flightData) {
    return undefined;
  }
  const flightRecord = flightData as Record<string, unknown>;
  const metadata = isRecord(flightData.metadata) ? flightData.metadata : {};
  const route = isRecord(flightData.route) ? flightData.route : isRecord(metadata.route) ? metadata.route : {};
  const itinerary = isRecord(flightData.itinerary) ? flightData.itinerary : {};
  const origin = firstRecordText(
    [flightRecord, metadata, route, itinerary],
    ["origin", "originAirport", "departureAirport", "departure", "from"]
  );
  const destination = firstRecordText(
    [flightRecord, metadata, route, itinerary],
    ["destination", "destinationAirport", "arrivalAirport", "arrival", "to"]
  );
  if (!origin || !destination || origin === destination) {
    return undefined;
  }
  return `${origin} → ${destination}`;
}

function formatAircraftAdsbCategoryLabel(aircraft: Record<string, unknown>): string | undefined {
  const adsbCategory = isRecord(aircraft.adsbCategory) ? aircraft.adsbCategory : {};
  return (
    recordString(adsbCategory, "label") ??
    recordString(aircraft, "adsbCategoryLabel") ??
    recordString(aircraft, "categoryLabel")
  );
}

function formatAircraftPhaseLabel(
  flightData: NonNullable<CopObject["attributes"]>["flightData"] | undefined
): string | undefined {
  const status = isRecord(flightData?.status) ? flightData.status : {};
  const phase = recordString(status, "phase") ?? recordString(status, "flightPhase");
  return phase ? phase.toLowerCase() : undefined;
}

function formatAircraftEmergencyDetail(
  flightData: NonNullable<CopObject["attributes"]>["flightData"] | undefined
): string | undefined {
  const status = isRecord(flightData?.status) ? flightData.status : {};
  const emergency = isRecord(status.emergency) ? status.emergency : {};
  const active = firstRecordBoolean([status, emergency], ["active", "emergency", "distress"]);
  const label = firstRecordText([emergency, status], ["label", "status", "type", "code"]);
  if (active === true) {
    return label ? `ano · ${label}` : "ano";
  }
  if (label && normalizeCompactAscii(label) !== "none" && normalizeCompactAscii(label) !== "normal") {
    return label;
  }
  return undefined;
}

function formatAircraftDelayLabel(
  flightData: NonNullable<CopObject["attributes"]>["flightData"] | undefined
): string | undefined {
  const status = isRecord(flightData?.status) ? flightData.status : {};
  const delay = isRecord(status.delay) ? status.delay : {};
  const delayStatus = firstRecordText([delay, status], ["status", "delayStatus"]);
  const delaySeconds = firstRecordNumberFromRecords(
    [delay, status],
    "delaySeconds",
    "arrivalDelaySeconds",
    "departureDelaySeconds"
  );
  const delayMinutes =
    delaySeconds !== undefined
      ? Math.round(delaySeconds / 60)
      : firstRecordNumberFromRecords([delay, status], "delayMinutes");
  if (delayMinutes !== undefined && Math.abs(delayMinutes) >= 1) {
    return `${delayMinutes > 0 ? "+" : ""}${delayMinutes} min${delayStatus ? ` · ${delayStatus}` : ""}`;
  }
  if (delayStatus && !["unknown", "unavailable", "nodata", "none"].includes(normalizeCompactAscii(delayStatus))) {
    return delayStatus;
  }
  return undefined;
}

function firstRecordText(records: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = recordString(record, key);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function formatAircraftAltitude(object: CopObject): string | undefined {
  const altitudeM = object.position?.altitudeM;
  if (typeof altitudeM !== "number" || !Number.isFinite(altitudeM)) {
    return undefined;
  }
  const altitudeFt = Math.round((altitudeM * 3.28084) / 100) * 100;
  return `${altitudeFt.toLocaleString("cs-CZ")} ft · ${Math.round(altitudeM).toLocaleString("cs-CZ")} m`;
}

function formatAircraftCompactAltitude(object: CopObject): string | undefined {
  const altitudeM = object.position?.altitudeM;
  if (typeof altitudeM !== "number" || !Number.isFinite(altitudeM)) {
    return undefined;
  }
  const flightLevel = Math.max(0, Math.round((altitudeM * 3.28084) / 100));
  return `FL${flightLevel}`;
}

function formatAircraftSpeed(object: CopObject): string | undefined {
  const speedMps = object.movement?.speedMps ?? object.speedMps;
  if (typeof speedMps !== "number" || !Number.isFinite(speedMps)) {
    return undefined;
  }
  const knots = Math.round(speedMps * 1.94384);
  const kmh = Math.round(speedMps * 3.6);
  return `${knots.toLocaleString("cs-CZ")} kt · ${kmh.toLocaleString("cs-CZ")} km/h`;
}

function formatAircraftCompactSpeed(object: CopObject): string | undefined {
  const speedMps = object.movement?.speedMps ?? object.speedMps;
  if (typeof speedMps !== "number" || !Number.isFinite(speedMps)) {
    return undefined;
  }
  return `${Math.round(speedMps * 1.94384).toLocaleString("cs-CZ")} kt`;
}

function formatAircraftHeading(object: CopObject): string | undefined {
  const heading = normalizeHeadingDeg(object.movement?.headingDeg ?? object.headingDeg);
  return heading === undefined ? undefined : `${Math.round(heading)}°`;
}

function formatAircraftVerticalRate(object: CopObject): string | undefined {
  const verticalRateMps = object.movement?.verticalRateMps ?? object.verticalRateMps;
  if (typeof verticalRateMps !== "number" || !Number.isFinite(verticalRateMps)) {
    return undefined;
  }
  const feetPerMinute = Math.round(verticalRateMps * 196.8504);
  if (Math.abs(feetPerMinute) < 50) {
    return "stabilní";
  }
  return `${feetPerMinute > 0 ? "+" : ""}${feetPerMinute.toLocaleString("cs-CZ")} ft/min`;
}

function formatAircraftAge(object: CopObject): string | undefined {
  const positionAgeSeconds = object.attributes?.flightData?.quality?.positionAgeSeconds;
  if (typeof positionAgeSeconds === "number" && Number.isFinite(positionAgeSeconds)) {
    return formatAgeSeconds(positionAgeSeconds);
  }
  const updatedAtMs = object.lastUpdatedAt ? Date.parse(object.lastUpdatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) {
    return undefined;
  }
  return formatAgeSeconds(Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000)));
}

function formatAgeSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }
  return `${Math.round(seconds / 3600)} h`;
}

function formatSharedLiveLocationSelectionCard(location: ChatLiveLocationPayload): MapSelectionCard {
  const title = location.senderDisplayName?.trim() || location.label?.trim() || "Sdílená poloha";
  const sender =
    location.senderDisplayName?.trim() && location.senderDisplayName !== location.sender ? location.sender : undefined;
  const age = formatIsoTimestampAge(location.updatedAt);
  const updatedAt = formatIsoTimestamp(location.updatedAt);
  const expiresAt = location.expiresAt ? formatIsoTimestamp(location.expiresAt) : undefined;
  const accuracy = formatMeters(location.accuracyM);
  const statusLabel = location.status === "live" ? "Živé sdílení" : "Sdílení ukončeno";
  const subtitle = age ? `Aktualizováno před ${age}` : statusLabel;
  const detailRows = [
    { label: "Stav", value: statusLabel },
    sender ? { label: "Odesílatel", value: sender } : undefined,
    updatedAt ? { label: "Aktualizace", value: updatedAt } : undefined,
    expiresAt ? { label: "Platí do", value: expiresAt } : undefined,
    accuracy ? { label: "Přesnost", value: accuracy } : undefined
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return {
    compactSubtitle: accuracy ? `${subtitle} · ${accuracy}` : subtitle,
    detailRows,
    eyebrow: "Sdílená poloha",
    key: `shared-live:${location.shareId}`,
    metaItems: [statusLabel, age ? `před ${age}` : undefined, accuracy ? `přesnost ${accuracy}` : undefined].filter(
      (item): item is string => Boolean(item)
    ),
    statusTone: location.status === "live" ? "ok" : "warn",
    subtitle,
    title
  };
}

function formatIsoTimestampAge(value: string): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return formatAgeSeconds(Math.max(0, Math.round((Date.now() - timestamp) / 1000)));
}

function formatIsoTimestamp(value: string): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return new Date(timestamp).toLocaleString("cs-CZ", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

function formatMeters(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value >= 1000
    ? `${(value / 1000).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} km`
    : `${Math.round(value).toLocaleString("cs-CZ")} m`;
}

function formatAircraftConfidence(object: CopObject): string | undefined {
  const confidence =
    typeof object.confidence === "number" ? object.confidence : object.attributes?.flightData?.quality?.confidence;
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? `spolehlivost ${Math.round(confidence * 100)} %`
    : undefined;
}

function formatAircraftStatusLabel(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "aktivní";
  }
  if (normalized === "STALE") {
    return "starší data";
  }
  if (normalized === "LOST") {
    return "ztraceno";
  }
  return status.trim().toLowerCase() || "stav neznámý";
}

function formatTrackSelectionSubtitle(object: CopObject): string {
  return [
    object.objectType,
    formatMapAffiliation(object.affiliation),
    object.status,
    typeof object.confidence === "number" ? `${Math.round(object.confidence * 100)} %` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatSituationFeatureSelectionCard(
  feature: SituationFeature,
  transitDetail?: TransitVehicleDetailResponse | null
): MapSelectionCard {
  if (feature.properties.layer === "traffic") {
    const presentation = resolveTransportPresentation(feature);
    if (presentation) {
      return formatTransportFeatureSelectionCard(feature, presentation, transitDetail);
    }
  }
  if (isWeatherForecastAreaFeature(feature)) {
    return formatWeatherForecastFeatureSelectionCard(feature);
  }
  if (isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature)) {
    return formatWeatherFeatureSelectionCard(feature);
  }
  const subtitle = formatSituationFeatureSubtitle(feature);
  const locationInterpretation = formatSafetyAlertLocationInterpretation(feature);
  const locationConfidence = formatSafetyAlertLocationConfidence(feature);
  const detailRows = [
    locationInterpretation ? { label: "Poloha", value: locationInterpretation } : undefined,
    locationConfidence ? { label: "Jistota polohy", value: locationConfidence } : undefined
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  return {
    compactSubtitle: subtitle,
    detailRows: detailRows.length > 0 ? detailRows : undefined,
    eyebrow: "Vybraný prvek",
    key: `feature:${feature.properties.featureId}`,
    metaItems: locationInterpretation && !locationInterpretation.includes("přesný bod") ? ["poloha není přesná"] : [],
    subtitle,
    title: formatSituationFeatureTitle(feature)
  };
}

function formatWeatherForecastFeatureSelectionCard(feature: SituationFeature): MapSelectionCard {
  const presentation = weatherForecastPresentation(feature);
  const providerProperties = weatherForecastProviderProperties(feature);
  const forecast = isRecord(providerProperties.weatherForecast) ? providerProperties.weatherForecast : {};
  const riskScore = weatherForecastRiskScore(feature, presentation);
  const riskLevel = weatherForecastRiskLevel(feature, presentation);
  const title = weatherForecastMapLabel(feature, presentation);
  const subtitle = weatherForecastSubtitle(feature, presentation);
  const statusLabel = weatherForecastStatusLabel(riskScore, riskLevel);
  const detailUrl = weatherForecastDetailUrl(feature);
  const detailRows = [
    rowValue("Souhrn", recordString(forecast, "summary") ?? recordString(presentation, "subtitle")),
    rowValue("Riziko", riskScore !== undefined ? `${Math.round(riskScore * 100)} %` : riskLevel),
    rowValue("Detail", detailUrl ? "dostupný meteogram" : undefined)
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  return {
    compactSubtitle: recordString(presentation, "mapLabel") ?? statusLabel,
    detailRows,
    eyebrow: "Předpověď počasí",
    key: `feature:${feature.properties.featureId}`,
    metaItems: [statusLabel, sourceDisplayName(feature.properties.sourceId)].filter(
      (item, index, items): item is string => Boolean(item) && items.indexOf(item) === index
    ),
    statusTone: weatherForecastTone(riskScore, riskLevel),
    subtitle,
    title
  };
}

function formatWeatherFeatureSelectionCard(feature: SituationFeature): MapSelectionCard {
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const display = weatherDisplayRecord(feature);
  const temperatureC = weatherMetricValue(feature, metrics, "temperatureC");
  const windSpeedMps = weatherMetricValue(feature, metrics, "windSpeedMps");
  const windGustMps = firstRecordNumber(metrics, "windGustMps", "windGustSpeedMps");
  const windDirectionDeg = firstRecordNumber(metrics, "windDirectionDeg", "windDirection");
  const precipitationMm = weatherMetricValue(feature, metrics, "precipitation10mMm", "precipitationMm");
  const humidityPercent = weatherMetricValue(feature, metrics, "relativeHumidityPercent", "humidityPercent");
  const pressureHpa = weatherMetricValue(feature, metrics, "pressureHpa", "pressureHpaSeaLevel");
  const stationLabel = weatherDisplayString(display, "title") ?? formatWeatherStationLabel(feature, false);
  const conditionLabel = weatherDisplayString(display, "label") ?? weatherDisplayConditionLabel(display ?? {});
  const temperatureLabel = temperatureC !== undefined ? formatWeatherTemperature(temperatureC) : undefined;
  const windLabel = formatWeatherWindSelection(windDirectionDeg, windSpeedMps, windGustMps);
  const precipitationLabel =
    precipitationMm !== undefined ? `${formatPrecipitationAmount(precipitationMm)} / 10 min` : undefined;
  const humidityLabel = humidityPercent !== undefined ? `${Math.round(humidityPercent)} %` : undefined;
  const pressureLabel = pressureHpa !== undefined ? `${Math.round(pressureHpa)} hPa` : undefined;
  const primaryValue = formatWeatherValueLabel(display, temperatureC, windSpeedMps, precipitationMm, humidityPercent);
  const subtitle =
    [
      temperatureLabel ?? primaryValue,
      windLabel,
      precipitationMm !== undefined && precipitationMm > 0 ? `srážky ${precipitationLabel}` : undefined
    ]
      .filter(Boolean)
      .join(" · ") || formatWeatherFeatureSubtitle(feature);
  const compactSubtitle =
    [
      temperatureLabel ?? primaryValue,
      windSpeedMps !== undefined && windSpeedMps >= 0.5 ? `${Math.round(windSpeedMps)} m/s` : undefined
    ]
      .filter(Boolean)
      .join(" · ") || conditionLabel;
  const detailRows = [
    rowValue("Teplota", temperatureLabel),
    rowValue("Vítr", windLabel),
    rowValue("Srážky", precipitationLabel),
    rowValue("Vlhkost", humidityLabel),
    rowValue("Tlak", pressureLabel)
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  const metaItems = [
    conditionLabel,
    weatherDisplayString(display, "badgeLabel"),
    feature.properties.stale ? "starší data" : undefined,
    feature.properties.sourceName ?? sourceDisplayName(feature.properties.sourceId)
  ].filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index);
  return {
    compactSubtitle,
    detailRows,
    eyebrow: "Počasí",
    key: `feature:${feature.properties.featureId}`,
    metaItems,
    statusTone: weatherSelectionTone(feature),
    subtitle,
    title: stationLabel
  };
}

function formatWeatherTemperature(value: number): string {
  return `${Math.round(value)} °C`;
}

function formatWeatherWindSelection(
  directionDeg: number | undefined,
  speedMps: number | undefined,
  gustMps: number | undefined
): string | undefined {
  const speed = speedMps !== undefined ? `${Math.round(speedMps)} m/s` : undefined;
  const gust =
    gustMps !== undefined && gustMps > (speedMps ?? 0) + 0.5 ? `náraz ${Math.round(gustMps)} m/s` : undefined;
  const direction = directionDeg !== undefined ? `${Math.round(directionDeg)}°` : undefined;
  return [speed, gust, direction].filter(Boolean).join(" · ") || undefined;
}

function weatherSelectionTone(feature: SituationFeature): "bad" | "ok" | "warn" {
  const displayTone = weatherDisplayTone(weatherDisplayRecord(feature));
  const severity = normalizeSituationCategory(
    feature.properties.severity ?? feature.properties.hazardSeverity ?? feature.properties.status
  );
  if (["critical", "danger", "severe", "bad"].includes(displayTone ?? severity)) {
    return "bad";
  }
  if (["warning", "warn", "advisory", "moderate"].includes(displayTone ?? severity)) {
    return "warn";
  }
  return "ok";
}

function formatTransportFeatureSelectionCard(
  feature: SituationFeature,
  presentation: NonNullable<ReturnType<typeof resolveTransportPresentation>>,
  detail?: TransitVehicleDetailResponse | null
): MapSelectionCard {
  if (presentation.kind === "stop") {
    const title = presentation.stopName ?? presentation.mapLabel;
    const subtitle = [
      "Zastávka",
      presentation.systemId ? `systém ${presentation.systemId}` : undefined,
      presentation.zoneId ? `zóna ${presentation.zoneId}` : undefined
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      compactSubtitle: subtitle,
      eyebrow: "Zastávka",
      key: transportSelectionKey(feature) ?? `feature:${feature.properties.featureId}`,
      metaItems: [
        presentation.systemId ? `Systém ${presentation.systemId}` : undefined,
        presentation.zoneId ? `Zóna ${presentation.zoneId}` : undefined
      ].filter(Boolean) as string[],
      subtitle,
      title
    };
  }
  const routeShortName =
    detail?.route?.routeShortName ??
    detail?.trip?.routeShortName ??
    detail?.vehicle?.routeShortName ??
    presentation.routeShortName;
  const title = [presentation.label, routeShortName].filter(Boolean).join(" ") || presentation.mapLabel;
  const status = formatTransportCurrentStatus(presentation.currentStatus);
  const delaySeconds = detail?.current?.delaySeconds ?? detail?.vehicle?.delaySeconds ?? presentation.delaySeconds;
  const delay = formatTransportDelay(delaySeconds);
  const speed = formatTransportSpeed(
    detail?.current?.speedMps ?? detail?.vehicle?.position?.speedMps ?? presentation.speedMps
  );
  const position = formatTransportPositionKind(presentation.positionKind);
  const destination = transitDestination(detail) ?? presentation.destination;
  const nextStop = transitNextStop(detail);
  const previousStop = transitPreviousStop(detail);
  const nextStopName = transitStopLabel(nextStop);
  const nextStopEta = formatTransitStopEta(nextStop);
  const compactNextStop = nextStopName ? [nextStopEta, nextStopName].filter(Boolean).join(" ") : undefined;
  const subtitle =
    [
      destination ? `směr ${destination}` : undefined,
      nextStopName ? `příští ${nextStopName}` : undefined,
      status !== "n/a" ? status : undefined,
      delay !== "n/a" ? delay : undefined
    ]
      .filter(Boolean)
      .join(" · ") || "Živá dopravní poloha";
  const compactSubtitle =
    [compactNextStop, delay !== "n/a" ? delay : undefined].filter(Boolean).join(" · ") || subtitle;
  const detailRows = [
    rowValue("Příští", formatTransitStopDetail(nextStop)),
    rowValue("Poslední", formatTransitStopDetail(previousStop)),
    rowValue("Směr", destination),
    rowValue("Dopravce", detail?.vehicle?.operator ?? presentation.operator),
    rowValue("Vůz", detail?.vehicle?.label ?? detail?.vehicle?.id ?? detail?.vehicle?.vehicleId)
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  return {
    compactSubtitle,
    detailRows,
    eyebrow: "Dopravní spoj",
    key: transportSelectionKey(feature) ?? `feature:${feature.properties.featureId}`,
    metaItems: [
      delay !== "n/a" ? delay : undefined,
      speed !== "n/a" ? speed : undefined,
      position,
      detail?.vehicle?.operator ?? presentation.operator
    ].filter(Boolean) as string[],
    statusTone: transitDelayTone(delaySeconds),
    subtitle,
    title
  };
}

function rowValue(label: string, value: string | null | undefined): { label: string; value: string } | null {
  return value ? { label, value } : null;
}

function transitDelayTone(delaySeconds: number | null | undefined): "bad" | "ok" | "warn" {
  const delay = Number(delaySeconds);
  if (!Number.isFinite(delay)) {
    return "ok";
  }
  if (delay >= 300) {
    return "bad";
  }
  if (delay >= 60) {
    return "warn";
  }
  return "ok";
}

function transitDestination(detail: TransitVehicleDetailResponse | null | undefined): string | undefined {
  return [detail?.trip?.destination, detail?.trip?.headsign, detail?.route?.destination, detail?.vehicle?.destination]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}

function transitNextStop(detail: TransitVehicleDetailResponse | null | undefined): TransitStopTime | null {
  if (detail?.trip?.nextStop) {
    return detail.trip.nextStop;
  }
  const now = Date.now();
  return (
    transitDetailStops(detail).find((stop) => {
      const relation = typeof stop.relationToVehicle === "string" ? stop.relationToVehicle.toLowerCase() : "";
      if (["next", "upcoming", "future"].includes(relation)) {
        return true;
      }
      const time = transitStopTimestamp(stop);
      return typeof time === "number" && time >= now - 30_000;
    }) ?? null
  );
}

function transitPreviousStop(detail: TransitVehicleDetailResponse | null | undefined): TransitStopTime | null {
  if (detail?.trip?.previousStop) {
    return detail.trip.previousStop;
  }
  const stops = transitDetailStops(detail);
  const now = Date.now();
  for (let index = stops.length - 1; index >= 0; index -= 1) {
    const stop = stops[index]!;
    const relation = typeof stop.relationToVehicle === "string" ? stop.relationToVehicle.toLowerCase() : "";
    if (["previous", "passed", "past"].includes(relation)) {
      return stop;
    }
    const time = transitStopTimestamp(stop);
    if (typeof time === "number" && time < now) {
      return stop;
    }
  }
  return null;
}

function formatTransitStopDetail(stop: TransitStopTime | null): string | null {
  const label = transitStopLabel(stop);
  if (!label) {
    return null;
  }
  return [label, formatTransitStopEta(stop), formatTransportDelay(stop?.delaySeconds)]
    .filter((value) => value && value !== "n/a")
    .join(" · ");
}

function formatTransitStopEta(stop: TransitStopTime | null): string | null {
  const timestamp = transitStopTimestamp(stop);
  if (typeof timestamp !== "number") {
    return null;
  }
  const deltaMinutes = Math.round((timestamp - Date.now()) / 60_000);
  if (deltaMinutes >= 0 && deltaMinutes <= 90) {
    return `za ${deltaMinutes} min`;
  }
  return new Date(timestamp).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function transitStopTimestamp(stop: TransitStopTime | null | undefined): number | null {
  const value =
    stop?.realtimeArrival ??
    stop?.realtimeDeparture ??
    stop?.plannedArrival ??
    stop?.plannedDeparture ??
    stop?.scheduledArrival ??
    stop?.scheduledDeparture;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return parseTransitTimestamp(value);
}

function parseTransitTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!timeOnly) {
    return null;
  }
  const hours = Number(timeOnly[1]);
  const minutes = Number(timeOnly[2]);
  const seconds = Number(timeOnly[3] ?? 0);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, seconds, 0);
  let timestamp = candidate.getTime();
  const current = now.getTime();
  if (timestamp < current - 12 * 60 * 60 * 1000) {
    timestamp += 24 * 60 * 60 * 1000;
  } else if (timestamp > current + 12 * 60 * 60 * 1000) {
    timestamp -= 24 * 60 * 60 * 1000;
  }
  return timestamp;
}

function formatTransportPositionKind(value: string | undefined): string {
  switch (value) {
    case "vehicle_live":
      return "živá poloha";
    case "vehicle_live_cached":
      return "kroková obnova";
    case "static_stop":
      return "statická zastávka";
    default:
      return "dopravní data";
  }
}

function formatSituationFeatureTitle(feature: SituationFeature): string {
  if (isMissionArenaFeature(feature)) {
    return missionArenaDetailTitle(feature);
  }
  if (isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature)) {
    return formatWeatherFeatureHeadline(feature);
  }
  if (feature.properties.layer === "traffic") {
    const presentation = resolveTransportPresentation(feature);
    if (presentation) {
      if (presentation.kind === "stop") {
        return presentation.stopName ?? presentation.mapLabel;
      }
      return [presentation.label, presentation.routeShortName].filter(Boolean).join(" ");
    }
  }
  return feature.properties.headline ?? feature.properties.label;
}

function formatSituationFeatureSubtitle(feature: SituationFeature): string {
  const status = situationFeatureStatus(feature);
  if (isMissionArenaFeature(feature)) {
    const role = missionArenaFeatureRole(feature);
    const task = missionArenaPrimaryTask(feature);
    return [
      role === "task_state" ? "Úkol role" : role === "team_state" ? "Stav týmu" : "Stav mise",
      feature.properties.phase,
      feature.properties.runtimeMode,
      missionArenaTeamLabel(feature),
      role === "task_state" ? task?.status : undefined,
      role === "task_state" ? task?.priority : undefined,
      typeof feature.properties.aggregate === "number" ? `${Math.round(feature.properties.aggregate)} bodů` : undefined
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (isWeatherContextFeature(feature) && !isAviationWeatherFeature(feature)) {
    return formatWeatherFeatureSubtitle(feature);
  }
  if (feature.properties.layer === "traffic") {
    const presentation = resolveTransportPresentation(feature);
    if (presentation) {
      if (presentation.kind === "stop") {
        return [
          "Zastávka",
          presentation.systemId ? `systém ${presentation.systemId}` : undefined,
          presentation.zoneId ? `zóna ${presentation.zoneId}` : undefined
        ]
          .filter(Boolean)
          .join(" · ");
      }
      return (
        [
          presentation.destination ? `směr ${presentation.destination}` : undefined,
          formatTransportCurrentStatus(presentation.currentStatus),
          formatTransportDelay(presentation.delaySeconds),
          formatTransportSpeed(presentation.speedMps)
        ]
          .filter((item) => item && item !== "n/a")
          .join(" · ") || "Dopravní spoj"
      );
    }
  }
  if (feature.properties.layer === "mobile_coverage" || feature.properties.layer === "mobile_network") {
    return [
      feature.properties.layer === "mobile_network" ? "Mobilní síť" : "Model mobilní sítě",
      feature.properties.technology,
      status.label,
      typeof feature.properties.estimatedSignalDbm === "number"
        ? `${Math.round(feature.properties.estimatedSignalDbm)} dBm`
        : undefined,
      typeof feature.properties.confidence === "number"
        ? `${Math.round(feature.properties.confidence * 100)} %`
        : undefined
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (isCommunicationTowerFeature(feature)) {
    return [
      "BTS / komunikační stožár",
      formatCommunicationTowerLabel(feature),
      "stav operátora neznámý",
      typeof feature.properties.confidence === "number"
        ? `${Math.round(feature.properties.confidence * 100)} %`
        : undefined,
      feature.properties.sourceId
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (feature.properties.layer === "traffic") {
    const presentation = resolveTransportPresentation(feature);
    if (presentation) {
      if (presentation.kind === "stop") {
        return ["Zastávka veřejné dopravy", presentation.stopId, presentation.operator, feature.properties.sourceId]
          .filter(Boolean)
          .join(" · ");
      }
      return [
        situationLayerDisplayName(feature),
        presentation.currentStatus,
        presentation.destination ? `směr ${presentation.destination}` : undefined,
        presentation.speedMps !== undefined ? `${Math.round(presentation.speedMps * 3.6)} km/h` : undefined,
        presentation.delaySeconds !== undefined
          ? `zpoždění ${Math.round(presentation.delaySeconds / 60)} min`
          : undefined,
        feature.properties.sourceId
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
  return [
    situationLayerDisplayName(feature),
    feature.properties.category,
    status.label,
    typeof feature.properties.confidence === "number"
      ? `${Math.round(feature.properties.confidence * 100)} %`
      : undefined,
    feature.properties.sourceId
  ]
    .filter(Boolean)
    .join(" · ");
}

function safetyAlertTags(feature: SituationFeature): Record<string, unknown> {
  const providerProperties = isRecord(feature.properties.providerProperties)
    ? feature.properties.providerProperties
    : {};
  const providerTags = isRecord(providerProperties.tags) ? providerProperties.tags : {};
  const tags = isRecord(feature.properties.tags) ? feature.properties.tags : {};
  return { ...providerTags, ...tags };
}

function isCrisisSafetyAlertFeature(feature: SituationFeature): boolean {
  return (
    (feature.properties.layer === "warnings" || feature.properties.layer === "fire") &&
    (feature.properties.sourceId === "hzs_incidents" || feature.properties.sourceId === "municipal_alerts")
  );
}

function formatSafetyAlertLocationInterpretation(feature: SituationFeature): string | undefined {
  if (!isCrisisSafetyAlertFeature(feature)) {
    return undefined;
  }
  const locationPrecision = recordString(safetyAlertTags(feature), "locationPrecision");
  if (locationPrecision === "source_point") {
    return "přesný bod ze zdroje";
  }
  if (locationPrecision === "municipality_centroid") {
    return "přibližně - centroid obce";
  }
  if (locationPrecision === "admin_boundary_centroid") {
    return "přibližně - centroid oblasti";
  }
  if (locationPrecision === "authority_fallback_point") {
    return feature.properties.sourceId === "municipal_alerts"
      ? "bod vydávající autority, ne přesné místo události"
      : "bod autority, ne přesné místo události";
  }
  if (locationPrecision === "region_centroid") {
    return "bod regionu, ne přesné místo události";
  }
  return undefined;
}

function formatSafetyAlertLocationConfidence(feature: SituationFeature): string | undefined {
  if (!isCrisisSafetyAlertFeature(feature)) {
    return undefined;
  }
  const metrics = isRecord(feature.properties.metrics) ? feature.properties.metrics : {};
  const confidence = recordNumber(metrics, "locationConfidence");
  if (confidence === undefined) {
    return undefined;
  }
  return confidence <= 1 ? `${Math.round(confidence * 100)} %` : `${Math.round(confidence)} %`;
}

function situationLayerDisplayName(feature: SituationFeature): string {
  if (isTakGatewayFeature(feature)) {
    return `TAK ${feature.properties.layer}`;
  }
  if (isMissionArenaFeature(feature)) {
    return "Mission Arena";
  }
  const labels: Record<string, string> = {
    air_quality: "Kvalita vzduchu",
    community: "Komunitní hlášení",
    community_places: "Komunitní kontext",
    fire: "Požáry",
    flight_airports: "Letiště",
    flight_airspaces: "Letecký prostor",
    flood: "Vodní stavy",
    ground: "Terén",
    mobile: "Mobilní síť",
    mobile_coverage: "Model mobilní sítě",
    mobile_network: "Mobilní síť",
    mission_arena: "Mission Arena",
    trail_poi: "Outdoor body",
    trail_routes: "Turistické trasy",
    traffic: "Doprava",
    warnings: "Výstrahy",
    weather_alerts: "Meteorologické výstrahy",
    weather: "Počasí"
  };
  return labels[feature.properties.layer] ?? feature.properties.layer;
}

function formatMapAffiliation(value: string): string {
  const normalized = value.toUpperCase();
  if (normalized === "FRIEND" || normalized === "FRIENDLY") {
    return "vlastní";
  }
  if (normalized === "HOSTILE" || normalized === "SUSPECT" || normalized === "FOREIGN") {
    return "rizikové";
  }
  if (normalized === "NEUTRAL") {
    return "neutrální";
  }
  return "neznámé";
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

function isMissionArenaFeature(feature: SituationFeature): boolean {
  return (
    feature.properties.layer === "mission_arena" ||
    feature.properties.layerId === "presentation.mission_arena" ||
    feature.properties.providerId === "csm.mission-arena"
  );
}

function missionArenaFeatureRole(feature: SituationFeature): "mission_state" | "task_state" | "team_state" {
  return feature.properties.featureRole === "team_state" || feature.properties.featureRole === "task_state"
    ? feature.properties.featureRole
    : "mission_state";
}

function missionArenaMapLabel(feature: SituationFeature): string {
  const role = missionArenaFeatureRole(feature);
  if (role === "task_state") {
    return [missionArenaTeamShortLabel(feature), missionArenaTaskRoleLabel(feature)].filter(Boolean).join(" ");
  }
  if (role === "team_state") {
    return [
      missionArenaTeamLabel(feature) ?? "Tým",
      typeof feature.properties.aggregate === "number" ? Math.round(feature.properties.aggregate).toString() : undefined
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "Mise";
}

function missionArenaDetailTitle(feature: SituationFeature): string {
  const role = missionArenaFeatureRole(feature);
  if (role === "task_state") {
    const task = missionArenaPrimaryTask(feature);
    return ["Úkol", missionArenaTeamLabel(feature), missionArenaRoleDisplayName(stringProperty(task?.toRole))]
      .filter(Boolean)
      .join(" · ");
  }
  if (role === "team_state") {
    return [missionArenaTeamLabel(feature) ?? "Tým", feature.properties.missionId].filter(Boolean).join(" · ");
  }
  return feature.properties.label;
}

function missionArenaPrimaryTask(feature: SituationFeature): Record<string, unknown> | undefined {
  return Array.isArray(feature.properties.tasking) ? feature.properties.tasking.find(isRecord) : undefined;
}

function missionArenaTaskRoleLabel(feature: SituationFeature): string {
  const task = missionArenaPrimaryTask(feature);
  return missionArenaRoleAbbreviation(stringProperty(task?.toRole)) ?? "ÚK";
}

function missionArenaTeamLabel(feature: SituationFeature): string | undefined {
  return feature.properties.teamLabel ?? missionArenaTeamIdLabel(feature.properties.teamId);
}

function missionArenaTeamShortLabel(feature: SituationFeature): string | undefined {
  const teamId = feature.properties.teamId?.trim().toLowerCase();
  if (teamId === "alfa" || teamId === "blue" || teamId === "modri") {
    return "M";
  }
  if (teamId === "bravo" || teamId === "red" || teamId === "cerveni") {
    return "Č";
  }
  return missionArenaTeamLabel(feature)?.slice(0, 2).toUpperCase();
}

function missionArenaTeamIdLabel(teamId: string | undefined): string | undefined {
  const normalized = teamId?.trim().toLowerCase();
  if (normalized === "alfa" || normalized === "blue" || normalized === "modri") {
    return "Modří";
  }
  if (normalized === "bravo" || normalized === "red" || normalized === "cerveni") {
    return "Červení";
  }
  return teamId;
}

function missionArenaRoleAbbreviation(role: string | undefined): string | undefined {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "commander") {
    return "VEL";
  }
  if (normalized === "staff") {
    return "ŠTB";
  }
  if (normalized === "signals") {
    return "SPO";
  }
  if (normalized === "cyber") {
    return "KYB";
  }
  return normalized ? normalized.slice(0, 3).toUpperCase() : undefined;
}

function missionArenaRoleDisplayName(role: string | undefined): string | undefined {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "commander") {
    return "velitel";
  }
  if (normalized === "staff") {
    return "štáb";
  }
  if (normalized === "signals") {
    return "spojení";
  }
  if (normalized === "cyber") {
    return "kyber";
  }
  return role;
}

function missionArenaFeatureColor(feature: SituationFeature): string {
  const teamColor = stringProperty(feature.properties.teamColor);
  if (teamColor && /^#[0-9a-fA-F]{6}$/.test(teamColor)) {
    return teamColor;
  }
  const teamId = feature.properties.teamId?.trim().toLowerCase();
  if (teamId === "alfa" || teamId === "blue" || teamId === "modri") {
    return "#38bdf8";
  }
  if (teamId === "bravo" || teamId === "red" || teamId === "cerveni") {
    return "#f87171";
  }
  const role = missionArenaFeatureRole(feature);
  return role === "task_state" ? "#f59e0b" : role === "team_state" ? "#a78bfa" : "#c7f77f";
}

function normalizeTakAffiliation(value: unknown): "friend" | "hostile" | "neutral" | "unknown" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "friend" || normalized === "hostile" || normalized === "neutral" ? normalized : "unknown";
}

export function objectsToHistoryFeatureCollection(
  objects: CopObject[],
  trackHistory: TrackHistory,
  selectedObjectId?: string,
  displayMode: TrackHistoryDisplayMode = "all"
): TrackLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.flatMap((object) => {
      if (displayMode === "selected" && object.objectId !== selectedObjectId) {
        return [];
      }
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
      const selected = object.objectId === selectedObjectId;
      const features: TrackLineFeature[] = [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: prediction.path.map((point) => [point.lon, point.lat] as [number, number])
          },
          properties: {
            objectId: object.objectId,
            color: affiliation.color,
            confidence: prediction.confidence,
            kind: "path",
            selected,
            method: prediction.method,
            uncertaintyM: prediction.uncertaintyM
          }
        }
      ];
      if (selected && prediction.uncertaintyPolygon) {
        features.push({
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: prediction.uncertaintyPolygon.map((ring) =>
              ring.map((point) => [point.lon, point.lat] as [number, number])
            )
          },
          properties: {
            objectId: object.objectId,
            color: affiliation.color,
            confidence: prediction.confidence,
            kind: "uncertainty",
            method: prediction.method,
            opacity: 0.1,
            selected,
            uncertaintyM: prediction.uncertaintyM
          }
        });
      }
      return features;
    })
  };
}

function emptyLineFeatureCollection(): TrackLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function emptySelectedRouteFeatureCollection(): SelectedRouteFeatureCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function emptyEmergencyRouteFeatureCollection(): EmergencyRouteFeatureCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function emptyTrackFeatureCollection(): TrackFeatureCollection {
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

function normalizeOptionalMapUrl(value: string | undefined): string {
  return (value ?? "").trim();
}

function normalizeOptionalMapText(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim();
  return normalized || fallback;
}

export function normalizeMapTileTemplate(value: string | undefined, fallback = defaultTileUrl): string {
  const normalized = normalizeOptionalMapUrl(value);
  if (!normalized) {
    return fallback;
  }
  const hasTileTokens = normalized.includes("{z}") && normalized.includes("{x}") && normalized.includes("{y}");
  return hasTileTokens ? normalized : fallback;
}

export function normalizeMapGlyphsTemplate(value: string | undefined, fallback = defaultTileGlyphsUrl): string {
  const normalized = normalizeOptionalMapUrl(value);
  if (!normalized) {
    return fallback;
  }
  const hasGlyphTokens = normalized.includes("{fontstack}") && normalized.includes("{range}");
  return hasGlyphTokens ? normalized : fallback;
}

export function parseMapCenter(value: string | undefined): [number, number] {
  if (!value) {
    return defaultMapCenter;
  }

  const [lonRaw, latRaw] = value.split(",");
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !isUsableMapCenter([lon, lat])) {
    return defaultMapCenter;
  }
  return [lon, lat];
}

function resolveMapStyle(
  styleUrl: string,
  tiles: string,
  attribution: string,
  glyphs: string
): string | StyleSpecification {
  const normalizedStyleUrl = styleUrl.trim();
  if (normalizedStyleUrl) {
    return normalizedStyleUrl;
  }
  return createRasterStyle(tiles, attribution, glyphs);
}

function createRasterStyle(tiles: string, attribution: string, glyphs: string): StyleSpecification {
  return {
    version: 8,
    glyphs,
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

function applyBasemapMode(map: maplibregl.Map, mode: MapBasemapMode, options: { webKitRuntime?: boolean } = {}): void {
  if (options.webKitRuntime) {
    applyWebKitSafeBasemapMode(map);
    return;
  }
  const settings = basemapPaintSettings(mode);
  const brightnessMin = clampRasterBrightness(settings.brightnessMin);
  const brightnessMax = Math.max(brightnessMin, clampRasterBrightnessMax(settings.brightnessMax));
  const style = map.getStyle();
  const layers = (style.layers ?? []) as Array<{ id: string; type?: string }>;
  layers
    .filter((layer) => layer.type === "raster")
    .forEach((layer) => {
      try {
        map.setPaintProperty(layer.id, "raster-opacity", settings.opacity);
        map.setPaintProperty(layer.id, "raster-saturation", settings.saturation);
        map.setPaintProperty(layer.id, "raster-contrast", settings.contrast);
        map.setPaintProperty(layer.id, "raster-brightness-min", brightnessMin);
        map.setPaintProperty(layer.id, "raster-brightness-max", brightnessMax);
      } catch {
        // External styles can contain provider-specific raster layers; keep overlays alive if one layer rejects tuning.
      }
    });
}

function applyWebKitSafeBasemapMode(map: maplibregl.Map): void {
  map.resize();
  map.triggerRepaint();
}

function basemapPaintSettings(mode: MapBasemapMode): {
  brightnessMax: number;
  brightnessMin: number;
  contrast: number;
  opacity: number;
  saturation: number;
} {
  switch (mode) {
    case "civil":
      return { brightnessMax: 1, brightnessMin: 0.04, contrast: -0.08, opacity: 0.86, saturation: -0.35 };
    case "risk":
      return { brightnessMax: 1, brightnessMin: 0.14, contrast: -0.18, opacity: 0.66, saturation: -0.6 };
    case "dark":
      return { brightnessMax: 0.52, brightnessMin: 0, contrast: -0.05, opacity: 0.82, saturation: -0.7 };
    case "outline":
      return { brightnessMax: 0.76, brightnessMin: 0.12, contrast: -0.32, opacity: 0.26, saturation: -1 };
    case "standard":
    default:
      return { brightnessMax: 0.99, brightnessMin: 0, contrast: 0, opacity: 1, saturation: 0 };
  }
}

function clampRasterBrightness(value: number): number {
  return Math.max(0, Math.min(0.99, Number.isFinite(value) ? value : 0));
}

function clampRasterBrightnessMax(value: number): number {
  return Math.max(0, Math.min(0.99, Number.isFinite(value) ? value : 0.99));
}

function isWebKitRuntime(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent;
  return /AppleWebKit/u.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/u.test(userAgent);
}

export function isRecoverableMapError(message: string): boolean {
  return isRecoverableRasterStyleError(message) || isRecoverableRasterOverlayRequestError(message);
}

function isRecoverableRasterStyleError(message: string): boolean {
  return message.includes("raster-brightness-max") && message.includes("maximum value 1");
}

function isRecoverableRasterOverlayRequestError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("ajaxerror") &&
    normalized.includes("/api/v1/map/raster-overlay") &&
    (normalized.includes("(404)") || normalized.includes("(502)") || normalized.includes("upstream"))
  );
}

export function formatEmergencyRouteSelectionCard(
  properties: Record<string, unknown>,
  response?: RoutingRouteResponse | null
): MapSelectionCard {
  const context = emergencyRouteSelectionContext(properties, response);
  const route = context.route;
  const role = context.role;
  const rank = routeMetricNumber(route, properties, "rank");
  const quality = isRecord(route?.quality) ? route.quality : isRecord(response?.quality) ? response.quality : undefined;
  const qualityMode = stringProperty(quality?.mode) ?? stringProperty(properties.qualityMode);
  const trafficSeverity = stringProperty(properties.trafficSeverity);
  const routeDistanceM = routeMetricNumber(route, properties, "distanceM", "lengthM");
  const routeDurationSeconds = routeMetricNumber(route, properties, "durationSeconds", "durationS");
  const elevationProfile = routeElevationProfileSummary(route);
  const elevationSummary = formatRouteElevationSummary(route, elevationProfile);
  const weatherSummary = formatRouteWeatherSummary(route);
  const hazardsSummary = formatRouteHazardsSummary(route);
  const trafficSummary = formatRouteTrafficSummary(route, response);
  const warnings = routeWarningItems(route, response);
  const sourceStatus = routeSourceStatus(route, response);
  const label = routeDisplayLabel(route, properties, rank);
  const roleLabel = role ? formatEmergencyRouteRole(role) : "Routing overlay";
  const detailRows = compactDetailRows([
    routeDistanceM !== undefined ? { label: "Délka", value: formatRouteDistanceValue(routeDistanceM) } : null,
    routeDurationSeconds !== undefined
      ? { label: "ETA", value: formatRouteDurationSeconds(routeDurationSeconds) }
      : null,
    role ? { label: "Role", value: context.active ? `${roleLabel} · aktivní` : roleLabel } : null,
    rank !== undefined ? { label: "Pořadí", value: String(rank) } : null,
    quality
      ? { label: "Kvalita", value: formatRouteQualitySummary(quality) }
      : qualityMode
        ? { label: "Kvalita", value: qualityMode }
        : null,
    trafficSummary
      ? { label: "Doprava", value: trafficSummary }
      : trafficSeverity
        ? { label: "Incident", value: trafficSeverity }
        : null,
    route ? { label: "Počasí", value: weatherSummary } : null,
    route ? { label: "Rizika", value: hazardsSummary } : null,
    route ? { label: "Výška", value: elevationSummary } : null,
    sourceStatus && sourceStatus !== "ok" ? { label: "Zdroj", value: sourceStatus } : null,
    warnings.length > 0 ? { label: "Caveaty", value: `${warnings.length}` } : null
  ]);
  const analysisSections = routeAnalysisSections(route, response, context.routeId);
  const metaItems = [
    role ? formatEmergencyRouteRole(role) : undefined,
    rank !== undefined ? `rank ${rank}` : undefined,
    quality ? formatRouteQualitySummary(quality) : qualityMode,
    sourceStatus && sourceStatus !== "ok" ? `zdroj ${sourceStatus}` : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    analysisSections,
    compactSubtitle: [
      roleLabel,
      routeDistanceM !== undefined ? formatRouteDistanceValue(routeDistanceM) : "",
      routeDurationSeconds !== undefined ? `ETA ${formatRouteDurationSeconds(routeDurationSeconds)}` : ""
    ]
      .filter(Boolean)
      .join(" · "),
    detailRows,
    elevationProfile,
    eyebrow: role === "incident" ? "Dopravní incident na trase" : "SIM routing",
    key: `route:${context.routeId ?? stringProperty(properties.routeId) ?? label}:${role ?? ""}:${rank ?? ""}`,
    metaItems,
    statusTone: emergencyRouteStatusTone(route, response, role),
    subtitle: [
      roleLabel,
      routeDistanceM !== undefined ? formatRouteDistanceValue(routeDistanceM) : "",
      routeDurationSeconds !== undefined ? `ETA ${formatRouteDurationSeconds(routeDurationSeconds)}` : "",
      context.canActivate ? "lze přepnout" : ""
    ]
      .filter(Boolean)
      .join(" · "),
    title: label
  };
}

function compactDetailRows(
  rows: Array<{ label: string; value: string } | null>
): Array<{ label: string; value: string }> {
  return rows.filter((row): row is { label: string; value: string } => row !== null && row.value.trim().length > 0);
}

function emergencyRouteSelectionContext(
  properties: Record<string, unknown>,
  response?: RoutingRouteResponse | null
): {
  active: boolean;
  canActivate: boolean;
  role?: string;
  route?: Record<string, unknown>;
  routeId?: string;
} {
  const route = routeRecordForEmergencyRouteFeature(properties, response);
  const routeId = routeRecordId(route) ?? routeFeatureRouteIdForMatching(properties);
  const role = stringProperty(properties.role) ?? stringProperty(route?.role);
  const activeRoute = activeRouteRecord(response);
  const activeRouteId = routeRecordId(activeRoute);
  const rank = routeMetricNumber(route, properties, "rank");
  const active =
    routeId && activeRouteId
      ? routeId === activeRouteId
      : role === "primary" || rank === 1 || (route !== undefined && route === activeRoute);
  const routeSelectableRole = role === "alternative" || (rank !== undefined && rank > 1);
  return {
    active,
    canActivate: Boolean(routeId && route && !active && routeSelectableRole),
    role,
    route,
    routeId
  };
}

function routeRecordForEmergencyRouteFeature(
  properties: Record<string, unknown>,
  response?: RoutingRouteResponse | null
): Record<string, unknown> | undefined {
  if (!response) {
    return undefined;
  }
  const routeId = routeFeatureRouteIdForMatching(properties);
  if (routeId) {
    const direct = response.routes.find((route) => routeRecordId(route) === routeId);
    if (direct) {
      return direct;
    }
  }
  const rank = firstRecordNumber(properties, "rank");
  if (rank !== undefined) {
    const ranked = response.routes.find((route) => firstRecordNumber(route, "rank") === rank);
    if (ranked) {
      return ranked;
    }
    const rankedByOrder = response.routes[Math.trunc(rank) - 1];
    if (rankedByOrder) {
      return rankedByOrder;
    }
  }
  const sequence = numberProperty(properties.sequence);
  if (sequence !== undefined && sequence >= 0 && sequence < response.routes.length) {
    return response.routes[Math.trunc(sequence)];
  }
  return undefined;
}

function routeFeatureRouteIdForMatching(properties: Record<string, unknown>): string | undefined {
  const routeId = stringProperty(properties.routeId) ?? stringProperty(properties.id);
  if (!routeId || routeId.startsWith("traffic:")) {
    return undefined;
  }
  if (routeId.endsWith(":origin")) {
    return routeId.slice(0, -":origin".length);
  }
  if (routeId.endsWith(":destination")) {
    return routeId.slice(0, -":destination".length);
  }
  return routeId;
}

function activeRouteRecord(response?: RoutingRouteResponse | null): Record<string, unknown> | undefined {
  return response?.routes.find((route) => firstRecordNumber(route, "rank") === 1) ?? response?.routes[0];
}

function routeRecordId(route: Record<string, unknown> | undefined): string | undefined {
  return stringProperty(route?.routeId) ?? stringProperty(route?.id);
}

function routeDisplayLabel(
  route: Record<string, unknown> | undefined,
  properties: Record<string, unknown>,
  rank: number | undefined
): string {
  return (
    stringProperty(route?.label) ??
    stringProperty(route?.name) ??
    stringProperty(properties.label) ??
    (rank === 1 ? "Primární zásahová trasa" : rank !== undefined ? `Alternativa ${rank}` : "Routing prvek")
  );
}

function routeMetricNumber(
  route: Record<string, unknown> | undefined,
  properties: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  return (route ? firstRecordNumber(route, ...keys) : undefined) ?? firstRecordNumber(properties, ...keys);
}

function routeAnalysisSections(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined,
  activeRouteId: string | undefined
): Array<{ items: string[]; title: string }> | undefined {
  const sections = [
    { title: "Doprava", items: routeTrafficDetailItems(route, response) },
    route ? { title: "Počasí", items: routeWeatherItems(route) } : null,
    route ? { title: "Rizika", items: routeHazardItems(route) } : null,
    { title: "Varování a degradace", items: routeWarningItems(route, response) },
    route ? { title: "Alternativy", items: routeAlternativeItems(response, activeRouteId) } : null
  ].filter((section): section is { items: string[]; title: string } => section !== null && section.items.length > 0);
  return sections.length > 0 ? sections : undefined;
}

function emergencyRouteStatusTone(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined,
  role: string | undefined
): MapSelectionCard["statusTone"] {
  if (role === "incident") {
    return "warn";
  }
  const quality = isRecord(route?.quality) ? route.quality : isRecord(response?.quality) ? response.quality : undefined;
  if (stringProperty(quality?.mode) === "direct_fallback") {
    return "warn";
  }
  const sourceStatus = routeSourceStatus(route, response);
  if (sourceStatus && sourceStatus !== "ok") {
    return ["error", "failed", "unavailable"].includes(sourceStatus) ? "bad" : "warn";
  }
  if (
    routeWarningItems(route, response).length > 0 ||
    routeHazardCount(route) > 0 ||
    routeTrafficIncidentCount(route, response) > 0
  ) {
    return "warn";
  }
  return undefined;
}

function formatRouteDistanceValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km` : `${Math.round(value)} m`;
}

function formatRouteDurationSeconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 60) {
    return `${Math.round(value)} s`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)} min`;
  }
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value - hours * 3600) / 60);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function formatRouteQualitySummary(quality: Record<string, unknown>): string {
  const mode = stringProperty(quality.mode);
  const engine = stringProperty(quality.engine);
  const confidence = numberProperty(quality.confidence);
  const modeLabel =
    mode === "direct_fallback"
      ? "orientační spojnice"
      : mode === "engine_route" && engine === "valhalla"
        ? "Valhalla"
        : mode === "engine_route"
          ? `engine route${engine ? ` ${engine}` : ""}`
          : mode;
  return [
    modeLabel,
    confidence !== undefined ? `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)} %` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function routeTrafficRecordsForDetail(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): Array<Record<string, unknown>> {
  return [
    isRecord(route?.traffic) ? route.traffic : null,
    isRecord(response?.traffic) ? response.traffic : null
  ].filter((traffic): traffic is Record<string, unknown> => traffic !== null);
}

function formatRouteTrafficSummary(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): string {
  if (routeTrafficRecordsForDetail(route, response).length === 0) {
    return "doprava n/a";
  }
  const incidentCount = routeTrafficIncidentCount(route, response);
  const delayPenaltySeconds = Math.max(
    0,
    ...routeTrafficRecordsForDetail(route, response).flatMap(
      (traffic) => firstRecordNumber(traffic, "delayPenaltySeconds", "delaySeconds") ?? []
    )
  );
  const sourceStatus = routeTrafficRecordsForDetail(route, response)
    .map((traffic) => stringProperty(traffic.sourceStatus) ?? stringProperty(traffic.status))
    .find((status) => status && status !== "ok");
  return [
    incidentCount > 0 ? `${incidentCount} incidenty` : "bez incidentů",
    delayPenaltySeconds > 0 ? `zdržení ${formatRouteDurationSeconds(delayPenaltySeconds)}` : undefined,
    sourceStatus && sourceStatus !== "ok" ? `zdroj ${sourceStatus}` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function routeTrafficDetailItems(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): string[] {
  const trafficRecords = routeTrafficRecordsForDetail(route, response);
  if (trafficRecords.length === 0) {
    return ["SIM nevrátil dopravní kontext pro tuto trasu."];
  }
  const incidents = trafficRecords.flatMap((traffic) =>
    Array.isArray(traffic.incidentsOnRoute) ? traffic.incidentsOnRoute.filter(isRecord) : []
  );
  const items = [
    formatRouteTrafficSummary(route, response),
    ...incidents
      .slice(0, 3)
      .map((incident) =>
        [
          stringProperty(incident.label) ??
            stringProperty(incident.title) ??
            stringProperty(incident.type) ??
            "Dopravní incident",
          stringProperty(incident.severity) ? `závažnost ${stringProperty(incident.severity)}` : undefined
        ]
          .filter(Boolean)
          .join(" · ")
      ),
    ...uniqueRouteStrings(
      trafficRecords.flatMap((traffic) => [
        ...recordStringArray(traffic.warnings),
        ...recordStringArray(traffic.limitations)
      ])
    ).slice(0, 3)
  ];
  return items.filter((item) => item.trim().length > 0);
}

function routeTrafficIncidentCount(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): number {
  const trafficRecords = routeTrafficRecordsForDetail(route, response);
  const incidents = trafficRecords.flatMap((traffic) =>
    Array.isArray(traffic.incidentsOnRoute) ? traffic.incidentsOnRoute.filter(isRecord) : []
  );
  return Math.max(
    incidents.length,
    0,
    ...trafficRecords.flatMap((traffic) => numberProperty(traffic.incidentCount) ?? [])
  );
}

function routeWeatherRecord(route: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return firstRecordValue(route, "weatherOnRoute", "weather", "weatherContext", "weatherAlongRoute");
}

function formatRouteWeatherSummary(route: Record<string, unknown> | undefined): string {
  const weather = routeWeatherRecord(route);
  if (!weather) {
    return "nedostupné";
  }
  const temperatureC = firstRecordNumber(weather, "temperatureC", "tempC", "airTemperatureC");
  const precipitationMm = firstRecordNumber(weather, "precipitationMm", "rainMm", "precipitation");
  const windSpeedMs = firstRecordNumber(weather, "windSpeedMs", "windSpeedMps", "windMps");
  const sourceStatus = stringProperty(weather.sourceStatus) ?? stringProperty(weather.status);
  const parts = [
    stringProperty(weather.summary) ?? stringProperty(weather.label) ?? stringProperty(weather.condition),
    temperatureC !== undefined ? `${Math.round(temperatureC)} °C` : undefined,
    precipitationMm !== undefined ? `${precipitationMm.toFixed(precipitationMm < 1 ? 1 : 0)} mm` : undefined,
    windSpeedMs !== undefined ? `vítr ${windSpeedMs.toFixed(1)} m/s` : undefined,
    sourceStatus && sourceStatus !== "ok" ? `zdroj ${sourceStatus}` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "dostupné";
}

function routeWeatherItems(route: Record<string, unknown> | undefined): string[] {
  const weather = routeWeatherRecord(route);
  if (!weather) {
    return ["SIM pro tuto trasu nevrátil počasí na trase."];
  }
  return [
    formatRouteWeatherSummary(route),
    ...uniqueRouteStrings([
      ...recordStringArray(weather.warnings),
      ...recordStringArray(weather.limitations),
      stringProperty(weather.caveat)
    ]).slice(0, 3)
  ].filter((item): item is string => Boolean(item));
}

function routeHazardsValue(route: Record<string, unknown> | undefined): unknown {
  return route?.hazardsOnRoute ?? route?.hazards ?? route?.risksOnRoute ?? route?.riskOnRoute;
}

function routeHazardsRecords(route: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const value = routeHazardsValue(route);
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const key of ["items", "hazards", "features", "risks"]) {
    if (Array.isArray(value[key])) {
      return value[key].filter(isRecord);
    }
  }
  return [];
}

function routeHazardCount(route: Record<string, unknown> | undefined): number {
  const value = routeHazardsValue(route);
  const records = routeHazardsRecords(route);
  if (isRecord(value)) {
    return firstRecordNumber(value, "hazardCount", "riskCount", "count") ?? records.length;
  }
  return records.length;
}

function formatRouteHazardsSummary(route: Record<string, unknown> | undefined): string {
  const value = routeHazardsValue(route);
  if (value === undefined || value === null) {
    return "nedostupné";
  }
  const count = routeHazardCount(route);
  if (count === 0) {
    return "bez hlášených rizik";
  }
  const maxSeverity = isRecord(value)
    ? (stringProperty(value.maxSeverity) ?? stringProperty(value.severity))
    : undefined;
  return maxSeverity ? `${count} rizika · ${maxSeverity}` : `${count} rizika`;
}

function routeHazardItems(route: Record<string, unknown> | undefined): string[] {
  const value = routeHazardsValue(route);
  if (value === undefined || value === null) {
    return ["SIM pro tuto trasu nevrátil rizika na trase."];
  }
  const records = routeHazardsRecords(route);
  const items = records
    .slice(0, 4)
    .map((hazard) =>
      [
        stringProperty(hazard.label) ?? stringProperty(hazard.title) ?? stringProperty(hazard.type) ?? "Riziko",
        stringProperty(hazard.severity) ? `závažnost ${stringProperty(hazard.severity)}` : undefined,
        stringProperty(hazard.sourceStatus) && stringProperty(hazard.sourceStatus) !== "ok"
          ? `zdroj ${stringProperty(hazard.sourceStatus)}`
          : undefined
      ]
        .filter(Boolean)
        .join(" · ")
    );
  if (items.length > 0) {
    return items;
  }
  return [formatRouteHazardsSummary(route)];
}

function routeElevationProfileSummary(
  route: Record<string, unknown> | undefined
): RouteElevationProfileSummary | undefined {
  const rawProfile = Array.isArray(route?.elevationProfile)
    ? route.elevationProfile
    : Array.isArray(route?.profile)
      ? route.profile
      : [];
  const points = rawProfile.flatMap((point, index) => {
    if (Array.isArray(point)) {
      const distanceM = Number(point[0]);
      const elevationM = Number(point[1]);
      return Number.isFinite(elevationM)
        ? [{ distanceM: Number.isFinite(distanceM) ? distanceM : index, elevationM }]
        : [];
    }
    if (!isRecord(point)) {
      return [];
    }
    const distanceKm = firstRecordNumber(point, "distanceKm", "offsetKm");
    const distanceM =
      firstRecordNumber(point, "distanceM", "distance_m", "distance", "offsetM", "chainageM", "x") ??
      (distanceKm !== undefined ? distanceKm * 1000 : index);
    const elevationM = firstRecordNumber(
      point,
      "elevationM",
      "elevation_m",
      "elevation",
      "altitudeM",
      "altitude",
      "z",
      "y"
    );
    return elevationM !== undefined ? [{ distanceM, elevationM }] : [];
  });
  if (points.length < 2) {
    return undefined;
  }
  const elevations = points.map((point) => point.elevationM);
  let gainM = 0;
  let lossM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index]!.elevationM - points[index - 1]!.elevationM;
    if (delta > 0) {
      gainM += delta;
    } else {
      lossM += Math.abs(delta);
    }
  }
  const elevation = isRecord(route?.elevation) ? route.elevation : {};
  return {
    gainM:
      firstRecordNumber(elevation, "gainM", "elevationGainM", "ascentM") ??
      numberProperty(route?.elevationGainM) ??
      gainM,
    lossM: firstRecordNumber(elevation, "lossM", "elevationLossM", "descentM") ?? lossM,
    maxM: firstRecordNumber(elevation, "maxM", "maxElevationM", "maximumM") ?? Math.max(...elevations),
    minM: firstRecordNumber(elevation, "minM", "minElevationM", "minimumM") ?? Math.min(...elevations),
    points
  };
}

function formatRouteElevationSummary(
  route: Record<string, unknown> | undefined,
  profile: RouteElevationProfileSummary | undefined
): string {
  const elevation = isRecord(route?.elevation) ? route.elevation : undefined;
  const gainM =
    profile?.gainM ??
    firstRecordNumber(elevation ?? {}, "gainM", "elevationGainM", "ascentM") ??
    numberProperty(route?.elevationGainM);
  const minM = profile?.minM ?? firstRecordNumber(elevation ?? {}, "minM", "minElevationM", "minimumM");
  const maxM = profile?.maxM ?? firstRecordNumber(elevation ?? {}, "maxM", "maxElevationM", "maximumM");
  if (gainM === undefined && minM === undefined && maxM === undefined) {
    return "nedostupné";
  }
  return [
    gainM !== undefined ? `stoupání ${Math.round(gainM)} m` : undefined,
    minM !== undefined && maxM !== undefined ? `${Math.round(minM)}-${Math.round(maxM)} m n. m.` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function routeWarningItems(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): string[] {
  const trafficRecords = routeTrafficRecordsForDetail(route, response);
  const warnings = uniqueRouteStrings([
    ...recordStringArray(route?.warnings),
    ...(Array.isArray(response?.warnings) ? response.warnings : []),
    ...trafficRecords.flatMap((traffic) => [
      ...recordStringArray(traffic.warnings),
      ...recordStringArray(traffic.limitations)
    ])
  ]);
  const quality = isRecord(route?.quality) ? route.quality : isRecord(response?.quality) ? response.quality : undefined;
  if (stringProperty(quality?.mode) === "direct_fallback") {
    warnings.unshift("Orientační spojnice, ne navigace po komunikacích.");
  }
  const sourceStatus = routeSourceStatus(route, response);
  if (sourceStatus && sourceStatus !== "ok") {
    warnings.unshift(`Zdroj trasy je ve stavu ${sourceStatus}.`);
  }
  return uniqueRouteStrings(warnings).slice(0, 5);
}

function routeAlternativeItems(
  response: RoutingRouteResponse | null | undefined,
  activeRouteId: string | undefined
): string[] {
  if (!response || response.routes.length <= 1) {
    return [];
  }
  return response.routes.slice(0, 5).map((route, index) => {
    const routeId = routeRecordId(route);
    const rank = firstRecordNumber(route, "rank") ?? index + 1;
    const active = routeId && activeRouteId ? routeId === activeRouteId : rank === 1;
    return [
      active ? "Aktivní" : `Varianta ${rank}`,
      formatRouteDistanceValue(firstRecordNumber(route, "distanceM", "lengthM")),
      `ETA ${formatRouteDurationSeconds(firstRecordNumber(route, "durationSeconds", "durationS"))}`,
      formatRouteTrafficSummary(route, response)
    ]
      .filter(Boolean)
      .join(" · ");
  });
}

function routeSourceStatus(
  route: Record<string, unknown> | undefined,
  response: RoutingRouteResponse | null | undefined
): string | undefined {
  return (
    stringProperty(route?.sourceStatus) ??
    stringProperty(route?.status) ??
    routeTrafficRecordsForDetail(route, response)
      .map((traffic) => stringProperty(traffic.sourceStatus) ?? stringProperty(traffic.status))
      .find(Boolean)
  );
}

function firstRecordValue(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (isRecord(record[key])) {
      return record[key];
    }
  }
  return undefined;
}

function recordStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringProperty(item) ?? []) : [];
}

function uniqueRouteStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatEmergencyRouteCardSummary(
  response: RoutingRouteResponse | null | undefined,
  fallbackMessage: string | null | undefined
): string | null {
  const route = activeRouteRecord(response);
  if (!route) {
    return fallbackMessage ?? null;
  }
  const label = routeSummaryLabelFromMessage(fallbackMessage) ?? "Trasa";
  const quality = isRecord(route.quality) ? route.quality : isRecord(response?.quality) ? response.quality : undefined;
  const traffic = formatRouteTrafficSummary(route, response);
  return [
    `${label}: ${formatRouteDistanceValue(firstRecordNumber(route, "distanceM", "lengthM"))}`,
    `ETA ${formatRouteDurationSeconds(firstRecordNumber(route, "durationSeconds", "durationS"))}`,
    quality ? formatRouteQualitySummary(quality) : undefined,
    traffic && traffic !== "bez incidentů" && traffic !== "doprava n/a" ? traffic : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function routeSummaryLabelFromMessage(message: string | null | undefined): string | undefined {
  const label = message?.split(":")[0]?.trim();
  return label && label.length <= 48 ? label : undefined;
}

function formatEmergencyRouteRole(role: string): string {
  switch (role) {
    case "access":
      return "Přístupový bod";
    case "alternative":
      return "Alternativní trasa";
    case "destination":
      return "Cíl";
    case "incident":
      return "Dopravní incident";
    case "isochrone":
      return "Dosahová oblast";
    case "origin":
      return "Start";
    case "primary":
      return "Primární trasa";
    default:
      return role;
  }
}

function emergencyRouteToFeatureCollection(
  response: RoutingRouteResponse | null | undefined
): EmergencyRouteFeatureCollection {
  if (!response) {
    return emptyEmergencyRouteFeatureCollection();
  }
  const features: EmergencyRouteFeatureCollection["features"] = [];
  for (const [index, feature] of response.features.entries()) {
    const area = routeAreaGeometry(feature.geometry);
    if (area) {
      features.push({
        geometry: area,
        properties: {
          kind: "route-area",
          distanceM: routeFeatureDistanceM(feature.properties),
          durationSeconds: routeFeatureDurationSeconds(feature.properties),
          label: routeFeatureLabel(feature.properties, index),
          qualityMode: routeFeatureQualityMode(feature.properties, response.quality),
          rank: routeFeatureRank(feature.properties),
          role: routeFeatureRole(feature.properties, index),
          routeId: routeFeatureId(feature.properties, index),
          sequence: index
        },
        type: "Feature"
      });
      continue;
    }
    const geometry = routeLineGeometry(feature.geometry);
    if (geometry) {
      features.push({
        geometry,
        properties: {
          kind: "route-line",
          distanceM: routeFeatureDistanceM(feature.properties),
          durationSeconds: routeFeatureDurationSeconds(feature.properties),
          label: routeFeatureLabel(feature.properties, index),
          qualityMode: routeFeatureQualityMode(feature.properties, response.quality),
          rank: routeFeatureRank(feature.properties),
          role: routeFeatureRole(feature.properties, index),
          routeId: routeFeatureId(feature.properties, index),
          sequence: index
        },
        type: "Feature"
      });
      continue;
    }
    const point = routePointGeometry(feature.geometry);
    if (point) {
      features.push({
        geometry: point,
        properties: {
          kind: "route-point",
          distanceM: routeFeatureDistanceM(feature.properties),
          durationSeconds: routeFeatureDurationSeconds(feature.properties),
          label: routeFeatureLabel(feature.properties, index),
          qualityMode: routeFeatureQualityMode(feature.properties, response.quality),
          rank: routeFeatureRank(feature.properties),
          role: routeFeatureRole(feature.properties, index),
          routeId: routeFeatureId(feature.properties, index),
          sequence: index
        },
        type: "Feature"
      });
    }
  }
  if (!features.some((feature) => feature.geometry.type === "LineString")) {
    for (const [index, route] of response.routes.entries()) {
      const geometry = routeLineGeometryFromRecord(route);
      if (!geometry) {
        continue;
      }
      features.push({
        geometry,
        properties: {
          kind: "route-line",
          distanceM: routeFeatureDistanceM(route),
          durationSeconds: routeFeatureDurationSeconds(route),
          label: routeFeatureLabel(route, index),
          qualityMode: routeFeatureQualityMode(route, response.quality),
          rank: routeFeatureRank(route),
          role: routeFeatureRole(route, index),
          routeId: routeFeatureId(route, index),
          sequence: index
        },
        type: "Feature"
      });
    }
  }
  appendRoutingTrafficIncidentFeatures(features, response);
  const firstLine = features.find((feature) => feature.geometry.type === "LineString");
  if (firstLine?.geometry.type === "LineString" && firstLine.geometry.coordinates.length >= 2) {
    const first = firstLine.geometry.coordinates[0]!;
    const last = firstLine.geometry.coordinates[firstLine.geometry.coordinates.length - 1]!;
    features.push(
      {
        geometry: { coordinates: first, type: "Point" },
        properties: {
          kind: "route-point",
          label: "Start",
          role: "origin",
          routeId: `${firstLine.properties.routeId}:origin`
        },
        type: "Feature"
      },
      {
        geometry: { coordinates: last, type: "Point" },
        properties: {
          kind: "route-point",
          label: "Cíl",
          role: "destination",
          routeId: `${firstLine.properties.routeId}:destination`
        },
        type: "Feature"
      }
    );
  }
  return {
    features,
    type: "FeatureCollection"
  };
}

function routeLineGeometry(value: unknown): { coordinates: Array<[number, number]>; type: "LineString" } | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const coordinates = normalizeRouteCoordinates(value.coordinates);
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  if (value.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((line) =>
      Array.isArray(line) ? normalizeRouteCoordinates(line) : []
    );
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  return null;
}

function routeAreaGeometry(
  value: unknown
):
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" }
  | { coordinates: Array<Array<Array<[number, number]>>>; type: "MultiPolygon" }
  | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const coordinates = normalizeRoutePolygon(value.coordinates);
    return coordinates.length > 0 ? { coordinates, type: "Polygon" } : null;
  }
  if (value.type === "MultiPolygon" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates
      .flatMap((polygon) => (Array.isArray(polygon) ? [normalizeRoutePolygon(polygon)] : []))
      .filter((polygon) => polygon.length > 0);
    return coordinates.length > 0 ? { coordinates, type: "MultiPolygon" } : null;
  }
  return null;
}

function routePointGeometry(value: unknown): { coordinates: [number, number]; type: "Point" } | null {
  if (!isRecord(value) || value.type !== "Point" || !Array.isArray(value.coordinates)) {
    return null;
  }
  const coordinate = normalizeRouteCoordinate(value.coordinates);
  return coordinate ? { coordinates: coordinate, type: "Point" } : null;
}

function routeLineGeometryFromRecord(
  record: Record<string, unknown>
): { coordinates: Array<[number, number]>; type: "LineString" } | null {
  const directKeys = ["geometry", "routeGeometry", "routeShape", "shape", "lineString", "path"];
  for (const key of directKeys) {
    const geometry = routeLineGeometry(record[key]);
    if (geometry) {
      return geometry;
    }
  }
  if (Array.isArray(record.coordinates)) {
    const coordinates = normalizeRouteCoordinates(record.coordinates);
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  return null;
}

function normalizeRoutePolygon(value: unknown[]): Array<Array<[number, number]>> {
  return value.flatMap((ring) => {
    const coordinates = Array.isArray(ring) ? normalizeRouteCoordinates(ring) : [];
    return coordinates.length >= 3 ? [coordinates] : [];
  });
}

function normalizeRouteCoordinates(value: unknown[]): Array<[number, number]> {
  return value.flatMap((item) => {
    const coordinate = normalizeRouteCoordinate(item);
    return coordinate ? [coordinate] : [];
  });
}

function normalizeRouteCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function routeFeatureLabel(properties: Record<string, unknown> | undefined, index: number): string {
  return (
    stringProperty(properties?.label) ??
    stringProperty(properties?.title) ??
    (index === 0 ? "Primární trasa" : `Alternativa ${index + 1}`)
  );
}

function routeFeatureId(properties: Record<string, unknown> | undefined, index: number): string {
  return stringProperty(properties?.routeId) ?? stringProperty(properties?.id) ?? `route-${index + 1}`;
}

function routeFeatureRank(properties: Record<string, unknown> | undefined): number | undefined {
  return properties ? firstRecordNumber(properties, "rank") : undefined;
}

function routeFeatureDistanceM(properties: Record<string, unknown> | undefined): number | undefined {
  return properties ? firstRecordNumber(properties, "distanceM", "lengthM") : undefined;
}

function routeFeatureDurationSeconds(properties: Record<string, unknown> | undefined): number | undefined {
  return properties ? firstRecordNumber(properties, "durationSeconds", "durationS") : undefined;
}

function routeFeatureQualityMode(
  properties: Record<string, unknown> | undefined,
  fallbackQuality: Record<string, unknown> | undefined
): string | undefined {
  const quality = isRecord(properties?.quality) ? properties.quality : fallbackQuality;
  return stringProperty(quality?.mode);
}

function routeFeatureRole(
  properties: Record<string, unknown> | undefined,
  index: number
): EmergencyRouteFeatureCollection["features"][number]["properties"]["role"] {
  const role = (stringProperty(properties?.role) ?? stringProperty(properties?.styleHint))?.toLowerCase();
  if (
    role === "access" ||
    role === "origin" ||
    role === "destination" ||
    role === "alternative" ||
    role === "incident" ||
    role === "isochrone" ||
    role === "primary"
  ) {
    return role;
  }
  if (properties && firstRecordNumber(properties, "rank") === 1) {
    return "primary";
  }
  return index === 0 ? "primary" : "alternative";
}

function appendRoutingTrafficIncidentFeatures(
  features: EmergencyRouteFeatureCollection["features"],
  response: RoutingRouteResponse
): void {
  const seen = new Set<string>();
  const trafficRecords = [
    ...response.routes.flatMap((route) => (isRecord(route.traffic) ? [route.traffic] : [])),
    ...(isRecord(response.traffic) ? [response.traffic] : [])
  ];
  for (const traffic of trafficRecords) {
    const incidents = Array.isArray(traffic.incidentsOnRoute) ? traffic.incidentsOnRoute.filter(isRecord) : [];
    for (const [index, incident] of incidents.entries()) {
      const coordinate = routeIncidentCoordinate(incident);
      if (!coordinate) {
        continue;
      }
      const incidentId =
        stringProperty(incident.incidentId) ?? stringProperty(incident.id) ?? `${coordinate.join(",")}:${index}`;
      if (seen.has(incidentId)) {
        continue;
      }
      seen.add(incidentId);
      features.push({
        geometry: { coordinates: coordinate, type: "Point" },
        properties: {
          kind: "route-point",
          label:
            stringProperty(incident.label) ??
            stringProperty(incident.title) ??
            stringProperty(incident.type) ??
            "Dopravní incident",
          role: "incident",
          routeId: `traffic:${incidentId}`,
          sequence: features.length,
          trafficSeverity: stringProperty(incident.severity)
        },
        type: "Feature"
      });
    }
  }
}

function routeIncidentCoordinate(record: Record<string, unknown>): [number, number] | null {
  const directGeometry = routePointGeometry(record.geometry);
  if (directGeometry) {
    return directGeometry.coordinates;
  }
  for (const key of ["point", "location", "coordinate", "coordinates"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      const coordinate = normalizeRouteCoordinate(value);
      if (coordinate) {
        return coordinate;
      }
    }
    if (isRecord(value)) {
      const nestedGeometry = routePointGeometry(value.geometry);
      if (nestedGeometry) {
        return nestedGeometry.coordinates;
      }
      const lat = numberProperty(value.lat) ?? numberProperty(value.latitude);
      const lon = numberProperty(value.lon) ?? numberProperty(value.lng) ?? numberProperty(value.longitude);
      if (lat !== undefined && lon !== undefined) {
        return [lon, lat];
      }
    }
  }
  const lat = numberProperty(record.lat) ?? numberProperty(record.latitude);
  const lon = numberProperty(record.lon) ?? numberProperty(record.lng) ?? numberProperty(record.longitude);
  return lat !== undefined && lon !== undefined ? [lon, lat] : null;
}

function fitMapToEmergencyRoute(map: maplibregl.Map, collection: EmergencyRouteFeatureCollection): boolean {
  const points: Array<[number, number]> = [];
  for (const feature of collection.features) {
    collectGeometryCoordinates(feature.geometry.coordinates, points);
  }
  if (points.length === 0) {
    return false;
  }
  const bounds = new maplibregl.LngLatBounds();
  points.forEach((point) => bounds.extend(point));
  if (points.length === 1) {
    map.easeTo({ center: points[0]!, duration: 650, zoom: Math.max(map.getZoom(), 14) });
    return true;
  }
  map.fitBounds(bounds, {
    duration: 750,
    maxZoom: 15,
    padding: { bottom: 96, left: 88, right: 88, top: 96 }
  });
  return true;
}

export function fitMapToObjects(map: maplibregl.Map | null, objects: CopObject[]): boolean {
  return fitMapToVisibleContent(map, objects.filter(hasPosition), emptySituationContextFeatureCollection());
}

export function fitMapToVisibleContent(
  map: maplibregl.Map | null,
  objects: CopObject[],
  situationFeatures: SituationContextFeatureCollection
): boolean {
  const points = [
    ...objects.filter(hasPosition).map((object): [number, number] => [object.position.lon, object.position.lat]),
    ...fitEligibleSituationCoordinates(situationFeatures)
  ];

  if (!map || points.length === 0) {
    return false;
  }

  const bounds = new maplibregl.LngLatBounds();
  points.forEach((point) => bounds.extend(point));

  if (points.length === 1) {
    map.easeTo({
      center: points[0]!,
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

function fitEligibleSituationCoordinates(collection: SituationContextFeatureCollection): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const feature of collection.features) {
    if (!isFitEligibleSituationFeature(feature)) {
      continue;
    }
    collectGeometryCoordinates(feature.geometry.coordinates, points);
  }
  return points;
}

function isFitEligibleSituationFeature(feature: SituationContextFeatureCollection["features"][number]): boolean {
  if (
    feature.properties.weatherPulse ||
    feature.properties.weatherGrid ||
    isSituationRasterOverlayFeature(feature as SituationFeature)
  ) {
    return false;
  }
  return feature.geometry.type === "Point";
}

function buildFitSignature(objects: CopObject[], situationFeatures: SituationContextFeatureCollection): string {
  const objectIds = objects.filter(hasPosition).map((object) => `object:${object.objectId}`);
  const featureIds = situationFeatures.features
    .filter(isFitEligibleSituationFeature)
    .map((feature) => `feature:${feature.properties.featureId}`);
  return [...objectIds, ...featureIds].sort().join("|");
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

function LegendItem({
  color,
  disposition,
  label
}: {
  color: string;
  disposition: AffiliationDisposition;
  label: string;
}) {
  return (
    <div className="legend-item">
      <span className={`legend-symbol ${disposition}`} style={{ borderColor: color }} />
      {label}
    </div>
  );
}

function DynamicLegendItemView({ item }: { item: DynamicLegendItem }) {
  return (
    <div className="legend-item dynamic" title={`${item.label}: ${item.count.toLocaleString("cs-CZ")} v záběru`}>
      <span
        className={["legend-dynamic-symbol", item.shape, item.disposition ? `disposition-${item.disposition}` : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ borderColor: item.color }}
      />
      <strong>{item.label}</strong>
      <small>{item.count.toLocaleString("cs-CZ")}</small>
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

export const CopMap = React.memo(CopMapComponent);
CopMap.displayName = "CopMap";

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

function CoverageLegendItem() {
  return (
    <div
      className="legend-item coverage-legend-item"
      title="Modelové hodnocení, ne garantované pokrytí ani potvrzený výpadek operátora."
    >
      <span className="legend-coverage-swatch good" />
      <span className="legend-coverage-swatch fair" />
      <span className="legend-coverage-swatch weak" />
      <span className="legend-coverage-swatch none" />
      Mobilní síť
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
              <em>
                {leaf.objectType} · {leaf.affiliation} · {leaf.status}
              </em>
            </li>
          ))}
        </ul>
      ) : (
        <p>Detail shluku bude dostupný po přiblížení.</p>
      )}
    </div>
  );
}
