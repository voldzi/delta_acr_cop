import { describe, expect, it } from "vitest";
import type { CopObject } from "./cop-data";
import { buildProximityAlerts, distanceKm, type UserLocation } from "./proximity-alerts";

describe("proximity alerts", () => {
  const userLocation: UserLocation = {
    lat: 50,
    lon: 14,
    updatedAt: "2026-05-19T08:00:00Z"
  };

  it("calculates geodesic distance", () => {
    expect(distanceKm(userLocation, { lat: 50, lon: 14.01 })).toBeCloseTo(0.715, 2);
  });

  it("alerts for hostile tracks inside user radius", () => {
    const alerts = buildProximityAlerts(
      [
        {
          objectId: "HOSTILE-1",
          objectType: "AIRCRAFT",
          affiliation: "HOSTILE",
          domain: "AIR",
          status: "ACTIVE",
          position: { lat: 50, lon: 14.02 }
        }
      ] satisfies CopObject[],
      userLocation,
      {},
      2,
      10
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      object: { objectId: "HOSTILE-1" },
      type: "inside-radius"
    });
  });

  it("alerts for hostile tracks predicted to enter the radius", () => {
    const alerts = buildProximityAlerts(
      [
        {
          objectId: "HOSTILE-2",
          objectType: "AIRCRAFT",
          affiliation: "SUSPECT",
          domain: "AIR",
          status: "ACTIVE",
          position: { lat: 50, lon: 14.18 },
          movement: { speedMps: 10, headingDeg: 270 }
        }
      ] satisfies CopObject[],
      userLocation,
      {},
      8,
      10
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe("approaching");
    expect(alerts[0]?.predictedDistanceKm).toBeLessThan(alerts[0]!.currentDistanceKm);
  });

  it("ignores friendly tracks", () => {
    const alerts = buildProximityAlerts(
      [
        {
          objectId: "FRIEND-1",
          objectType: "AIRCRAFT",
          affiliation: "FRIEND",
          domain: "AIR",
          status: "ACTIVE",
          position: { lat: 50, lon: 14.001 }
        }
      ] satisfies CopObject[],
      userLocation,
      {},
      5,
      10
    );

    expect(alerts).toEqual([]);
  });
});
