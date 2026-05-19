import { describe, expect, it } from "vitest";
import { clamp, normalizeMapView } from "./user-preferences";

describe("user preferences helpers", () => {
  it("normalizes persisted map view", () => {
    expect(normalizeMapView({ center: [14.4, 50.1], zoom: 9 })).toEqual({
      center: [14.4, 50.1],
      zoom: 9,
      bearing: undefined,
      pitch: undefined
    });
  });

  it("rejects invalid map view", () => {
    expect(normalizeMapView({ center: ["bad", 50.1], zoom: 9 })).toBeUndefined();
  });

  it("clamps numeric settings", () => {
    expect(clamp(120, 1, 50)).toBe(50);
    expect(clamp(-1, 1, 50)).toBe(1);
  });
});
