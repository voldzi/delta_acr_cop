import type { CopObject, FlightDataAttributes } from "./cop-data";

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

  return formatTrackIdentity(flightData, object.objectId) ?? object.objectId;
}

export function formatTrackIdentity(flightData: FlightDataAttributes | undefined, objectId?: string): string | null {
  const trackKeyKind = normalizeTrackKeyKind(flightData?.trackKeyKind);
  const trackKey = cleanTrackLabel(flightData?.trackKey);
  const trackId = cleanTrackLabel(flightData?.trackId) ?? cleanTrackLabel(objectId);
  const icao24 = cleanTrackLabel(flightData?.icao24);

  if (trackKeyKind === "icao24") {
    return (icao24 ?? trackKey ?? compactTrackIdentifier(trackId))?.toUpperCase() ?? null;
  }
  if (trackKey) {
    return trackKey;
  }
  if (icao24) {
    return icao24.toUpperCase();
  }
  return compactTrackIdentifier(trackId);
}

export function formatTrackKeyKindLabel(value: unknown): string | null {
  const normalized = normalizeTrackKeyKind(value);
  switch (normalized) {
    case "icao24":
      return "ICAO24";
    case "remote_id":
      return "Remote ID";
    case "radar_track":
      return "Radarová stopa";
    case "partner_track":
      return "Partnerská stopa";
    default:
      return normalized ? normalized.replace(/_/g, " ") : null;
  }
}

export function collectTrackIdentityTokens(object: CopObject): string[] {
  const flightData = object.attributes?.flightData;
  return [
    object.objectId,
    flightData?.trackId,
    flightData?.trackKey,
    flightData?.trackKeyKind,
    flightData?.icao24,
    flightData?.registration,
    flightData?.callsign
  ].flatMap((value) => {
    const cleaned = cleanTrackLabel(value);
    return cleaned ? [cleaned] : [];
  });
}

export function compactTrackIdentifier(value: string | null | undefined): string | null {
  const cleaned = cleanTrackLabel(value);
  if (!cleaned) {
    return null;
  }
  const parts = cleaned
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? cleaned;
}

function normalizeTrackKeyKind(value: unknown): string | null {
  const cleaned = cleanTrackLabel(value);
  return cleaned ? cleaned.toLowerCase().replace(/[\s-]+/g, "_") : null;
}

export function cleanTrackLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}
