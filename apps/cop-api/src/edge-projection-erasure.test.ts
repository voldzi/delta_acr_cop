import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultFederatedNodes, type FederatedNodeRecord } from "./federation.js";
import { createEdgeProjectionRemoteOwner, externalProjectionNodes, normalizedEdgeProjectionResources } from "./edge-projection-erasure.js";
import { createHash } from "node:crypto";
const VERSION = "cop-edge-account-erasure-v1";
const context = { accountKey: "a".repeat(64), operationId: "10000000-0000-4000-8000-000000000001", requestedAt: "2026-10-16T12:00:00.000Z",
  actor: { issuer: "https://fixture.invalid/realms/cop", subjectId: "synthetic-a" }, signal: AbortSignal.timeout(60000),
  datasetBinding: { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 1 } };
const resources = { reportIds: ["30000000-0000-4000-8000-000000000001"], groupIds: [] };
function fixture() {
  const nodes = createDefaultFederatedNodes();
  const edge: FederatedNodeRecord = { ...nodes.get("node_csm_messaging")!, nodeId: "node_edge_pilot_01", nodeRole: "edge-node", nodeTrustDomain: "cop-edge", dataEndpoints: ["/edge/status"] };
  nodes.set(edge.nodeId, edge);
  const fenced = vi.fn(async () => true);
  const owner = createEdgeProjectionRemoteOwner({ env: { COP_ACCOUNT_ERASURE_EDGE_URL: "http://127.0.0.1:4313", COP_EDGE_ADMIN_TOKEN: "synthetic-test-edge-token-at-least32" },
    nodes: () => nodes.values(), uncontrolledStream: () => false, assertCopAccessFenced: fenced });
  const caps = { contractVersion: VERSION, nodeId: edge.nodeId, writerFenceInstalled: true, stateReadbackVerified: true };
  const receipt = { contractVersion: VERSION, nodeId: edge.nodeId, accountKey: context.accountKey, operationId: context.operationId,
    datasetBinding: context.datasetBinding, resourcesDigest: createHash("sha256").update(JSON.stringify(normalizedEdgeProjectionResources(resources))).digest("hex"), state: "completed", proofId: "b".repeat(64) };
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => Response.json(init?.method === "POST" ? receipt : caps));
  vi.stubGlobal("fetch", fetcher);
  return { nodes, edge, fenced, owner, caps, receipt, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("actual configured Edge projection transport boundary", () => {
  it("distinguishes unchanged built-in provider descriptions from actual or changed consumers", () => {
    const nodes = createDefaultFederatedNodes();
    expect(externalProjectionNodes(nodes.values())).toEqual([]);
    nodes.set("node_sim_provider", { ...nodes.get("node_sim_provider")!, dataEndpoints: ["https://foreign.invalid"] });
    expect(externalProjectionNodes(nodes.values()).map(node => node.nodeId)).toEqual(["node_sim_provider"]);
  });
  it("binds a completed readback to the exact actor operation dataset and resource digest", async () => {
    const { owner, fetcher, fenced } = fixture();
    expect(await owner.ready()).toBe(true);
    expect(await owner.erase(resources, context)).toBe(true);
    expect(fenced).toHaveBeenCalledWith(expect.objectContaining(context.actor), context);
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(request[0])).toBe("http://127.0.0.1:4313/edge/internal/account-erasure");
    expect(JSON.parse(String(request[1]?.body))).toEqual({ contractVersion: VERSION, phase: "erase", scope: "full_account", accountKey: context.accountKey,
      operationId: context.operationId, actor: context.actor, datasetBinding: context.datasetBinding, resources: normalizedEdgeProjectionResources(resources) });
  });
  it("still verifies an explicitly configured Edge after restoring a registry without its row", async () => {
    const f = fixture();
    f.nodes.delete(f.edge.nodeId);
    expect(await f.owner.ready()).toBe(true);
    expect(f.fetcher).toHaveBeenCalled();
    expect(await f.owner.erase(resources, context)).toBe(true);
    expect(f.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    f.fetcher.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect(await f.owner.ready()).toBe(false);
    expect(await f.owner.erase(resources, context)).toBe(false);
  });
  it("never promotes HTTP202 or a stale/foreign readback to completion", async () => {
    for (const mutation of ["accepted", "operation", "dataset", "resources", "proof"]) {
      const f = fixture();
      const receipt = { ...f.receipt, ...(mutation === "operation" ? { operationId: "40000000-0000-4000-8000-000000000001" } : {}),
        ...(mutation === "dataset" ? { datasetBinding: { ...context.datasetBinding, restoreGeneration: 2 } } : {}),
        ...(mutation === "resources" ? { resourcesDigest: "c".repeat(64) } : {}), ...(mutation === "proof" ? { proofId: undefined } : {}) };
      f.fetcher.mockImplementation(async (_input, init) => Response.json(init?.method === "POST" ? receipt : f.caps,
        { status: mutation === "accepted" && init?.method === "POST" ? 202 : 200 }));
      expect(await f.owner.erase(resources, context)).toBe(false);
    }
  });
  it("does not call Edge without the actual COP fence or complete worker context", async () => {
    const f = fixture(); f.fenced.mockResolvedValue(false);
    expect(await f.owner.erase(resources, context)).toBe(false); expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.owner.erase(resources, { operationId: context.operationId, actor: context.actor, signal: context.signal })).toBe(false);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("fails closed for unknown consumers and an uncontrolled external stream", async () => {
    const f = fixture(); f.nodes.set("foreign", { ...f.edge, nodeId: "foreign" });
    expect(await f.owner.ready()).toBe(false); expect(f.fetcher).not.toHaveBeenCalled();
    const owner = createEdgeProjectionRemoteOwner({ nodes: () => createDefaultFederatedNodes().values(), uncontrolledStream: () => true,
      assertCopAccessFenced: f.fenced });
    expect(await owner.ready()).toBe(false);
  });
  it("rejects a consumer registered while cleanup is in flight", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async (_input, init) => {
      if (init?.method === "POST") f.nodes.set("late", { ...f.edge, nodeId: "late" });
      return Response.json(init?.method === "POST" ? f.receipt : f.caps);
    });
    expect(await f.owner.erase(resources, context)).toBe(false);
  });
  it("handles outage and non-JSON denial without direct fallback", async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error("synthetic_outage"));
    expect(await f.owner.ready()).toBe(false); expect(await f.owner.erase(resources, context)).toBe(false);
    f.fetcher.mockResolvedValue(new Response("denied", { status: 401 }));
    expect(await f.owner.erase(resources, context)).toBe(false);
  });
});
