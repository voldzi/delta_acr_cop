import { describe, expect, it } from "vitest";
import type { CopObject } from "./cop-data";
import {
  assessGlobeCapability,
  decodeGlobeShareState,
  encodeGlobeShareState,
  projectedGlobePosition
} from "./globe-state";

const movingObject: CopObject = {
  affiliation: "NEUTRAL",
  domain: "LAND",
  lastUpdatedAt: "2026-09-07T12:00:00.000Z",
  movement: { headingDeg: 90, speedMps: 10 },
  objectId: "vehicle-1",
  objectType: "vehicle",
  position: { lat: 50, lon: 15 },
  status: "ACTIVE"
};

describe("globe state", () => {
  it("marks a bounded dead-reckoned position as an estimate", () => {
    const projected = projectedGlobePosition(movingObject, Date.parse("2026-09-07T12:00:10.000Z"));
    expect(projected?.state).toBe("estimated");
    expect(projected?.lon).toBeGreaterThan(15);
    expect(projected?.lat).toBeCloseTo(50, 3);
  });

  it("rejects incomplete or unbounded shared camera state", () => {
    expect(decodeGlobeShareState("#v=1&lon=15&lat=50")).toBeNull();
    expect(decodeGlobeShareState("#v=1&lon=500&lat=50&h=1000&hd=0&p=-1&r=0")).toBeNull();
  });

  it("stops extrapolating stale positions", () => {
    const projected = projectedGlobePosition(movingObject, Date.parse("2026-09-07T12:00:25.000Z"));
    expect(projected).toMatchObject({ lat: 50, lon: 15, state: "stale" });
  });

  it("round-trips a validated versioned share state", () => {
    const state = {
      camera: { heading: 0.2, height: 150_000, lat: 49.8, lon: 15.4, pitch: -1.1, roll: 0 },
      history: true,
      predictions: false,
      selectedObjectId: "object-1",
      version: 1 as const
    };
    expect(decodeGlobeShareState(`#${encodeGlobeShareState(state)}`)).toEqual(state);
    expect(decodeGlobeShareState("#v=1&lat=999&lon=15&h=10&hd=0&p=0&r=0")).toBeNull();
  });

  it("selects a limited mode for constrained devices", () => {
    expect(assessGlobeCapability({ deviceMemory: 2, hardwareConcurrency: 2, webgl2: true }).mode).toBe("limited");
    expect(assessGlobeCapability({ webgl2: false }).mode).toBe("unsupported");
  });
});
