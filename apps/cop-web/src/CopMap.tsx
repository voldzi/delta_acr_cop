import React from "react";
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CopLayer, CopObject } from "./cop-data";

const trackSourceId = "cop-live-tracks";
const trackHaloLayerId = "cop-live-track-halo";
const trackPointLayerId = "cop-live-track-point";
const trackSelectedLayerId = "cop-live-track-selected";

const tileUrl = import.meta.env.VITE_COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_COP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
const defaultCenter = parseMapCenter(import.meta.env.VITE_COP_MAP_CENTER);
const defaultZoom = parseFiniteNumber(import.meta.env.VITE_COP_MAP_ZOOM, 8);

export interface TrackFeatureProperties {
  objectId: string;
  objectType: string;
  confidence: number;
  status: string;
  synthetic: boolean;
  selected: boolean;
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

interface CopMapProps {
  objects: CopObject[];
  selectedLayer: CopLayer;
  selectedObjectId?: string;
  onSelectObject: (object: CopObject) => void;
}

export function CopMap({ objects, selectedLayer, selectedObjectId, onSelectObject }: CopMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const objectsRef = React.useRef(objects);
  const onSelectObjectRef = React.useRef(onSelectObject);
  const lastFitSignatureRef = React.useRef("");
  const [mapReady, setMapReady] = React.useState(false);
  const [autoFit, setAutoFit] = React.useState(true);
  const [mapError, setMapError] = React.useState<string | null>(null);

  const selectedId = selectedObjectId ?? objects[0]?.objectId;
  const positionedObjects = React.useMemo(() => objects.filter(hasPosition), [objects]);
  const featureCollection = React.useMemo(
    () => objectsToTrackFeatureCollection(objects, selectedId),
    [objects, selectedId]
  );

  objectsRef.current = objects;
  onSelectObjectRef.current = onSelectObject;

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createRasterStyle(tileUrl, tileAttribution),
      center: defaultCenter,
      zoom: defaultZoom,
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
      map.addSource(trackSourceId, {
        type: "geojson",
        data: objectsToTrackFeatureCollection(objectsRef.current, objectsRef.current[0]?.objectId) as Parameters<GeoJSONSource["setData"]>[0]
      });

      map.addLayer({
        id: trackHaloLayerId,
        type: "circle",
        source: trackSourceId,
        paint: {
          "circle-color": [
            "match",
            ["get", "objectType"],
            "AIRCRAFT",
            "#83c7ff",
            "UAV",
            "#c8f08d",
            "MISSILE_TRACK",
            "#ffca6a",
            "#e8eef5"
          ],
          "circle-opacity": 0.18,
          "circle-radius": ["interpolate", ["linear"], ["get", "confidence"], 0, 10, 1, 26],
          "circle-stroke-color": "rgba(255, 255, 255, 0.18)",
          "circle-stroke-width": 1
        }
      });

      map.addLayer({
        id: trackPointLayerId,
        type: "circle",
        source: trackSourceId,
        paint: {
          "circle-color": [
            "match",
            ["get", "objectType"],
            "AIRCRAFT",
            "#83c7ff",
            "UAV",
            "#c8f08d",
            "MISSILE_TRACK",
            "#ffca6a",
            "#e8eef5"
          ],
          "circle-opacity": 0.94,
          "circle-radius": ["match", ["get", "objectType"], "MISSILE_TRACK", 6, "UAV", 7, 8],
          "circle-stroke-color": "#061019",
          "circle-stroke-width": ["case", ["boolean", ["get", "synthetic"], false], 2, 1]
        }
      });

      map.addLayer({
        id: trackSelectedLayerId,
        type: "circle",
        source: trackSourceId,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-color": "rgba(255, 255, 255, 0)",
          "circle-radius": 15,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.9,
          "circle-stroke-width": 3
        }
      });

      map.on("click", trackPointLayerId, handleClick);
      map.on("click", trackSelectedLayerId, handleClick);
      map.on("mouseenter", trackPointLayerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", trackPointLayerId, () => {
        map.getCanvas().style.cursor = "";
      });
      setMapReady(true);
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
    const source = mapRef.current?.getSource(trackSourceId);
    if (mapReady && source && "setData" in source) {
      (source as GeoJSONSource).setData(featureCollection as Parameters<GeoJSONSource["setData"]>[0]);
    }
  }, [featureCollection, mapReady]);

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
            setAutoFit((current) => !current);
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
      </div>
      <div className="map-legend">
        <LegendItem color="#83c7ff" label="Aircraft" />
        <LegendItem color="#c8f08d" label="UAV" />
        <LegendItem color="#ffca6a" label="Missile" />
      </div>
      {missingPositionCount > 0 ? <div className="map-notice">{missingPositionCount} objektů bez polohy není v mapě.</div> : null}
      {mapError ? <div className="map-notice error">Mapový podklad: {mapError}</div> : null}
      {objects.length === 0 ? <div className="map-empty">Čekám na georeferencované COP tracky.</div> : null}
    </div>
  );
}

export function objectsToTrackFeatureCollection(objects: CopObject[], selectedObjectId?: string): TrackFeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.filter(hasPosition).map((object) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [object.position!.lon, object.position!.lat]
      },
      properties: {
        objectId: object.objectId,
        objectType: object.objectType,
        confidence: object.confidence ?? 0,
        status: object.status,
        synthetic: Boolean(object.synthetic),
        selected: object.objectId === selectedObjectId
      }
    }))
  };
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

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="legend-item">
      <span style={{ background: color }} />
      {label}
    </div>
  );
}
