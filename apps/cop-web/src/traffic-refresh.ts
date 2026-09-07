export interface TrafficRefreshCadenceInput {
  catalogRefreshSeconds?: number;
  featureRefreshSeconds: number[];
  layerId: string;
}

/**
 * Resolves the refresh cadence published by SIM for a selected traffic layer.
 * Per-feature metadata is the most specific contract; the catalog value is the
 * fallback used before the first feature response arrives.
 */
export function resolveTrafficRefreshSeconds({
  catalogRefreshSeconds,
  featureRefreshSeconds,
  layerId
}: TrafficRefreshCadenceInput): number | undefined {
  const validFeatureCadences = featureRefreshSeconds.filter(isPositiveFiniteNumber);
  const publishedCadence =
    validFeatureCadences.length > 0
      ? Math.min(...validFeatureCadences)
      : isPositiveFiniteNumber(catalogRefreshSeconds)
        ? catalogRefreshSeconds
        : undefined;
  if (publishedCadence === undefined) {
    return undefined;
  }
  if (layerId === "public.traffic.transit_stops") {
    return Math.max(300, Math.min(publishedCadence, 21_600));
  }
  if (layerId === "public.traffic.transit.trains") {
    return Math.max(60, Math.min(publishedCadence, 3_600));
  }
  return Math.max(5, Math.min(publishedCadence, 120));
}

function isPositiveFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
