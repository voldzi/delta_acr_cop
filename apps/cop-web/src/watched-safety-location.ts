export interface WatchedSafetyLocation {
  label: string;
  lat: number;
  lon: number;
  source: "place";
}

const storagePrefix = "cop.public-safety.location.v1";

export function readWatchedSafetyLocation(scope?: string): WatchedSafetyLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WatchedSafetyLocation>;
    if (
      value.source !== "place" ||
      typeof value.label !== "string" ||
      !value.label.trim() ||
      typeof value.lat !== "number" ||
      typeof value.lon !== "number" ||
      !Number.isFinite(value.lat) ||
      !Number.isFinite(value.lon) ||
      Math.abs(value.lat) > 90 ||
      Math.abs(value.lon) > 180
    )
      return null;
    return { label: value.label.trim().slice(0, 160), lat: value.lat, lon: value.lon, source: "place" };
  } catch {
    return null;
  }
}

export function writeWatchedSafetyLocation(location: WatchedSafetyLocation | null, scope?: string): void {
  if (typeof window === "undefined") return;
  const key = storageKey(scope);
  if (!location) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(location));
}

function storageKey(scope?: string): string {
  const normalized = scope
    ?.trim()
    .replace(/[^a-z0-9_.:@-]/giu, "_")
    .slice(0, 160);
  return normalized ? `${storagePrefix}.${normalized}` : storagePrefix;
}
