import React from "react";
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CopLayer, CopObject } from "./cop-data";
import {
  getAffiliationPresentation,
  getNatoIconKey,
  getObjectTypeGlyph,
  resolveCopObjectSymbol,
  type AffiliationDisposition
} from "./symbology";

const trackSourceId = "cop-live-tracks";
const trackSelectedHaloLayerId = "cop-live-track-selected-halo";
const trackSymbolLayerId = "cop-live-track-symbol";

const tileUrl = import.meta.env.VITE_COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution = import.meta.env.VITE_COP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";
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
  symbolCode: string;
  symbolKey: string;
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
      registerNatoSymbolImages(map);

      map.addLayer({
        id: trackSelectedHaloLayerId,
        type: "circle",
        source: trackSourceId,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-color": ["get", "symbolColor"],
          "circle-opacity": 0.16,
          "circle-radius": 24,
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
          "icon-size": 0.74,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });

      map.on("click", trackSymbolLayerId, handleClick);
      map.on("mouseenter", trackSymbolLayerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", trackSymbolLayerId, () => {
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
        <LegendItem disposition="friend" color="#3b82f6" label="Vlastní" />
        <LegendItem disposition="hostile" color="#ef4444" label="Cizí" />
        <LegendItem disposition="neutral" color="#22c55e" label="Neutrální" />
        <LegendItem disposition="unknown" color="#facc15" label="Neznámé" />
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
          symbolColor: affiliation.color,
          symbolDisposition: affiliation.disposition
        }
      };
    })
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

function registerNatoSymbolImages(map: maplibregl.Map) {
  const objectTypes = ["AIRCRAFT", "UAV", "MISSILE_TRACK", "GROUND_UNIT", "UNKNOWN"];
  const affiliations = ["FRIEND", "HOSTILE", "NEUTRAL", "UNKNOWN", "PENDING"];

  objectTypes.forEach((objectType) => {
    affiliations.forEach((affiliation) => {
      const key = getNatoIconKey(objectType, affiliation);
      if (!map.hasImage(key)) {
        map.addImage(key, createNatoSymbolImage(objectType, getAffiliationPresentation(affiliation)), {
          pixelRatio: window.devicePixelRatio || 1
        });
      }
    });
  });
}

function createNatoSymbolImage(objectType: string, presentation: ReturnType<typeof getAffiliationPresentation>): ImageData {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  context.lineWidth = 5;
  context.strokeStyle = presentation.color;
  context.fillStyle = "rgba(6, 16, 25, 0.88)";
  drawAffiliationFrame(context, presentation.disposition, size);

  context.fillStyle = presentation.color;
  context.font = objectType === "MISSILE_TRACK" ? "700 17px Inter, Arial, sans-serif" : "800 19px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(getObjectTypeGlyph(objectType), size / 2, size / 2 + 1);

  context.fillStyle = "rgba(6, 16, 25, 0.92)";
  context.beginPath();
  context.arc(size / 2, size - 14, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = presentation.color;
  context.beginPath();
  context.arc(size / 2, size - 14, 3, 0, Math.PI * 2);
  context.fill();

  return context.getImageData(0, 0, size, size);
}

function drawAffiliationFrame(context: CanvasRenderingContext2D, disposition: AffiliationDisposition, size: number) {
  if (disposition === "hostile") {
    context.beginPath();
    context.moveTo(size / 2, 9);
    context.lineTo(size - 9, size / 2);
    context.lineTo(size / 2, size - 9);
    context.lineTo(9, size / 2);
    context.closePath();
    context.fill();
    context.stroke();
    return;
  }

  if (disposition === "unknown" || disposition === "pending") {
    const left = 15;
    const top = 18;
    const width = size - 30;
    const height = size - 36;
    context.beginPath();
    context.moveTo(left + 12, top);
    context.lineTo(left + width - 12, top);
    context.quadraticCurveTo(left + width, top, left + width, top + 12);
    context.lineTo(left + width, top + height - 12);
    context.quadraticCurveTo(left + width, top + height, left + width - 12, top + height);
    context.lineTo(left + 12, top + height);
    context.quadraticCurveTo(left, top + height, left, top + height - 12);
    context.lineTo(left, top + 12);
    context.quadraticCurveTo(left, top, left + 12, top);
    context.fill();
    context.stroke();
    return;
  }

  const inset = disposition === "neutral" ? 16 : 14;
  context.beginPath();
  context.rect(inset, inset + 4, size - inset * 2, size - inset * 2 - 8);
  context.fill();
  context.stroke();
}

function LegendItem({ color, disposition, label }: { color: string; disposition: AffiliationDisposition; label: string }) {
  return (
    <div className="legend-item">
      <span className={`legend-symbol ${disposition}`} style={{ borderColor: color }} />
      {label}
    </div>
  );
}
