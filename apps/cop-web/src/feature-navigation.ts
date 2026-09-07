import type { SituationFeature } from "./cop-data";

const destinationLayers = new Set(["trail_poi", "flight_airports", "place_settlements"]);

/** A geometry vertex is not an entrance or a safe destination. Fail closed. */
export function featureNavigationTarget(feature: SituationFeature): { label: string; lat: number; lon: number } | null {
  if (feature.geometry.type !== "Point" || !destinationLayers.has(feature.properties.layer)) return null;
  const properties = feature.properties;
  if (
    properties.hazardType ||
    properties.hazardSeverity ||
    properties.severity === "critical" ||
    properties.severity === "warning"
  )
    return null;
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: String(properties.headline ?? properties.label ?? "Vybrané místo") };
}
