import type { CopStreamStatus, HealthStatus } from "./cop-data";
import { snapshotAgeSeconds, type CopOfflineSnapshot } from "./pwa-offline";

export type OperatingMode = "DEGRADED" | "OFFLINE" | "ONLINE";

export type OfflineSnapshotState =
  | { kind: "active"; objectCount: number; reason: string; restoredAt: string; savedAt: string; sourceCount: number }
  | { kind: "available"; objectCount: number; savedAt: string; sourceCount: number }
  | { kind: "none" };

export function resolveOperatingMode({
  browserOnline,
  health,
  loadError,
  offlineSnapshotState,
  streamStatus
}: {
  browserOnline: boolean;
  health: HealthStatus | null;
  loadError: string | null;
  offlineSnapshotState: OfflineSnapshotState;
  streamStatus: CopStreamStatus;
}): OperatingMode {
  if (!browserOnline || (offlineSnapshotState.kind === "active" && streamStatus === "offline")) {
    return "OFFLINE";
  }
  if (offlineSnapshotState.kind === "active" || loadError || health?.status !== "ok" || streamStatus !== "live") {
    return "DEGRADED";
  }
  return "ONLINE";
}

export function operatingModeTone(mode: OperatingMode): "ok" | "warn" | "neutral" {
  return mode === "ONLINE" ? "ok" : "warn";
}

export function operatingModeLabel(mode: OperatingMode): string {
  if (mode === "ONLINE") {
    return "online";
  }
  if (mode === "OFFLINE") {
    return "offline";
  }
  return "omezeno";
}

export function missionModeLabel(mode: OperatingMode, snapshotState: OfflineSnapshotState): string {
  if (snapshotState.kind === "active") {
    return mode === "OFFLINE" ? "offline náhled" : "omezený náhled";
  }
  if (mode === "ONLINE") {
    return "živě";
  }
  return operatingModeLabel(mode);
}

export function streamStatusLabel(status: CopStreamStatus): string {
  if (status === "live") {
    return "LIVE";
  }
  if (status === "offline") {
    return "OFFLINE";
  }
  return "DEGRADED";
}

export function streamStatusTone(status: CopStreamStatus): "ok" | "warn" | "neutral" {
  if (status === "live") {
    return "ok";
  }
  if (status === "connecting") {
    return "neutral";
  }
  return "warn";
}

export function formatSnapshotAge(snapshot: Pick<CopOfflineSnapshot, "savedAt">): string {
  const ageSeconds = snapshotAgeSeconds(snapshot);
  if (ageSeconds === null) {
    return "neznámé stáří";
  }
  if (ageSeconds < 60) {
    return `${ageSeconds} s starý`;
  }
  const ageMinutes = Math.round(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `${ageMinutes} min starý`;
  }
  const ageHours = Math.round(ageMinutes / 60);
  return `${ageHours} h starý`;
}

export function formatOfflineSnapshotState(state: OfflineSnapshotState): string {
  if (state.kind === "none") {
    return "není uložen";
  }
  const suffix = state.kind === "active" ? "aktivní" : "připraven";
  return `${suffix} · ${formatSnapshotAge(state)} · ${state.objectCount} obj.`;
}

export function offlineSnapshotTone(state: OfflineSnapshotState): "ok" | "warn" | "neutral" {
  if (state.kind === "active") {
    return "warn";
  }
  return state.kind === "available" ? "ok" : "neutral";
}
