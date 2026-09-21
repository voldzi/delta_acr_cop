import { describe, expect, it, vi } from "vitest";
import { groupRoadObservations, normalizeRoadMatch, roadMatchRequest, RoadEnrichmentRunner, type RoadEnrichmentJob } from "./road-enrichment.js";
import type { RoutingSource } from "./routing-source.js";

const now = new Date("2026-09-21T10:00:00Z");
const job: RoadEnrichmentJob = { reportId: "test", version: 2, lease: "lease", attempts: 1,
  lat: 50, lon: 14, accuracyM: 5, observedAt: now.toISOString(), properties: {
    validUntil: "2026-09-21T11:00:00Z", roadContext: { travelDirectionDeg: 90, speedMps: 10 }
  } };
const response = { roadMatch: { contractVersion: "sim-road-match-v1", state: "matched",
  matchedAt: now.toISOString(),
  routingDataset: "sim-routing-2026-test", candidate: { directedEdgeId: "123", distanceM: 3 } } };

describe("community road enrichment", () => {
  it("groups only matching authorized observations, retaining the freshest representative", () => {
    const evidence = { ...normalizeRoadMatch(response, now), clusterId: "cluster" };
    const reports = [{ reportId: "old", observedAt: "2026-09-21T09:59:00Z", roadEnrichment: evidence },
      { reportId: "new", observedAt: now.toISOString(), roadEnrichment: evidence },
      { reportId: "uncertain", observedAt: now.toISOString() }];
    expect(groupRoadObservations(reports, () => true).map(group => [group.report.reportId, group.count])).toEqual([["new", 2], ["uncertain", 1]]);
    expect(groupRoadObservations(reports, report => report.reportId !== "old")).toHaveLength(3);
  });
  it("sends one point without report identity, text or ride history", () => {
    expect(roadMatchRequest(job, now)).toEqual({ profileId: "car", point: { lat: 50, lon: 14 }, radiusM: 50, includeRoadMatch: true, headingDeg: 90 });
    expect(roadMatchRequest({ ...job, accuracyM: 100 }, now)).not.toHaveProperty("headingDeg");
    expect(roadMatchRequest({ ...job, properties: { ...job.properties, validUntil: now.toISOString() } }, now)).toBeNull();
  });
  it("keeps ambiguity explicit and requires versioned directed-edge provenance", () => {
    expect(normalizeRoadMatch(response, now)).toMatchObject({ state: "matched", directedEdgeId: "123", routingDataset: "sim-routing-2026-test" });
    expect(normalizeRoadMatch({ roadMatch: { contractVersion: "sim-road-match-v1", state: "ambiguous", matchedAt: now.toISOString() } }, now)).not.toHaveProperty("directedEdgeId");
    expect(() => normalizeRoadMatch({ accessPoint: { osmId: 123 } }, now)).toThrow();
    expect(() => normalizeRoadMatch({ roadMatch: { ...response.roadMatch, routingDataset: undefined } }, now)).toThrow();
    expect(() => normalizeRoadMatch(response, new Date(now.getTime() + 600_001))).toThrow("ROAD_MATCH_STALE");
  });
  it("retries failures durably, completes success and prevents overlapping ticks", async () => {
    const queue = { claim: vi.fn().mockResolvedValue([job]), complete: vi.fn(), retry: vi.fn() };
    const nearestAccess = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(response);
    const runner = new RoadEnrichmentRunner(queue, { nearestAccess } as unknown as RoutingSource);
    await runner.tick(now);
    expect(queue.retry).toHaveBeenCalledWith(job, now);
    expect(queue.complete).not.toHaveBeenCalled();
    await Promise.all([runner.tick(now), runner.tick(now)]);
    expect(queue.claim).toHaveBeenCalledTimes(2);
    expect(queue.complete).toHaveBeenCalledWith(job, expect.objectContaining({ state: "matched" }));
    await runner.close();
    await runner.tick(now);
    expect(queue.claim).toHaveBeenCalledTimes(2);
  });
  it("does not send expired observations to SIM", async () => {
    const expired = { ...job, properties: { validUntil: now.toISOString() } };
    const queue = { claim: vi.fn().mockResolvedValue([expired]), complete: vi.fn(), retry: vi.fn() };
    const nearestAccess = vi.fn();
    await new RoadEnrichmentRunner(queue, { nearestAccess } as unknown as RoutingSource).tick(now);
    expect(nearestAccess).not.toHaveBeenCalled();
    expect(queue.complete).toHaveBeenCalledWith(expired, expect.objectContaining({ state: "expired" }));
  });
});
