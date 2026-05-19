import type { ObservedObject } from "@cop/canonical-model";

export interface TrackLifecycleConfig {
  staleAfterMs: number;
  expireAfterMs: number;
}

export interface TrackLifecycleState {
  ageMs: number | null;
  expired: boolean;
  object: ObservedObject;
  stale: boolean;
}

const defaultStaleAfterMs = 30_000;
const defaultExpireAfterMs = 120_000;

const sourceOwnedTerminalStatuses = new Set(["INACTIVE", "LOST", "CONFLICTED"]);

export function createTrackLifecycleConfig(env: Record<string, string | undefined> = process.env): TrackLifecycleConfig {
  const staleAfterMs = readPositiveInteger(env.COP_TRACK_STALE_AFTER_MS, defaultStaleAfterMs);
  const configuredExpireAfterMs = readPositiveInteger(env.COP_TRACK_EXPIRE_AFTER_MS, defaultExpireAfterMs);
  const expireAfterMs = Math.max(configuredExpireAfterMs, staleAfterMs + 1_000);
  return { staleAfterMs, expireAfterMs };
}

export function resolveTrackLifecycle(
  object: ObservedObject,
  now: Date,
  config: TrackLifecycleConfig
): TrackLifecycleState {
  const updatedAt = object.lastUpdatedAt ? Date.parse(object.lastUpdatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAt)) {
    return {
      ageMs: null,
      expired: false,
      object,
      stale: false
    };
  }

  const ageMs = Math.max(0, now.getTime() - updatedAt);
  const expired = ageMs >= config.expireAfterMs;
  const stale = ageMs >= config.staleAfterMs;
  if (!stale || sourceOwnedTerminalStatuses.has(object.status)) {
    return { ageMs, expired, object, stale };
  }

  return {
    ageMs,
    expired,
    object: {
      ...object,
      status: "STALE"
    },
    stale
  };
}

export function selectCurrentTracks(
  objects: Iterable<ObservedObject>,
  now: Date,
  config: TrackLifecycleConfig,
  includeExpired = false
): ObservedObject[] {
  return Array.from(objects)
    .map((object) => resolveTrackLifecycle(object, now, config))
    .filter((track) => includeExpired || !track.expired)
    .map((track) => track.object);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
