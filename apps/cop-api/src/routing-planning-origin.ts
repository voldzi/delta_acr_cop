import { readFileSync } from "node:fs";
import { createAjv } from "@cop/ingest-contracts";
import { canonicalJson, routingHash as hash } from "./routing-trip.js";
import { validateVehicleProfileRequest, verifyMappedProfileResponse, type MappedVehicleProfile, type MappedProfileAssessment } from "./routing-vehicle-profile.js";
import { verifyKnownClosuresResponse, type KnownClosures } from "./routing-known-closures.js";
import { PlanningOriginTransport, type PlanningTransportContext } from "./routing-planning-transport.js";
import { createRoutingSourceConfigFromEnv } from "./routing-source.js";

export interface PlanningCoordinate { lat: number; lon: number }
export interface PlanningDataset { version: string; builtAt: string }
export interface PlanningContext {
  version: "sim-planning-origin-v1"; purpose: "planning_preview"; contextId: string;
  originContext: { kind: "phone_measured"; coordinate: PlanningCoordinate; horizontalAccuracyM: number; observedAt: string; accuracyAuthorization: "full" | "reduced" }
    | { kind: "manual_point"; coordinate: PlanningCoordinate; source: "user_map_selection" | "user_selected_last_known" | "address_selection" };
  destination: PlanningCoordinate; vehicleProfile: MappedVehicleProfile;
}
export interface PlanningBinding {
  contextId: string; contextHash: string; profileHash: string; destinationHash: string; requestHash: string; routingDataset: PlanningDataset;
}
export interface PlanningDirection { directionId: string; headingDeg?: number; validation: "graph_candidate_only" }
export type PlanningSelection = { coordinate: PlanningCoordinate; confirmed: true } & (
  { source: "user_map_selection" } |
  { source: "candidate_selection"; candidateId: string; directions: PlanningDirection[]; directionsTruncated: boolean });
export interface PlanningCandidatesRequest { context: PlanningContext }
export interface PlanningPreviewRequest { context: PlanningContext; expectedDataset: PlanningDataset; discoveryBinding: PlanningBinding; selection: PlanningSelection }
export interface PlanningCandidate {
  candidateId: string; coordinate: PlanningCoordinate; offsetDistanceM: number;
  profileValidation: "not_checked"; legalAccess: "not_verified"; directionValidation: "graph_candidate_only";
  directions: PlanningDirection[]; directionsTruncated: boolean;
}
export interface PlanningCandidatesResponse {
  version: "sim-planning-origin-candidates-v1"; purpose: "planning_preview"; state: "choices_available" | "no_candidates";
  binding: PlanningBinding; observedAt: string; validUntil: string; candidates: PlanningCandidate[];
  navigationEligible: false; measurementEligible: false;
}
export interface PlanningPreviewResponse {
  version: "sim-planning-origin-preview-v1"; purpose: "planning_preview"; context: PlanningContext;
  planningOrigin: PlanningCoordinate; offsetDistanceM: number; connector: { state: "unknown"; navigable: false };
  navigationEligible: false; measurementEligible: false;
  route: { previewPathId: string; geometry: { type: "LineString"; coordinates: number[][] }; distanceM: number; durationSeconds: number; warnings: string[] };
  assessment: Omit<MappedProfileAssessment, "version"> & {
    version: "sim-planning-origin-assessment-v1"; purpose: "planning_preview"; binding: PlanningBinding;
    selectionHash: string; knownClosuresEvidence: KnownClosures; navigationEligible: false; measurementEligible: false;
    guards: { mappedProfile: string; knownClosures: string; closureRevision: string; snapToleranceM: number;
      nativeWarningCount: 0; allVariantsValidated: true; fallbackUsed: false };
  };
}
export class PlanningOriginError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super("Planning origin request could not be verified."); this.name = "PlanningOriginError";
  }
}
const domain = "sim-planning-origin-v1";
const schemas = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/planning-origin-v1.schemas.json", import.meta.url), "utf8"));
const ajv = createAjv();
const compile = (name: string) => ajv.compile({ ...schemas, $ref: `#/components/schemas/${name}` });
const validators = { candidates: compile("CandidatesRequest"), preview: compile("PreviewRequest"),
  candidatesResponse: compile("CandidatesResponse"), previewResponse: compile("PreviewResponse") };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const finiteJson = (value: unknown): boolean => typeof value === "number" ? Number.isFinite(value)
  : Array.isArray(value) ? value.every(finiteJson)
  : value !== null && typeof value === "object" ? Object.values(value).every(finiteJson) : true;
function fail(status: number, code: string): never { throw new PlanningOriginError(status, code); }
function invalid(): never { return fail(502, "ROUTING_PLANNING_EVIDENCE_INVALID"); }

