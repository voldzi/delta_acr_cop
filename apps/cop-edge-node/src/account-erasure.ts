import { createHash } from "node:crypto";

const keys = ["reportIds", "groupIds", "incidentIds", "taskIds", "drawingIds"] as const;
type ResourceKey = typeof keys[number];
export type EdgeErasureResources = Record<ResourceKey, string[]>;
export interface EdgeErasureRequest {
  contractVersion: "cop-edge-account-erasure-v1"; phase: "preflight" | "erase"; scope: "full_account";
  accountKey: string; operationId: string; actor: { issuer: string; subjectId: string };
  datasetBinding: { incarnationId: string; restoreGeneration: number }; resources: EdgeErasureResources;
}
export interface EdgeErasureFence {
  accountKey: string; operationId: string; actorHash: string; subjectHash: string;
  resources: EdgeErasureResources; resourcesDigest: string;
  proofId?: string; unresolvedIncoming?: boolean;
}
export interface EdgeErasureJournal {
  contractVersion: "cop-edge-erasure-fences-v1";
  datasetBinding: EdgeErasureRequest["datasetBinding"];
  fences: EdgeErasureFence[];
}
export interface EdgeErasureState {
  inboundEvents: Array<{ event: unknown }>;
  outbox: Array<{ event: unknown }>;
  deadLetters: Array<{ event: unknown }>;
  accountErasure?: EdgeErasureJournal;
}
export class EdgeErasureError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const hex = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const identifier = uuid;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, names: readonly string[]) => Object.keys(v).sort().join(",") === [...names].sort().join(",");
function need(v: unknown, code = "EDGE_ERASURE_REQUEST_INVALID", status = 400): asserts v { if (!v) throw new EdgeErasureError(status, code); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const actorHash = (actor: EdgeErasureRequest["actor"]) => hash([actor.issuer, actor.subjectId]);
function binding(value: unknown): value is EdgeErasureRequest["datasetBinding"] {
  return record(value) && exact(value, ["incarnationId", "restoreGeneration"]) && typeof value.incarnationId === "string" && uuid.test(value.incarnationId) &&
    typeof value.restoreGeneration === "number" && Number.isSafeInteger(value.restoreGeneration) && value.restoreGeneration > 0;
}
export function edgeResources(value: unknown): EdgeErasureResources {
  need(record(value) && exact(value, keys));
  const result = {} as EdgeErasureResources; let count = 0;
  for (const key of keys) {
    const input = value[key]; need(Array.isArray(input) && input.every(v => typeof v === "string" && identifier.test(v)));
    result[key] = [...new Set((input as string[]).map(id => id.toLowerCase()))].sort(); count += result[key].length;
  }
  need(count <= 10000); return result;
}
export function edgeResourcesDigest(resources: EdgeErasureResources): string { return hash(edgeResources(resources)); }
export function parseEdgeErasureRequest(value: unknown): EdgeErasureRequest {
  need(record(value) && exact(value, ["contractVersion", "phase", "scope", "accountKey", "operationId", "actor", "datasetBinding", "resources"]));
  need(value.contractVersion === "cop-edge-account-erasure-v1" && ["preflight", "erase"].includes(String(value.phase)) && value.scope === "full_account" &&
    typeof value.accountKey === "string" && hex.test(value.accountKey) && typeof value.operationId === "string" && uuid.test(value.operationId) && binding(value.datasetBinding));
  need(record(value.actor) && exact(value.actor, ["issuer", "subjectId"]) && typeof value.actor.issuer === "string" && value.actor.issuer.length <= 2048 &&
    typeof value.actor.subjectId === "string" && value.actor.subjectId.length > 0 && value.actor.subjectId.length <= 512 && !/[\u0000-\u0020]/u.test(value.actor.subjectId));
  let issuer: URL; try { issuer = new URL(value.actor.issuer); } catch { throw new EdgeErasureError(400, "EDGE_ERASURE_REQUEST_INVALID"); }
  need(issuer.protocol === "https:" && !issuer.username && !issuer.password && !issuer.search && !issuer.hash);
  return { contractVersion: "cop-edge-account-erasure-v1", phase: value.phase as "erase" | "preflight", scope: "full_account", accountKey: value.accountKey,
    operationId: value.operationId.toLowerCase(), actor: { issuer: value.actor.issuer, subjectId: value.actor.subjectId }, datasetBinding: { incarnationId: value.datasetBinding.incarnationId.toLowerCase(), restoreGeneration: value.datasetBinding.restoreGeneration },
    resources: edgeResources(value.resources) };
}
export function validateEdgeErasureJournal(value: unknown): value is EdgeErasureJournal {
  try {
    need(record(value) && exact(value, ["contractVersion", "datasetBinding", "fences"]) && value.contractVersion === "cop-edge-erasure-fences-v1" &&
      binding(value.datasetBinding) && Array.isArray(value.fences) && value.fences.length <= 100000);
    const accounts = new Set<string>(), actors = new Set<string>();
    for (const fence of value.fences) {
      need(record(fence) && Object.keys(fence).every(k => ["accountKey", "operationId", "actorHash", "subjectHash", "resources", "resourcesDigest", "proofId", "unresolvedIncoming"].includes(k)) &&
        [fence.accountKey, fence.actorHash, fence.subjectHash, fence.resourcesDigest].every(v => typeof v === "string" && hex.test(v)) &&
        typeof fence.operationId === "string" && uuid.test(fence.operationId) && (fence.proofId === undefined || typeof fence.proofId === "string" && hex.test(fence.proofId)) &&
        (fence.unresolvedIncoming === undefined || typeof fence.unresolvedIncoming === "boolean"));
      const protectedResources = edgeResources(fence.resources);
      need(fence.resourcesDigest === edgeResourcesDigest(protectedResources) && JSON.stringify(fence.resources) === JSON.stringify(protectedResources));
      need(!accounts.has(String(fence.accountKey)) && !actors.has(String(fence.actorHash)));
      accounts.add(String(fence.accountKey)); actors.add(String(fence.actorHash));
    }
    return true;
  } catch { return false; }
}
function requireBinding(state: EdgeErasureState, input: EdgeErasureRequest): void {
  const previous = state.accountErasure?.datasetBinding;
  if (!previous) return;
  const next = input.datasetBinding;
  need(next.restoreGeneration >= previous.restoreGeneration && (next.restoreGeneration === previous.restoreGeneration
    ? next.incarnationId === previous.incarnationId : next.incarnationId !== previous.incarnationId), "EDGE_ERASURE_DATASET_CONFLICT", 409);
}
function existingFence(state: EdgeErasureState, input: EdgeErasureRequest): EdgeErasureFence | undefined {
  requireBinding(state, input);
  const existing = state.accountErasure?.fences.find(v => v.accountKey === input.accountKey || v.actorHash === actorHash(input.actor));
  if (existing) {
    need(existing.accountKey === input.accountKey && existing.actorHash === actorHash(input.actor) && existing.operationId === input.operationId,
      "EDGE_ERASURE_IDENTITY_OR_OPERATION_CONFLICT", 409);
  }
  return existing;
}
const fields: Record<string, ResourceKey> = { reportId: "reportIds", groupId: "groupIds", incidentId: "incidentIds", taskId: "taskIds", drawingId: "drawingIds" };
const entity: Record<string, ResourceKey> = { communityReport: "reportIds", communityGroup: "groupIds", incident: "incidentIds", task: "taskIds", sketchDrawing: "drawingIds" };
function inspectEvent(value: unknown, fence: Pick<EdgeErasureFence, "resources" | "subjectHash">): "owned" | "unknown" | "other" {
  const outer = record(value) ? value : {}, data = record(outer.data) ? outer.data : {};
  const kind = outer.entityType ?? data.entityType, id = outer.entityId ?? data.entityId;
  const producer = outer.producerNodeId ?? data.producerNodeId;
  const central = producer === "node_central_cop" && (outer.source === undefined || outer.source === "urn:csm:node:node_central_cop");
  const resourceKey = typeof kind === "string" ? entity[kind] : undefined;
  if (central && resourceKey && typeof id === "string" && fence.resources[resourceKey].includes(id.toLowerCase())) return "owned";
  const stack: unknown[] = [value]; let inspected = 0, unknown = false;
  while (stack.length) {
    if (++inspected > 100000) throw new EdgeErasureError(503, "EDGE_ERASURE_EVENT_BOUND_EXCEEDED");
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!record(current)) continue;
    if (typeof current.entityType === "string" && typeof current.entityId === "string") {
      const kind = entity[current.entityType]; if (kind && fence.resources[kind].includes(current.entityId.toLowerCase())) unknown = true;
    }
    for (const [key, child] of Object.entries(current)) {
      const kind = fields[key]; if (kind && typeof child === "string" && fence.resources[kind].includes(child.toLowerCase())) unknown = true;
      if (["subject", "subjectId", "subject_id", "ownerSubjectId", "actorSubjectId", "userId", "actorId"].includes(key) &&
        typeof child === "string" && hash(child) === fence.subjectHash) unknown = true;
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return unknown ? "unknown" : "other";
}
export function edgeErasurePreflight(state: EdgeErasureState, input: EdgeErasureRequest): boolean {
  const previous = existingFence(state, input);
  const combined = edgeResources(input.resources);
  if (previous) for (const key of keys) combined[key] = [...new Set([...previous.resources[key], ...input.resources[key]])].sort();
  const witness = { resources: combined, subjectHash: hash(input.actor.subjectId) };
  return previous?.unresolvedIncoming !== true && ![...state.inboundEvents, ...state.outbox, ...state.deadLetters].some(row => inspectEvent(row.event, witness) === "unknown");
}
export function installEdgeErasureFence(state: EdgeErasureState, input: EdgeErasureRequest): EdgeErasureFence {
  let previous = existingFence(state, input);
  if (!state.accountErasure) state.accountErasure = { contractVersion: "cop-edge-erasure-fences-v1", datasetBinding: input.datasetBinding, fences: [] };
  if (state.accountErasure.datasetBinding.restoreGeneration < input.datasetBinding.restoreGeneration) {
    state.accountErasure.datasetBinding = structuredClone(input.datasetBinding);
    for (const fence of state.accountErasure.fences) delete fence.proofId;
  }
  if (!previous) {
    previous = { accountKey: input.accountKey, operationId: input.operationId, actorHash: actorHash(input.actor), subjectHash: hash(input.actor.subjectId),
      resources: edgeResources(input.resources), resourcesDigest: edgeResourcesDigest(input.resources) };
    state.accountErasure.fences.push(previous);
  } else {
    for (const key of keys) previous.resources[key] = [...new Set([...previous.resources[key], ...input.resources[key]])].sort();
    previous.resourcesDigest = edgeResourcesDigest(previous.resources); delete previous.proofId;
  }
  return previous;
}
export function eraseEdgeCopies(state: EdgeErasureState, fence: EdgeErasureFence): boolean {
  state.inboundEvents = state.inboundEvents.filter(row => inspectEvent(row.event, fence) !== "owned");
  state.outbox = state.outbox.filter(row => inspectEvent(row.event, fence) !== "owned");
  state.deadLetters = state.deadLetters.filter(row => inspectEvent(row.event, fence) !== "owned");
  return fence.unresolvedIncoming !== true && ![...state.inboundEvents, ...state.outbox, ...state.deadLetters].some(row => inspectEvent(row.event, fence) !== "other");
}
/** New replay/outbox admission never retains a payload matching a saved fence.
 * Unknown metadata is not treated as verified ownership: it makes the owner
 * pending, while the new unsafe input is rejected rather than persisted. */
export function edgeEventAllowed(state: EdgeErasureState, value: unknown): boolean {
  for (const fence of state.accountErasure?.fences ?? []) {
    const match = inspectEvent(value, fence);
    if (match === "unknown") { fence.unresolvedIncoming = true; delete fence.proofId; return false; }
    if (match === "owned") return false;
  }
  return true;
}
export function edgeErasureProof(state: EdgeErasureState, fence: EdgeErasureFence, nodeId: string): string {
  return hash({ contractVersion: "cop-edge-account-erasure-v1", nodeId, accountKey: fence.accountKey, operationId: fence.operationId,
    datasetBinding: state.accountErasure!.datasetBinding, actorHash: fence.actorHash, resourcesDigest: fence.resourcesDigest,
    protectedResources: edgeResources(fence.resources), absenceVerified: true });
}
