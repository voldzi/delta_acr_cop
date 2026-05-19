import type { CopObject } from "./cop-data";
import { getAffiliationPresentation } from "./symbology";
import { predictPosition, type TrackHistory } from "./track-history";

export interface UserLocation {
  accuracyM?: number | null;
  lat: number;
  lon: number;
  updatedAt: string;
}

export interface ProximityAlert {
  currentDistanceKm: number;
  object: CopObject;
  predictedDistanceKm?: number;
  type: "inside-radius" | "approaching";
}

export function buildProximityAlerts(
  objects: CopObject[],
  userLocation: UserLocation | null,
  trackHistory: TrackHistory,
  radiusKm: number,
  predictionMinutes: number
): ProximityAlert[] {
  if (!userLocation) {
    return [];
  }

  return objects
    .flatMap((object) => buildObjectAlert(object, userLocation, trackHistory, radiusKm, predictionMinutes))
    .sort((a, b) => a.currentDistanceKm - b.currentDistanceKm);
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const earthRadiusKm = 6371.0088;
  const dLat = degreesToRadians(b.lat - a.lat);
  const dLon = degreesToRadians(b.lon - a.lon);
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function buildObjectAlert(
  object: CopObject,
  userLocation: UserLocation,
  trackHistory: TrackHistory,
  radiusKm: number,
  predictionMinutes: number
): ProximityAlert[] {
  if (!hasPosition(object) || getAffiliationPresentation(object.affiliation).disposition !== "hostile") {
    return [];
  }

  const currentDistanceKm = distanceKm(userLocation, object.position);
  if (currentDistanceKm <= radiusKm) {
    return [{ currentDistanceKm, object, type: "inside-radius" }];
  }

  const prediction = predictPosition(object, trackHistory[object.objectId], predictionMinutes);
  if (!prediction) {
    return [];
  }

  const predictedDistanceKm = distanceKm(userLocation, prediction);
  if (predictedDistanceKm <= radiusKm && predictedDistanceKm < currentDistanceKm) {
    return [{ currentDistanceKm, object, predictedDistanceKm, type: "approaching" }];
  }

  return [];
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function hasPosition(object: CopObject): object is CopObject & { position: NonNullable<CopObject["position"]> } {
  return Number.isFinite(object.position?.lat) && Number.isFinite(object.position?.lon);
}
