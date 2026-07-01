import type { CopObject } from "./cop-data";

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
