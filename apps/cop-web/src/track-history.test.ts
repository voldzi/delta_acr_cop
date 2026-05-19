import { describe, expect, it } from "vitest";
import type { CopObject } from "./cop-data";
import {
  countHistoryPoints,
  getReplayTimestamp,
  getReplayWindow,
  mergeTrackHistory,
  predictPosition,
  selectReplayObjects,
  trimHistoryToTimestamp,
  trimTrackHistory
} from "./track-history";

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

    expect(prediction?.method).toBe("telemetry");
    expect(prediction?.path).toHaveLength(7);
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

  it("limits retained history to the configured number of points", () => {
    const history = trimTrackHistory(
      {
        "AIR_SIM_UAV-0001": [
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.01, lon: 14.01, timestamp: "2026-05-19T08:01:00Z" },
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.02, lon: 14.02, timestamp: "2026-05-19T08:02:00Z" }
        ]
      },
      2
    );

    expect(history["AIR_SIM_UAV-0001"]?.map((point) => point.timestamp)).toEqual([
      "2026-05-19T08:01:00Z",
      "2026-05-19T08:02:00Z"
    ]);
  });

  it("limits retained history to the configured age in seconds", () => {
    const history = trimTrackHistory(
      {
        "AIR_SIM_UAV-0001": [
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.01, lon: 14.01, timestamp: "2026-05-19T08:01:30Z" },
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.02, lon: 14.02, timestamp: "2026-05-19T08:02:00Z" }
        ]
      },
      10,
      60,
      "2026-05-19T08:02:15Z"
    );

    expect(history["AIR_SIM_UAV-0001"]?.map((point) => point.timestamp)).toEqual([
      "2026-05-19T08:01:30Z",
      "2026-05-19T08:02:00Z"
    ]);
  });

  it("trims stationary duplicate tracks by age without adding duplicate points", () => {
    const object = {
      objectId: "AIR_SIM_UAV-0001",
      objectType: "UAV",
      affiliation: "HOSTILE",
      domain: "AIR",
      status: "ACTIVE",
      position: { lat: 50, lon: 14 },
      lastUpdatedAt: "2026-05-19T08:00:00Z"
    } satisfies CopObject;
    const history = mergeTrackHistory(
      {
        "AIR_SIM_UAV-0001": [
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" }
        ]
      },
      [object],
      "2026-05-19T08:02:00Z",
      10,
      60
    );

    expect(history["AIR_SIM_UAV-0001"]).toEqual([]);
  });

  it("can predict a curved maneuver from recent track turns", () => {
    const prediction = predictPosition(
      {
        objectId: "AIR_SIM_UAV-0002",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        position: { lat: 50.02, lon: 14.02 }
      },
      [
        { objectId: "AIR_SIM_UAV-0002", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
        { objectId: "AIR_SIM_UAV-0002", affiliation: "HOSTILE", lat: 50.01, lon: 14.02, timestamp: "2026-05-19T08:01:00Z" },
        { objectId: "AIR_SIM_UAV-0002", affiliation: "HOSTILE", lat: 50.02, lon: 14.02, timestamp: "2026-05-19T08:02:00Z" }
      ],
      3,
      "maneuver"
    );

    expect(prediction?.method).toBe("maneuver");
    expect(prediction?.path).toHaveLength(7);
    expect(prediction?.path[3]?.lat).toBeGreaterThan(50.02);
    expect(prediction?.lon).toBeLessThan(14.02);
  });

  it("derives a replay window and timestamp from retained history", () => {
    const history = {
      "AIR_SIM_UAV-0001": [
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.1, lon: 14.1, timestamp: "2026-05-19T08:02:00Z" }
      ],
      "AIR_SIM_AIRCRAFT-0002": [
        { objectId: "AIR_SIM_AIRCRAFT-0002", affiliation: "FRIEND", lat: 49.9, lon: 13.9, timestamp: "2026-05-19T08:01:00Z" }
      ]
    };

    expect(getReplayWindow(history)).toEqual({
      durationSeconds: 120,
      end: "2026-05-19T08:02:00.000Z",
      start: "2026-05-19T08:00:00.000Z"
    });
    expect(getReplayTimestamp(history, 50)).toBe("2026-05-19T08:01:00.000Z");
  });

  it("selects replay object positions at or before the chosen timestamp", () => {
    const objects = [
      {
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        confidence: 0.8,
        position: { lat: 50.2, lon: 14.2 }
      },
      {
        objectId: "AIR_SIM_UAV-0002",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        position: { lat: 51, lon: 15 }
      }
    ] satisfies CopObject[];
    const history = {
      "AIR_SIM_UAV-0001": [
        {
          objectId: "AIR_SIM_UAV-0001",
          affiliation: "HOSTILE",
          confidence: 0.55,
          lat: 50,
          lon: 14,
          status: "STALE",
          timestamp: "2026-05-19T08:00:00Z"
        },
        {
          objectId: "AIR_SIM_UAV-0001",
          affiliation: "HOSTILE",
          confidence: 0.9,
          lat: 50.2,
          lon: 14.2,
          timestamp: "2026-05-19T08:02:00Z"
        }
      ],
      "AIR_SIM_UAV-0002": [
        { objectId: "AIR_SIM_UAV-0002", affiliation: "HOSTILE", lat: 51, lon: 15, timestamp: "2026-05-19T08:02:00Z" }
      ]
    };

    const replayObjects = selectReplayObjects(objects, history, "2026-05-19T08:01:00Z");

    expect(replayObjects).toHaveLength(1);
    expect(replayObjects[0]).toMatchObject({
      confidence: 0.55,
      lastUpdatedAt: "2026-05-19T08:00:00Z",
      objectId: "AIR_SIM_UAV-0001",
      position: { lat: 50, lon: 14 },
      status: "STALE"
    });
  });

  it("trims replay history to the chosen timestamp", () => {
    const trimmed = trimHistoryToTimestamp(
      {
        "AIR_SIM_UAV-0001": [
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:00:00Z" },
          { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50.1, lon: 14.1, timestamp: "2026-05-19T08:02:00Z" }
        ]
      },
      "2026-05-19T08:01:00Z"
    );

    expect(trimmed["AIR_SIM_UAV-0001"]?.map((point) => point.timestamp)).toEqual(["2026-05-19T08:00:00Z"]);
  });
});
