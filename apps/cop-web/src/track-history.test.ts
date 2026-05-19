import { describe, expect, it } from "vitest";
import type { CopObject } from "./cop-data";
import { countHistoryPoints, mergeTrackHistory, predictPosition } from "./track-history";

describe("track history helpers", () => {
  it("merges positioned track snapshots and skips duplicate coordinates", () => {
    const object = {
      objectId: "AIR_SIM_AIRCRAFT-0001",
      objectType: "AIRCRAFT",
      affiliation: "FRIEND",
      domain: "AIR",
      status: "ACTIVE",
      position: { lat: 50, lon: 14 },
      lastUpdatedAt: "2026-05-19T08:00:00Z"
    } satisfies CopObject;

    const first = mergeTrackHistory({}, [object], "2026-05-19T08:00:01Z");
    const duplicate = mergeTrackHistory(first, [object], "2026-05-19T08:00:05Z");
    const moved = mergeTrackHistory(
      duplicate,
      [{ ...object, position: { lat: 50.01, lon: 14.02 }, lastUpdatedAt: "2026-05-19T08:01:00Z" }],
      "2026-05-19T08:01:00Z"
    );

    expect(countHistoryPoints(moved, [object])).toBe(2);
    expect(moved["AIR_SIM_AIRCRAFT-0001"]?.map((point) => [point.lon, point.lat])).toEqual([
      [14, 50],
      [14.02, 50.01]
    ]);
  });

  it("predicts position from movement vector", () => {
    const prediction = predictPosition(
      {
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        position: { lat: 50, lon: 14 },
        movement: { speedMps: 50, headingDeg: 90, verticalRateMps: 0 }
      },
      [],
      10
    );

    expect(prediction?.method).toBe("movement");
    expect(prediction?.lon).toBeGreaterThan(14);
    expect(prediction?.lat).toBeCloseTo(50, 1);
  });

  it("falls back to recent history vector when movement attributes are missing", () => {
    const prediction = predictPosition(
      {
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        position: { lat: 50.01, lon: 14.02 }
      },
      [
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.01, lon: 14.02, timestamp: "2026-05-19T08:10:00Z" }
      ],
      10
    );

    expect(prediction?.method).toBe("history");
    expect(prediction?.lat).toBeCloseTo(50.02, 5);
    expect(prediction?.lon).toBeCloseTo(14.04, 5);
  });
});
