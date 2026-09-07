import { describe, expect, it, vi } from "vitest";
import {
  formatOfflineSnapshotState,
  formatSnapshotAge,
  missionModeLabel,
  resolveOperatingMode
} from "./operating-mode";

describe("operating mode", () => {
  it("keeps live mode only when the browser, health and stream are ready", () => {
    expect(
      resolveOperatingMode({
        browserOnline: true,
        health: { status: "ok", timestamp: "2026-07-21T12:00:00.000Z" },
        loadError: null,
        offlineSnapshotState: { kind: "none" },
        streamStatus: "live"
      })
    ).toBe("ONLINE");
  });

  it("uses the offline state when the browser is disconnected", () => {
    expect(
      resolveOperatingMode({
        browserOnline: false,
        health: null,
        loadError: "Network error",
        offlineSnapshotState: {
          kind: "active",
          objectCount: 12,
          reason: "offline",
          restoredAt: "2026-07-21T08:00:00.000Z",
          savedAt: "2026-07-21T07:59:00.000Z",
          sourceCount: 3
        },
        streamStatus: "offline"
      })
    ).toBe("OFFLINE");
  });

  it("describes an active snapshot without exposing a transport error", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:10:00.000Z"));
    const state = {
      kind: "active" as const,
      objectCount: 18,
      reason: "HTTP 502",
      restoredAt: "2026-07-21T08:10:00.000Z",
      savedAt: "2026-07-21T08:00:00.000Z",
      sourceCount: 4
    };

    expect(formatSnapshotAge(state)).toBe("10 min starý");
    expect(formatOfflineSnapshotState(state)).toBe("aktivní · 10 min starý · 18 obj.");
    expect(missionModeLabel("DEGRADED", state)).toBe("omezený náhled");
    vi.useRealTimers();
  });
});