export function planningOffset(a: PlanningCoordinate, b: PlanningCoordinate): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function planningBinding(context: PlanningContext, dataset: PlanningDataset, actor: string, selection: PlanningSelection | null = null): PlanningBinding {
  return { contextId: context.contextId, contextHash: hash({ domain: `${domain}/context`, context }),
    profileHash: hash(context.vehicleProfile), destinationHash: hash(context.destination), routingDataset: dataset,
    requestHash: hash({ domain: `${domain}/request`, serviceActor: "cop", opaquePlanningActor: actor, context, selection, routingDataset: dataset }) };
}
export function planningCandidateId(context: PlanningContext, dataset: PlanningDataset, candidate: Pick<PlanningCandidate, "coordinate" | "directions" | "directionsTruncated">): string {
  return `candidate:${hash({ domain: `${domain}/candidate`, contextHash: hash({ domain: `${domain}/context`, context }),
    routingDataset: dataset, coordinate: candidate.coordinate, directions: candidate.directions, directionsTruncated: candidate.directionsTruncated })}`;
}
/** Exact public query used by SIM's ordinary guards; never an actor-bound hash. */
export function planningOrdinaryQuery(context: PlanningContext, coordinate: PlanningCoordinate) {
  return { profileId: "car", from: { lon: coordinate.lon, lat: coordinate.lat },
    to: { lon: context.destination.lon, lat: context.destination.lat }, vehicleProfile: context.vehicleProfile,
    via: [], avoid: [], alternatives: 1, includeSteps: false, includeRoadAttributes: false,
    includeElevationProfile: false, includeWeatherOnRoute: false, includeHazardsOnRoute: false, includeTraffic: false };
}
function fresh(context: PlanningContext, now: Date): void {
  if (context.originContext.kind !== "phone_measured") return;
  const age = now.getTime() - Date.parse(context.originContext.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 900_000) fail(422, "PLANNING_ORIGIN_CONTEXT_EXPIRED");
}
function validDataset(dataset: PlanningDataset, now: Date): void {
  const age = now.getTime() - Date.parse(dataset.builtAt);
  if (!Number.isFinite(age) || age < 0 || age >= 10 * 86400_000) fail(422, "ROUTING_GRAPH_STALE");
}
export function validatePlanningRequest(operation: "candidates" | "preview", body: unknown, actor: string, now: Date): PlanningCandidatesRequest | PlanningPreviewRequest {
  if (!validators[operation](body) || !finiteJson(body)) fail(400, "VALIDATION_ERROR");
  const request = structuredClone(body) as PlanningCandidatesRequest | PlanningPreviewRequest;
  const { context } = request;
  fresh(context, now);
  try { validateVehicleProfileRequest({ ...planningOrdinaryQuery(context, context.originContext.coordinate), profileId: "car" }); }
  catch { fail(400, "VALIDATION_ERROR"); }
  const profile = context.vehicleProfile;
  if (profile.driverDeclaredAuthorization === true || (profile.intent !== "commercial_truck" &&
    (profile.vehicle?.axleCount !== undefined || profile.vehicle?.axleLoadKg !== undefined))) fail(422, "ROUTING_PROFILE_UNSUPPORTED");
  if ("selection" in request) {
    validDataset(request.expectedDataset, now);
    if (!same(request.discoveryBinding, planningBinding(context, request.expectedDataset, actor)) ||
      planningOffset(context.originContext.coordinate, request.selection.coordinate) > 500 ||
      (request.selection.source === "candidate_selection" && request.selection.candidateId !== planningCandidateId(context, request.expectedDataset, request.selection))) {
      fail(409, "PLANNING_ORIGIN_SELECTION_INVALID");
    }
  }
  return request;
}
export function verifyPlanningCandidates(value: unknown, request: PlanningCandidatesRequest, actor: string, now: Date): PlanningCandidatesResponse {
  if (!validators.candidatesResponse(value) || !finiteJson(value)) invalid();
  const response = value as PlanningCandidatesResponse;
  fresh(request.context, now); validDataset(response.binding.routingDataset, now);
  if (!same(response.binding, planningBinding(request.context, response.binding.routingDataset, actor))) invalid();
  const observed = Date.parse(response.observedAt), until = Date.parse(response.validUntil);
  const phoneUntil = request.context.originContext.kind === "phone_measured" ? Date.parse(request.context.originContext.observedAt) + 900_000 : Infinity;
  if (observed > now.getTime() || until <= now.getTime() || until <= observed || until > observed + 120_000 ||
    until > Date.parse(response.binding.routingDataset.builtAt) + 10 * 86400_000 || until > phoneUntil) invalid();
  const ids = new Set<string>();
  for (const candidate of response.candidates) {
    const distance = planningOffset(request.context.originContext.coordinate, candidate.coordinate);
    if (!Number.isFinite(distance) || distance > 500 || Math.abs(distance - candidate.offsetDistanceM) > 0.01 ||
      candidate.candidateId !== planningCandidateId(request.context, response.binding.routingDataset, candidate) || ids.has(candidate.candidateId)) invalid();
    ids.add(candidate.candidateId);
  }
  return response;
}
export function verifyPlanningPreview(value: unknown, request: PlanningPreviewRequest, actor: string, now: Date): PlanningPreviewResponse {
  if (!validators.previewResponse(value) || !finiteJson(value)) invalid();
  const response = value as PlanningPreviewResponse;
  fresh(request.context, now); validDataset(request.expectedDataset, now);
  const a = response.assessment, path = response.route, binding = planningBinding(request.context, request.expectedDataset, actor, request.selection);
  if (!same(response.context, request.context) || !same(response.planningOrigin, request.selection.coordinate) || !same(a.binding, binding) ||
    a.requestHash !== binding.requestHash || a.selectionHash !== hash(request.selection) || a.geometryHash !== hash(path.geometry) ||
    !same(a.routingDataset, request.expectedDataset) || a.guards.closureRevision !== a.knownClosuresEvidence.revision ||
    path.previewPathId !== `preview:${hash({ domain: `${domain}/path`, binding, geometryHash: hash(path.geometry) })}` ||
    Math.abs(response.offsetDistanceM - planningOffset(request.context.originContext.coordinate, request.selection.coordinate)) > 0.01) invalid();
  const first = path.geometry.coordinates[0]!;
  if (planningOffset(request.selection.coordinate, { lon: first[0]!, lat: first[1]! }) > a.guards.snapToleranceM) invalid();
  const until = Date.parse(a.validUntil);
  if (until <= now.getTime() || (request.context.originContext.kind === "phone_measured" && until > Date.parse(request.context.originContext.observedAt) + 900_000)) invalid();
  // Reuse the ordinary semantic validators internally. This transient structure
  // never crosses the API boundary and cannot promote a preview to navigation.
  const query = planningOrdinaryQuery(request.context, request.selection.coordinate);
  const mapped = { ...a, version: "sim-mapped-road-profile-assessment-v1", requestHash: hash(query) } as Record<string, unknown>;
  for (const key of ["purpose", "binding", "selectionHash", "knownClosuresEvidence", "navigationEligible", "measurementEligible", "guards"]) delete mapped[key];
  const routeId = path.previewPathId;
  const route = { routeId, status: "ok", distanceM: path.distanceM, durationSeconds: path.durationSeconds, geometry: path.geometry,
    quality: { engine: "valhalla", mode: "engine_route" }, knownClosures: a.knownClosuresEvidence, mappedProfileAssessment: mapped };
  const ordinary = { query, coverage: { routingDataset: request.expectedDataset }, routes: [route],
    features: [{ id: routeId, geometry: path.geometry, properties: { routeId, knownClosures: a.knownClosuresEvidence, mappedProfileAssessment: mapped } }] };
  try {
    if (!verifyKnownClosuresResponse(ordinary, query, now) || !verifyMappedProfileResponse(ordinary, query, now, true)) invalid();
  } catch { invalid(); }
  return response;
}

