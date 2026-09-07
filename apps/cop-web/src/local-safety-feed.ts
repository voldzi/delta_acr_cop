import React from "react";
import { fetchMapFeatures, type MapBounds, type SafetyFeatureCollectionResponse } from "./cop-data";

const refreshMs = 60_000;
const requestTimeoutMs = 15_000;
export const localSafetyRadiusKm = 30;

export type LocalSafetyState = "location-required" | "unavailable" | "loading" | "limited" | "current";

export function localSafetyBounds(location: { lat: number; lon: number } | null): MapBounds | null {
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lon) > 180
  )
    return null;
  // A small margin covers rounding while avoiding a new query for every GPS sample.
  const lat = Math.round(location.lat * 100) / 100;
  const lon = Math.round(location.lon * 100) / 100;
  const latitudeRadius = (localSafetyRadiusKm + 2) / 111;
  const longitudeRadius = latitudeRadius / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    north: Math.min(90, lat + latitudeRadius),
    south: Math.max(-90, lat - latitudeRadius),
    east: Math.min(180, lon + longitudeRadius),
    west: Math.max(-180, lon - longitudeRadius)
  };
}

export function safetyCollectionIsCurrent(
  collection: SafetyFeatureCollectionResponse | null,
  now: number,
  maxAgeMs: number
): boolean {
  if (
    !collection ||
    collection.cache?.status === "stale" ||
    collection.sourceHealth?.health !== "ONLINE" ||
    collection.warnings.length > 0 ||
    (collection.sourceHealth.warnings?.length ?? 0) > 0 ||
    collection.summary.staleFeatureCount > 0 ||
    collection.features.length >= collection.query.limit ||
    collection.sources.length === 0 ||
    collection.sources.some((source) => !source.enabled)
  )
    return false;
  const timestamp = Date.parse(collection.source.generatedAt ?? collection.generatedAt);
  return Number.isFinite(timestamp) && timestamp <= now + 60_000 && now - timestamp <= maxAgeMs;
}

export function localSafetyEmptyCopy(state: LocalSafetyState): {
  badge: string;
  title: string;
  tone: "neutral" | "warn";
} {
  switch (state) {
    case "location-required":
      return { badge: "Poloha neurčena", title: "Pro výstrahy v okolí určete svou polohu.", tone: "neutral" };
    case "loading":
      return { badge: "Ověřuji výstrahy", title: "Místní výstrahy se načítají.", tone: "neutral" };
    case "current":
      return {
        badge: "Bez nalezené výstrahy",
        title: "V dostupných zdrojích do 30 km od vaší polohy. Nejde o potvrzení bezpečí.",
        tone: "neutral"
      };
    default:
      return { badge: "Situace neověřena", title: "Aktuální výstrahy v okolí nelze spolehlivě ověřit.", tone: "warn" };
  }
}

/** Public alert monitoring is independent of map visibility and map movement. */
export function useLocalSafetyFeed(options: {
  apiBase: string;
  token?: string;
  enabled: boolean;
  online: boolean;
  visible: boolean;
  autoRefresh: boolean;
  layerIds: string[];
  location: { lat: number; lon: number } | null;
  staleAfterSeconds?: number;
}) {
  const { apiBase, token, enabled, online, visible, autoRefresh } = options;
  const boundsKey = JSON.stringify(localSafetyBounds(options.location));
  const layerKey = JSON.stringify([...options.layerIds].sort());
  const key = JSON.stringify([apiBase, token ?? null, boundsKey, layerKey]);
  const [snapshot, setSnapshot] = React.useState<{
    key: string;
    collection: SafetyFeatureCollectionResponse | null;
    failed: boolean;
    checkedAt: number;
  } | null>(null);
  const [now, setNow] = React.useState(Date.now);

  // Expiration must keep advancing while offline, without issuing requests.
  React.useEffect(() => {
    setNow(Date.now());
    if (!visible) return;
    const interval = window.setInterval(() => setNow(Date.now()), refreshMs);
    return () => window.clearInterval(interval);
  }, [visible]);

  React.useEffect(() => {
    setNow(Date.now());
    const bounds = JSON.parse(boundsKey) as MapBounds | null;
    const layerIds = JSON.parse(layerKey) as string[];
    if (!enabled || !online || !visible || !bounds || !layerIds.length) return;
    let disposed = false;
    let active: AbortController | null = null;
    const refresh = async () => {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchMapFeatures(apiBase, token, {
          bbox: bounds,
          layerIds,
          limit: 1000,
          signal: controller.signal
        });
        if (!disposed) {
          const checkedAt = Date.now();
          setNow(checkedAt);
          setSnapshot({
            key,
            collection: response.safety ?? null,
            checkedAt,
            failed: response.warnings.length > 0 || !response.safety
          });
        }
      } catch {
        if (!disposed)
          setSnapshot((previous) => ({
            key,
            collection: previous?.key === key ? previous.collection : null,
            checkedAt: previous?.key === key ? previous.checkedAt : 0,
            failed: true
          }));
      } finally {
        window.clearTimeout(timeout);
        active = null;
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      if (autoRefresh) void refresh();
    }, refreshMs);
    return () => {
      disposed = true;
      active?.abort();
      window.clearInterval(interval);
    };
  }, [apiBase, token, enabled, online, visible, autoRefresh, boundsKey, layerKey, key]);

  const current = snapshot?.key === key ? snapshot : null;
  const evaluatedAt = Math.max(now, Date.now());
  const maxAgeMs =
    (Number.isFinite(options.staleAfterSeconds) && options.staleAfterSeconds! > 0 ? options.staleAfterSeconds! : 300) *
    1000;
  const state: LocalSafetyState =
    boundsKey === "null"
      ? "location-required"
      : !enabled || !online || options.layerIds.length === 0
        ? "unavailable"
        : !current
          ? "loading"
          : current.failed ||
              evaluatedAt - current.checkedAt > maxAgeMs ||
              !safetyCollectionIsCurrent(current.collection, evaluatedAt, maxAgeMs)
            ? "limited"
            : "current";
  return { state, collection: current?.collection ?? null, checkedAt: current?.checkedAt || null, evaluatedAt: now };
}
