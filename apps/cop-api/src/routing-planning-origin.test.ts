import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routingHash as hash } from "./routing-trip.js";
import { PlanningOriginTransport } from "./routing-planning-transport.js";
import { planningBinding, planningCandidateId, planningOffset, planningOrdinaryQuery, PlanningOriginSource,
  validatePlanningRequest, verifyPlanningCandidates, verifyPlanningPreview, createPlanningOriginSourceFromEnv,
  type PlanningContext, type PlanningCandidate, type PlanningCandidatesResponse, type PlanningPreviewRequest, type PlanningPreviewResponse } from "./routing-planning-origin.js";

const baseline = JSON.parse(readFileSync(new URL("../../../docs/api/examples/mapped-road-profiles-v1.sim-fixture.json", import.meta.url), "utf8")).cases[0];
const actor = "a".repeat(64), cid = "11111111-2222-4333-8444-555555555555";
function fixture() {
  const original = structuredClone(baseline), now = new Date(original.response.generatedAt);
  const route = original.response.routes[0], dataset = route.knownClosures.routingDataset;
  const context: PlanningContext = { version: "sim-planning-origin-v1", purpose: "planning_preview", contextId: cid,
    originContext: { kind: "phone_measured", coordinate: { ...original.request.from, lat: original.request.from.lat + 0.0005 },
      horizontalAccuracyM: 300, observedAt: new Date(now.getTime() - 5000).toISOString(), accuracyAuthorization: "reduced" },
    destination: original.request.to, vehicleProfile: original.request.vehicleProfile };
  const candidate: PlanningCandidate = { candidateId: "", coordinate: original.request.from,
    offsetDistanceM: planningOffset(context.originContext.coordinate, original.request.from), profileValidation: "not_checked",
    legalAccess: "not_verified", directionValidation: "graph_candidate_only", directionsTruncated: false,
    directions: [{ directionId: `direction:${"c".repeat(64)}`, headingDeg: 45, validation: "graph_candidate_only" }] };
  candidate.candidateId = planningCandidateId(context, dataset, candidate);
  const candidates: PlanningCandidatesResponse = { version: "sim-planning-origin-candidates-v1", purpose: "planning_preview",
    state: "choices_available", binding: planningBinding(context, dataset, actor), observedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 120_000).toISOString(), candidates: [candidate], navigationEligible: false, measurementEligible: false };
  const request: PlanningPreviewRequest = { context, expectedDataset: dataset, discoveryBinding: candidates.binding,
    selection: { coordinate: candidate.coordinate, source: "user_map_selection", confirmed: true } };
  const query = planningOrdinaryQuery(context, request.selection.coordinate);
  const binding = planningBinding(context, dataset, actor, request.selection);
  const closure = { ...route.knownClosures, requestHash: hash(query) };
  const preview: PlanningPreviewResponse = { version: "sim-planning-origin-preview-v1", purpose: "planning_preview", context,
    planningOrigin: request.selection.coordinate, offsetDistanceM: candidate.offsetDistanceM, connector: { state: "unknown", navigable: false },
    navigationEligible: false, measurementEligible: false,
    route: { previewPathId: `preview:${hash({ domain: "sim-planning-origin-v1/path", binding, geometryHash: hash(route.geometry) })}`,
      geometry: route.geometry, distanceM: route.distanceM, durationSeconds: route.durationSeconds, warnings: [] },
    assessment: { ...route.mappedProfileAssessment, version: "sim-planning-origin-assessment-v1", purpose: "planning_preview", binding,
      requestHash: binding.requestHash, selectionHash: hash(request.selection), knownClosuresEvidence: closure,
      navigationEligible: false, measurementEligible: false,
      guards: { mappedProfile: "applied_incomplete_coverage", knownClosures: "applied_reviewed_snapshot", closureRevision: closure.revision,
        snapToleranceM: 25, nativeWarningCount: 0, allVariantsValidated: true, fallbackUsed: false } } };
  return { now, context, candidate, candidates, request, preview };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("strict assisted planning boundary", () => {
  it("requires its explicit configuration and never borrows an AI or other credential", () => {
    const env = { COP_ROUTING_PLANNING_ENABLED: "true", COP_ROUTING_ENABLED: "true", COP_ROUTING_BASE_URL: "https://sim.example.test/api/v1",
      COP_AI_ROUTER_TOKEN: "synthetic-unrelated-token" };
    expect(createPlanningOriginSourceFromEnv(env)).toBeUndefined();
    expect(createPlanningOriginSourceFromEnv({ ...env, COP_ROUTING_PLANNING_ENABLED: "false", COP_ROUTING_PLANNING_SERVICE_TOKEN: "synthetic-token" })).toBeUndefined();
    expect(createPlanningOriginSourceFromEnv({ ...env, COP_ROUTING_PLANNING_SERVICE_TOKEN: "synthetic-token" })).toBeInstanceOf(PlanningOriginSource);
  });
  it("accepts the independently exported SIM fixture and every shared canonical hash vector", () => {
    const f = JSON.parse(readFileSync(new URL("../../../docs/api/examples/planning-origin-v1.sim-fixture.json", import.meta.url), "utf8"));
    const now = new Date(f.nowUtc), actor = f.actor.opaquePlanningActor;
    expect(verifyPlanningCandidates(f.candidatesResponse, f.candidatesRequest, actor, now)).toEqual(f.candidatesResponse);
    expect(validatePlanningRequest("preview", f.previewRequest, actor, now)).toEqual(f.previewRequest);
    expect(verifyPlanningPreview(f.previewResponse, f.previewRequest, actor, now)).toEqual(f.previewResponse);
    expect(planningOrdinaryQuery(f.previewRequest.context, f.previewRequest.selection.coordinate)).toEqual(f.ordinaryQuery);
    expect(f.canonicalPublicVectors).toEqual({
      contextHash: hash({ domain: "sim-planning-origin-v1/context", context: f.previewRequest.context }),
      profileHash: hash(f.previewRequest.context.vehicleProfile), destinationHash: hash(f.previewRequest.context.destination),
      selectionHash: hash(f.previewRequest.selection), geometryHash: hash(f.previewResponse.route.geometry), ordinaryQueryHash: hash(f.ordinaryQuery),
      candidateId: planningCandidateId(f.previewRequest.context, f.previewRequest.expectedDataset, f.candidatesResponse.candidates[0]) });
    expect(planningBinding(f.previewRequest.context, f.previewRequest.expectedDataset, actor).requestHash).toBe(f.actorBoundVectorsCopOnly.discoveryRequestHash);
    expect(planningBinding(f.previewRequest.context, f.previewRequest.expectedDataset, actor, f.previewRequest.selection).requestHash).toBe(f.actorBoundVectorsCopOnly.previewRequestHash);
  });
  it("accepts a separate planning preview only after the existing full mapped and closure validators", () => {
    const f = fixture();
    expect(validatePlanningRequest("preview", f.request, actor, f.now)).toEqual(f.request);
    expect(verifyPlanningCandidates(f.candidates, { context: f.context }, actor, f.now)).toEqual(f.candidates);
    expect(verifyPlanningPreview(f.preview, f.request, actor, f.now)).toEqual(f.preview);
    expect(f.preview).not.toHaveProperty("routes"); expect(f.preview.route).not.toHaveProperty("mappedProfileAssessment");
  });
  it.each([
    (f: ReturnType<typeof fixture>) => { Object.assign(f.request, { userId: "forged" }); },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.request.context, { providerOptions: { ignore_access: true } }); },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.request.selection, { candidateId: "candidate:forged" }); },
    (f: ReturnType<typeof fixture>) => { f.request.context.destination.lat = NaN; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.request.context.originContext, { horizontalAccuracyM: Infinity }); }
  ])("rejects unsupported fields or non-finite data before routing", mutate => {
    const f = fixture(); mutate(f);
    expect(() => validatePlanningRequest("preview", f.request, actor, f.now)).toThrow();
  });
  it.each([-1, 900_001])("rejects measured location age %s ms without fabricating a fresh sample", age => {
    const f = fixture();
    if (f.context.originContext.kind === "phone_measured") f.context.originContext.observedAt = new Date(f.now.getTime() - age).toISOString();
    expect(() => validatePlanningRequest("candidates", { context: f.context }, actor, f.now)).toThrow();
  });
  it("binds discovery to the current account and rejects a selection beyond the discovery area", () => {
    const f = fixture();
    expect(() => validatePlanningRequest("preview", f.request, "b".repeat(64), f.now)).toThrow();
    f.request.selection.coordinate = { lat: f.context.originContext.coordinate.lat + 1, lon: f.context.originContext.coordinate.lon };
    expect(() => validatePlanningRequest("preview", f.request, actor, f.now)).toThrow();
  });
  it("allows an explicitly manual context without invented GPS metadata", () => {
    const f = fixture(); f.context.originContext = { kind: "manual_point", source: "user_selected_last_known", coordinate: f.context.originContext.coordinate };
    expect(validatePlanningRequest("candidates", { context: f.context }, actor, f.now)).toEqual({ context: f.context });
  });
  it.each([
    (f: ReturnType<typeof fixture>) => { f.preview.navigationEligible = true as false; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.version = "sim-mapped-road-profile-assessment-v1" as never; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.engine.costing = "truck"; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.appliedFields.push("unverified-dimension"); },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.requestHash = "b".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.knownClosuresEvidence.requestHash = "b".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.knownClosuresEvidence.appliedClosureCount++; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.knownClosuresEvidence.geometryHash = "b".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.knownClosuresEvidence.validUntil = new Date(f.now.getTime() - 1).toISOString(); },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.lastMile.target = { lat: 0, lon: 0 }; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.engine.fallbackUsed = true as false; },
    (f: ReturnType<typeof fixture>) => { f.preview.assessment.guards.nativeWarningCount = 1 as 0; }
  ])("rejects invalid purpose, profile or actual closure proof", mutate => {
    const f = fixture(); mutate(f);
    expect(() => verifyPlanningPreview(f.preview, f.request, actor, f.now)).toThrow();
  });
  it("rejects candidates with mismatched state, identity, distance or expiry", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.candidates.state = "no_candidates"; },
      (f: ReturnType<typeof fixture>) => { f.candidates.binding.requestHash = "b".repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.candidates.candidates[0]!.offsetDistanceM += 10; },
      (f: ReturnType<typeof fixture>) => { f.candidates.validUntil = new Date(f.now.getTime() + 120_001).toISOString(); }
    ]) { const f = fixture(); mutate(f); expect(() => verifyPlanningCandidates(f.candidates, { context: f.context }, actor, f.now)).toThrow(); }
  });
  it("captures body, actor and clock before awaiting SIM, without sharing a pending request", async () => {
    const f = fixture();
    let resolve!: (value: Response) => void;
    const fetch = vi.fn(async () => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal("fetch", fetch);
    const source = new PlanningOriginSource(new PlanningOriginTransport("https://sim.example.test/api/v1", "synthetic-token"));
    const body = { context: structuredClone(f.context) }, metadata = { actor, correlationId: cid }, clock = new Date(f.now);
    const pending = source.request("candidates", body, metadata, clock);
    body.context.destination.lat = 0; metadata.actor = "b".repeat(64); clock.setTime(0);
    resolve(Response.json(f.candidates));
    expect(await pending).toEqual(f.candidates); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