export class PlanningOriginSource {
  constructor(private readonly transport: PlanningOriginTransport) {}
  async request(operation: "candidates" | "preview", body: unknown, context: PlanningTransportContext, now: Date,
    assertCurrent?: () => Promise<void>): Promise<PlanningCandidatesResponse | PlanningPreviewResponse> {
    const actor = context.actor, correlationId = context.correlationId, requestTime = now.getTime();
    const request = validatePlanningRequest(operation, body, actor, new Date(requestTime));
    const started = performance.now();
    const response = await this.transport.request(operation, request, { actor, correlationId });
    await assertCurrent?.();
    const received = new Date(requestTime + Math.max(0, performance.now() - started));
    return operation === "candidates" ? verifyPlanningCandidates(response, request, actor, received)
      : verifyPlanningPreview(response, request as PlanningPreviewRequest, actor, received);
  }
}

export function createPlanningOriginSourceFromEnv(env: Record<string, string | undefined> = process.env): PlanningOriginSource | undefined {
  if (env.COP_ROUTING_PLANNING_ENABLED !== "true") return undefined;
  const config = createRoutingSourceConfigFromEnv(env), token = env.COP_ROUTING_PLANNING_SERVICE_TOKEN;
  if (!config.enabled || !token) return undefined;
  try { return new PlanningOriginSource(new PlanningOriginTransport(config.baseUrl, token, config.timeoutMs)); }
  catch { return undefined; }
}
