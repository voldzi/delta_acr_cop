export type GeoCoordinate = [longitude: number, latitude: number];

export type GeoBounds = [southWest: GeoCoordinate, northEast: GeoCoordinate];

export interface GeoMapPoint<Properties extends Record<string, unknown> = Record<string, unknown>> {
  coordinate: GeoCoordinate;
  id?: number | string;
  properties: Properties;
}

export interface GeoPointGeometry {
  coordinates: GeoCoordinate;
  type: "Point";
}

export interface GeoLineStringGeometry {
  coordinates: GeoCoordinate[];
  type: "LineString";
}

export interface GeoPointFeature<Properties extends Record<string, unknown> = Record<string, unknown>> {
  geometry: GeoPointGeometry;
  id?: number | string;
  properties: Properties;
  type: "Feature";
}

export interface GeoLineStringFeature<Properties extends Record<string, unknown> = Record<string, unknown>> {
  geometry: GeoLineStringGeometry;
  id?: number | string;
  properties: Properties;
  type: "Feature";
}

export interface GeoFeatureCollection<Feature> {
  features: Feature[];
  type: "FeatureCollection";
}

export type GeoPointFeatureCollection<Properties extends Record<string, unknown> = Record<string, unknown>> =
  GeoFeatureCollection<GeoPointFeature<Properties>>;

export type GeoLineStringFeatureCollection<Properties extends Record<string, unknown> = Record<string, unknown>> =
  GeoFeatureCollection<GeoLineStringFeature<Properties>>;

export interface GeoClusterProperties extends Record<string, unknown> {
  cluster: true;
  cluster_id: number;
  point_count: number;
  point_count_abbreviated: number | string;
}

export type GeoClusterPointFeature = GeoPointFeature<GeoClusterProperties>;

export interface GeoRouteSummary {
  distanceM: number;
  durationSeconds: number;
  elevationGainM: number;
  elevationLossM: number;
}

export interface GeoRoutingDataset {
  builtAt: string;
  version: string;
}

export interface PublishedGeoRoute {
  computedAt?: string;
  contractVersion: string;
  geometry: GeoLineStringGeometry;
  profile: "bicycle" | "walking" | string;
  routingDataset: GeoRoutingDataset;
  summary: GeoRouteSummary;
  waypointOrder: number[];
}

export type MapExpression = unknown[];

export interface GeoJsonSourceSpecification {
  cluster?: boolean;
  clusterMaxZoom?: number;
  clusterRadius?: number;
  data: unknown;
  type: "geojson";
}

export interface MapCircleLayerSpecification {
  filter?: MapExpression;
  id: string;
  paint: Record<string, unknown>;
  source: string;
  type: "circle";
}

export interface MapSymbolLayerSpecification {
  filter?: MapExpression;
  id: string;
  layout: Record<string, unknown>;
  paint?: Record<string, unknown>;
  source: string;
  type: "symbol";
}

export interface MapLineLayerSpecification {
  filter?: MapExpression;
  id: string;
  layout?: Record<string, unknown>;
  paint: Record<string, unknown>;
  source: string;
  type: "line";
}
