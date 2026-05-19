import { describe, expect, it } from "vitest";
import type { CopObject, SourceHealthItem } from "./cop-data";
import { buildObjectDetailModel } from "./object-detail";
import type { TrackHistoryPoint } from "./track-history";

describe("object detail model", () => {
  it("explains confidence, provenance and APP-6 lineage", () => {
    const object = buildObject({ confidence: 0.44 });
    const sourceHealth = [buildSourceHealth({ health: "ONLINE" })];

    const model = buildObjectDetailModel({ historyPoints: [], object, sourceHealth });

    expect(model.sidc).toBe("SFAPMFQ--------");
    expect(model.lineage.map((step) => step.label)).toContain("APP-6 rendering");
    expect(model.confidenceFactors.some((factor) => factor.label === "Score" && factor.tone === "warn")).toBe(true);
    expect(model.confidenceFactors.some((factor) => factor.detail.includes("Synthetic/SIM"))).toBe(true);
  });

  it("flags source position variance from recent multi-source history", () => {
    const object = buildObject({ confidence: 0.82 });
    const historyPoints: TrackHistoryPoint[] = [
      buildHistoryPoint({ lat: 50.0, lon: 14.0, sourceSystemId: "source-a", timestamp: "2026-05-19T08:00:00Z" }),
      buildHistoryPoint({ lat: 50.05, lon: 14.08, sourceSystemId: "source-b", timestamp: "2026-05-19T08:00:01Z" })
    ];

    const model = buildObjectDetailModel({
      historyPoints,
      object,
      sourceHealth: [buildSourceHealth({ health: "ONLINE" })]
    });

    expect(model.conflicts.some((conflict) => conflict.title === "Position variance")).toBe(true);
  });

  it("marks degraded source health as a data conflict", () => {
    const object = buildObject({ confidence: 0.91 });

    const model = buildObjectDetailModel({
      historyPoints: [],
      object,
      sourceHealth: [buildSourceHealth({ health: "STALE" })]
    });

    expect(model.conflicts.some((conflict) => conflict.title === "Source degraded")).toBe(true);
  });

  it("prefers server conflict evidence when it is present on the object", () => {
    const object = buildObject({
      attributes: {
        conflictEvidence: {
          evaluatedAt: "2026-05-19T08:00:10Z",
          objectId: "AIR_SIM_UAV-0001",
          severity: "warning",
          signals: [
            {
              detail: "Recent history contains multiple affiliations: FRIEND, HOSTILE.",
              observedAt: "2026-05-19T08:00:10Z",
              severity: "warning",
              sourceSystemIds: ["sim-air"],
              title: "Affiliation variance",
              type: "AFFILIATION_VARIANCE"
            }
          ],
          sourceSystemIds: ["sim-air"],
          state: "CONFLICTED"
        }
      }
    });

    const model = buildObjectDetailModel({
      historyPoints: [],
      object,
      sourceHealth: [buildSourceHealth({ health: "ONLINE" })]
    });

    expect(model.conflicts).toEqual([
      {
        detail: "Recent history contains multiple affiliations: FRIEND, HOSTILE. Sources: sim-air.",
        severity: "warn",
        title: "Affiliation variance"
      }
    ]);
  });
});

function buildObject(overrides: Partial<CopObject>): CopObject {
  return {
    affiliation: "FRIEND",
    attributes: {
      provenance: {
        adapterId: "sim-adapter",
        adapterVersion: "0.1.0",
        eventId: "evt-1",
        informationCredibility: "2",
        ingestTimestamp: "2026-05-19T08:00:02Z",
        latencyMs: 2000,
        producerTimestamp: "2026-05-19T08:00:00Z",
        sourceReliability: "B",
        sourceSystemId: "sim-air",
        synthetic: true
      }
    },
    confidence: 0.9,
    domain: "AIR",
    lastUpdatedAt: "2026-05-19T08:00:02Z",
    objectId: "AIR_SIM_UAV-0001",
    objectType: "UAV",
    position: {
      lat: 50,
      lon: 14
    },
    status: "ACTIVE",
    synthetic: true,
    ...overrides
  };
}

function buildHistoryPoint(overrides: Partial<TrackHistoryPoint>): TrackHistoryPoint {
  return {
    affiliation: "FRIEND",
    confidence: 0.8,
    eventId: "evt-history",
    lat: 50,
    lon: 14,
    objectId: "AIR_SIM_UAV-0001",
    sourceSystemId: "sim-air",
    status: "ACTIVE",
    synthetic: true,
    timestamp: "2026-05-19T08:00:00Z",
    ...overrides
  };
}

function buildSourceHealth(overrides: Partial<SourceHealthItem>): SourceHealthItem {
  return {
    acceptedEvents: 4,
    currentTracks: 1,
    displayName: "SIM Air",
    expiredTracks: 0,
    health: "ONLINE",
    lowConfidenceTracks: 0,
    sourceSystemId: "sim-air",
    sourceType: "SIMULATOR",
    staleTracks: 0,
    synthetic: true,
    totalTracks: 1,
    ...overrides
  };
}
