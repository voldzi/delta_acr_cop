import { createHash } from "node:crypto";
import type { AccountErasureOperationContext } from "./account-erasure.js";
import { readBoundedBody } from "./bounded-upstream.js";
import { createDefaultFederatedNodes, type FederatedNodeRecord } from "./federation.js";
import { projectionReferences, type ProjectionEraseContext, type ProjectionRemoteOwner, type ProjectionResources } from "./resource-projection-erasure.js";
import type { AuthenticatedActor } from "./security.js";

const VERSION = "cop-edge-account-erasure-v1";
const hex = /^[a-f0-9]{64}$/u, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
function descriptor(node: FederatedNodeRecord): string {
  return JSON.stringify([node.nodeId, node.nodeRole, node.nodeTrustDomain, node.capabilities, node.eventSubscriptions, node.dataEndpoints]);
}
/** The built-in provider descriptions are not edge-cache transports. Their
 * concrete Messaging/Router/measurement stores remain independently required
 * owners of the same whole-account controller. Any other or changed registry
 * entry needs an explicitly configured actual projection owner. */
export function externalProjectionNodes(nodes: Iterable<FederatedNodeRecord>): FederatedNodeRecord[] {
  const defaults = createDefaultFederatedNodes();
  return [...nodes].filter(node => !defaults.has(node.nodeId) || descriptor(defaults.get(node.nodeId)!) !== descriptor(node));
}
export function normalizedEdgeProjectionResources(resources: ProjectionResources): Required<ProjectionResources> {
  projectionReferences(resources);
  return { reportIds: [...new Set(resources.reportIds.map(id => id.toLowerCase()))].sort(), groupIds: [...new Set(resources.groupIds.map(id => id.toLowerCase()))].sort(),
    incidentIds: [...new Set((resources.incidentIds ?? []).map(id => id.toLowerCase()))].sort(), taskIds: [...new Set((resources.taskIds ?? []).map(id => id.toLowerCase()))].sort(),
    drawingIds: [...new Set((resources.drawingIds ?? []).map(id => id.toLowerCase()))].sort() };
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === keys.sort().join();
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function createEdgeProjectionRemoteOwner(options: {
  env?: Record<string, string | undefined>;
  nodes(): Iterable<FederatedNodeRecord>;
  uncontrolledStream(): boolean;
  assertCopAccessFenced(actor: AuthenticatedActor, context: AccountErasureOperationContext): Promise<boolean>;
}): ProjectionRemoteOwner {
  const env = { ...(options.env ?? process.env) }, nodeId = env.COP_EDGE_NODE_ID ?? "node_edge_pilot_01";
  let origin: URL | undefined;
  const token = env.COP_EDGE_ADMIN_TOKEN ?? "";
  if (env.COP_ACCOUNT_ERASURE_EDGE_URL) {
    const url = new URL(env.COP_ACCOUNT_ERASURE_EDGE_URL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(nodeId) || token.length < 32 || /[\u0000-\u001f\u007f]/u.test(token))
      throw new Error("EDGE_ERASURE_CONFIGURATION_UNPROVEN");
    origin = url;
  }
  function peers(): FederatedNodeRecord[] | undefined {
    if (options.uncontrolledStream()) return;
    const nodes = externalProjectionNodes(options.nodes());
    if (nodes.some(node => node.nodeId !== nodeId || node.nodeRole !== "edge-node") || nodes.length > 1 || nodes.length && !origin) return;
    return nodes;
  }
  async function request(body?: object, signal = AbortSignal.timeout(5000)): Promise<{ status: number; value: Record<string, unknown> }> {
    if (!origin) throw new Error("EDGE_ERASURE_UNAVAILABLE");
    const response = await fetch(new URL(body ? "/edge/internal/account-erasure" : "/edge/internal/account-erasure/capabilities", origin), {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      headers: { authorization: "Bearer " + token, accept: "application/json", "cache-control": "no-store", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (![200, 202].includes(response.status) || (response.headers.get("content-type") ?? "").split(";")[0]?.trim() !== "application/json") {
      await response.body?.cancel(); throw new Error("EDGE_ERASURE_UNAVAILABLE");
    }
    const value = record(JSON.parse((await readBoundedBody(response, 16384)).toString("utf8")));
    signal.throwIfAborted();
    return { status: response.status, value };
  }
  async function ready(): Promise<boolean> {
    try {
      const nodes = peers();
      if (!nodes) return false;
      if (nodes.length === 0 && !origin) return true;
      const { status, value } = await request();
      return status === 200 && exact(value, ["contractVersion", "nodeId", "writerFenceInstalled", "stateReadbackVerified"]) && value.contractVersion === VERSION &&
        value.nodeId === nodeId && value.writerFenceInstalled === true && value.stateReadbackVerified === true;
    } catch { return false; }
  }
  return {
    ready,
    async erase(resources, input: ProjectionEraseContext): Promise<boolean> {
      try {
        const context = input as ProjectionEraseContext & Partial<AccountErasureOperationContext>;
        if (!input.actor || !hex.test(context.accountKey ?? "") || !uuid.test(context.operationId) ||
          !context.requestedAt || !Number.isFinite(Date.parse(context.requestedAt)) || !context.datasetBinding ||
          !uuid.test(context.datasetBinding.incarnationId) || !Number.isSafeInteger(context.datasetBinding.restoreGeneration) || context.datasetBinding.restoreGeneration < 1) return false;
        const actor: AuthenticatedActor = { authMode: "oidc", ...input.actor, username: "", displayName: "" };
        const actualContext = context as AccountErasureOperationContext;
        if (!await options.assertCopAccessFenced(actor, actualContext)) return false;
        const normalized = normalizedEdgeProjectionResources(resources), before = peers();
        if (!before || !await ready()) return false;
        if (before.length === 0 && !origin) return true;
        const body = { contractVersion: VERSION, phase: "erase", scope: "full_account", accountKey: context.accountKey,
          operationId: context.operationId, actor: { issuer: actor.issuer, subjectId: actor.subjectId }, datasetBinding: context.datasetBinding, resources: normalized };
        const { status, value } = await request(body, context.signal);
        if (status !== 200 || !exact(value, ["contractVersion", "nodeId", "accountKey", "operationId", "datasetBinding", "resourcesDigest", "state", "proofId"]) ||
          value.contractVersion !== VERSION || value.nodeId !== nodeId || value.accountKey !== context.accountKey || value.operationId !== context.operationId ||
          !exact(record(value.datasetBinding), ["incarnationId", "restoreGeneration"]) ||
          record(value.datasetBinding).incarnationId !== context.datasetBinding.incarnationId || record(value.datasetBinding).restoreGeneration !== context.datasetBinding.restoreGeneration || value.resourcesDigest !== hash(normalized) ||
          value.state !== "completed" || typeof value.proofId !== "string" || !hex.test(value.proofId)) return false;
        return JSON.stringify(peers()?.map(descriptor)) === JSON.stringify(before.map(descriptor)) && await ready();
      } catch { return false; }
    }
  };
}
