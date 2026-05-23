import { describe, expect, it } from "vitest";
import { buildXrObjectModels, summarizeXrObjects } from "./xr-model";
import type { CopObject, ServerTrackHistoryPoint, SourceSystem } from "./cop-data";

describe("XR workspace model", () => {
  it("projects positioned COP objects into bounded 3D XR coordinates", () => {
    const objects: CopObject[] = [
      {
        affiliation: "FRIEND",
        attributes: { provenance: { sourceSystemId: "sim-air-situation-001" } },
        confidence: 0.9,
        domain: "AIR",
        objectId: "AIR_SIM_AIRCRAFT-0001",
        objectType: "AIRCRAFT",
        position: { altitudeM: 3200, lat: 50.08, lon: 14.42 },
        status: "ACTIVE",
        synthetic: true
      },
      {
        affiliation: "NEUTRAL",
        attributes: {
          flightData: {
            callsign: "CSA123",
            icao24: "49abcd"
          }
        },
        confidence: 0.8,
        domain: "AIR",
        objectId: "flight:icao24:49abcd",
        objectType: "AIRCRAFT",
        position: { altitudeM: 9000, lat: 50.18, lon: 14.62 },
        status: "ACTIVE"
      }
    ];
    const history: Record<string, ServerTrackHistoryPoint[]> = {
      "AIR_SIM_AIRCRAFT-0001": [
        {
          affiliation: "FRIEND",
          lat: 50.07,
          lon: 14.41,
          objectId: "AIR_SIM_AIRCRAFT-0001",
          timestamp: "2026-05-23T08:00:00Z"
        }
      ]
    };

    const models = buildXrObjectModels(objects, history);

    expect(models).toHaveLength(2);
    expect(models[0]?.isSimulated).toBe(true);
    expect(models[1]?.isPublicFlight).toBe(true);
    expect(models[1]?.label).toBe("CSA123");
    expect(Math.abs(models[0]?.position.x ?? 99)).toBeLessThanOrEqual(8);
    expect(Math.abs(models[0]?.position.z ?? 99)).toBeLessThanOrEqual(4.5);
    expect(models[0]?.history).toHaveLength(1);
  });

  it("summarizes visible XR objects and active sources", () => {
    const sources: SourceSystem[] = [
      { displayName: "SIM", sourceSystemId: "sim", sourceType: "SIMULATOR", status: "ACTIVE", synthetic: true },
      { displayName: "Offline", sourceSystemId: "offline", sourceType: "TEST", status: "STALE", synthetic: false }
    ];
    const models = buildXrObjectModels([
      {
        affiliation: "FRIEND",
        confidence: 0.9,
        domain: "AIR",
        objectId: "SIM-1",
        objectType: "UAV",
        position: { lat: 50, lon: 14 },
        status: "ACTIVE",
        synthetic: true
      }
    ]);

    expect(summarizeXrObjects(models, sources)).toEqual({
      activeSources: 1,
      publicFlights: 0,
      simulated: 1,
      visibleObjects: 1
    });
  });
});
