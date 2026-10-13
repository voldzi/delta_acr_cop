import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter, type AccountErasureProof } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const instant = new Date("2026-10-11T15:00:00.000Z");
const issuer = "https://identity.test/realms/cop";
const operation = "a85c1e8c-358e-4e39-87a0-e0e9e09d8312";
const otherOperation = "e6450609-cbe5-4c9c-adfa-598db1d125ef";
const confirm = { confirmAccountDeletion: true };
const actor = (subjectId = "synthetic-secret-subject", authTime: number | undefined = instant.getTime() / 1000): AuthenticatedActor =>
  ({ authMode: "oidc", issuer, subjectId, username: "synthetic", displayName: "Synthetic", authTime });
const complete = (): AccountErasureProof => ({ status: "completed", proofId: "fixture-proof-v1" });
function setup() {
  const store = new MemoryMobilityStore();
  const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: vi.fn(async () => true), preflight: async () => ({ ready: true as const, version: "fixture_preflight_v1" }), erase: vi.fn(async () => complete()) }));
  const options = { store, allowUnboundSyntheticStore: true, identitySecret: "fixture-dedicated-erasure-secret-32-characters", issuer,
    requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true, now: () => instant };
  return { store, adapters, options, service: new AccountErasureService(options) };
}

describe("durable whole COP account erasure", () => {
  it("requires explicit full owner boundary, dedicated secret and unique adapters", () => {
    const { options } = setup();
    expect(() => new AccountErasureService({ ...options, requiredAdapters: [] })).toThrow();
    expect(() => new AccountErasureService({ ...options, requiredAdapters: ["keycloak"] })).toThrow();
    expect(() => new AccountErasureService({ ...options, adapters: [options.adapters[0]!, options.adapters[0]!] })).toThrow();
    expect(() => new AccountErasureService({ ...options, allowUnboundSyntheticStore: true, identitySecret: "short" })).toThrow();
  });

  it("rejects stale or missing authentication time, forged actor/body and invalid operation before fencing", async () => {
    const { service, store, adapters } = setup();
    for (const principal of [{ ...actor("a"), authTime: undefined }, actor("a", instant.getTime() / 1000 - 301), actor("a", instant.getTime() / 1000 + 1),
      { ...actor(), authMode: "lab" as const }, { ...actor(), issuer: "https://other.test" }]) {
      await expect(startErasure(service, principal, operation, confirm)).rejects.toMatchObject({ status: 401 });
    }
    for (const body of [{}, { confirmAccountDeletion: false }, { ...confirm, actor: "other" }, { ...confirm, adapters: ["keycloak"] }]) {
      await expect(startErasure(service, actor(), operation, body)).rejects.toMatchObject({ status: 400 });
    }
    await expect(startErasure(service, actor(), "not-a-uuid", confirm)).rejects.toMatchObject({ status: 400 });
    expect(await store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    for (const adapter of adapters) expect(adapter.erase).not.toHaveBeenCalled();
  });

  it("keeps capability false and returns503 before fencing for unaccepted/missing/unready adapters", async () => {
    const { options, store, adapters } = setup();
    const candidates = [new AccountErasureService({ ...options, accepted: false }),
      new AccountErasureService({ ...options, adapters: adapters.slice(1) })];
    adapters[0]!.ready.mockResolvedValue(false);
    candidates.push(new AccountErasureService(options));
    for (const service of candidates) {
      expect((await service.capabilities()).accountDeletion).toBe(false);
      await expect(startErasure(service, actor(), operation, confirm)).rejects.toMatchObject({ status: 503 });
    }
    expect(await store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
  });

  it("persists the global tombstone before the first handoff and blocks old JWTs across clients", async () => {
    const { service, adapters, store } = setup();
    adapters[0]!.erase.mockImplementation(async () => {
      await expect(service.assertAllowed({ ...actor(), authTime: undefined, authorizedParty: "csm-mobile" })).rejects.toMatchObject({ status: 403 });
      await expect(service.assertAllowed({ ...actor(), authorizedParty: "cop-web" })).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
      await service.assertAllowed(actor("other-user"));
      return complete();
    });
    const receipt = await startErasure(service, actor(), operation, confirm);
    expect(receipt).toMatchObject({ status: "deleted", accountDeleted: true, remaining: [], revocationEnforced: true });
    const rows = await store.transact([], tx => tx.scan("account-erasure:job:"));
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(actor().subjectId); expect(serialized).not.toContain(issuer);
    expect(serialized).not.toContain("sealedPrincipal");
  });

  it("isolates two actors and retains idempotent receipts without repeating completed cleanup", async () => {
    const { service, adapters } = setup();
    const first = await startErasure(service, actor("first"), operation, confirm);
    expect(await startErasure(service, actor("first"), operation.toUpperCase(), confirm)).toEqual(first);
    await expect(startErasure(service, actor("first"), otherOperation, confirm)).rejects.toMatchObject({ status: 409 });
    await expect(service.read(actor("second"), operation)).rejects.toMatchObject({ status: 404 });
    await service.assertAllowed(actor("second"));
    await startErasure(service, actor("second"), otherOperation, confirm);
    expect((await service.read(actor("second"), otherOperation)).accountDeleted).toBe(true);
    for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(2);
  });

  it("checkpoints completed owners, retains the fence on503 and retries only pending work after restart", async () => {
    const { service, options, adapters, store } = setup();
    adapters[3]!.erase.mockRejectedValueOnce(new Error("private provider credentials must never escape"));
    await expect(startErasure(service, actor(), operation, confirm)).rejects.toMatchObject({ status: 503, code: "ERASURE_ADAPTER_UNAVAILABLE" });
    const pending = await service.read(actor(), operation);
    expect(pending).toMatchObject({ status: "deleting", accountDeleted: false, remaining: ["keycloak", "messaging_matrix"] });
    expect(JSON.stringify(pending)).not.toContain("private provider");
    const rows = await store.transact([], tx => tx.scan("account-erasure:job:"));
    expect(JSON.stringify(rows)).not.toContain(actor().subjectId);
    expect(JSON.stringify(rows)).toContain("sealedPrincipal");
    const restarted = new AccountErasureService(options);
    await expect(restarted.assertAllowed(actor())).rejects.toMatchObject({ status: 403 });
    expect((await startErasure(restarted, actor(), operation, confirm)).accountDeleted).toBe(true);
    for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(adapter.id === "messaging_matrix" ? 2 : 1);
  });

  it("allows trusted worker recovery after login removal without storing OAuth credentials", async () => {
    const { service, options, adapters } = setup();
    adapters[1]!.erase.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" });
    expect((await startErasure(service, actor(), operation, confirm)).accountDeleted).toBe(false);
    const restarted = new AccountErasureService(options);
    await restarted.resumePending();
    expect((await restarted.read(actor(), operation)).accountDeleted).toBe(true);
    expect(adapters[1]!.erase).toHaveBeenCalledTimes(2);
  });

  it("aborts a worker handoff promptly while retaining the fence and pending checkpoint", async () => {
    const { options, adapters } = setup();
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let calls = 0;
    const provider: AccountErasureAdapter = { id: "keycloak", ready: async () => true, preflight: async () => ({ ready: true as const, version: "fixture_preflight_v1" }),
      async erase(_actor, context) {
        if (++calls === 1) return { status: "pending", remaining: "cleanup_pending" };
        enter();
        return new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true }));
      } };
    const service = new AccountErasureService({ ...options, adapters: [provider, ...adapters.slice(1)] });
    await startErasure(service, actor(), operation, confirm);
    const controller = new AbortController(), running = service.resumePending(20, controller.signal);
    await entered; controller.abort(); await running;
    expect(await service.read(actor(), operation)).toMatchObject({ accountDeleted: false, remaining: ["keycloak"] });
    await expect(service.assertAllowed(actor())).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(2);
    for (const adapter of adapters.slice(1)) expect(adapter.erase).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent retries with a durable lease, while accepting only pending receipts before completion", async () => {
    const { service, adapters } = setup();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    adapters[0]!.erase.mockImplementation(async () => { enter(); await released; return complete(); });
    const first = startErasure(service, actor(), operation, confirm);
    await entered;
    const retries = await Promise.all(Array.from({ length: 4 }, () => startErasure(service, actor(), operation, confirm)));
    for (const receipt of retries) expect(receipt).toMatchObject({ status: "deleting", accountDeleted: false });
    expect(adapters[0]!.erase).toHaveBeenCalledTimes(1);
    release(); expect((await first).accountDeleted).toBe(true);
    for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed completion proofs and keeps missing adapter recovery pending", async () => {
    const { service, options, adapters } = setup();
    adapters[2]!.erase.mockResolvedValueOnce({ status: "completed", proofId: "" });
    await expect(startErasure(service, actor(), operation, confirm)).rejects.toMatchObject({ status: 503 });
    const missing = new AccountErasureService({ ...options, adapters: adapters.filter(a => a.id !== "cop_devices") });
    await expect(startErasure(missing, actor(), operation, confirm)).rejects.toMatchObject({ status: 503 });
    expect(await missing.read(actor(), operation)).toMatchObject({ accountDeleted: false, remaining: ["keycloak", "cop_devices"], pendingReasons: { cop_devices: "adapter_missing" } });
    await expect(missing.assertAllowed(actor())).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed when the identity secret changes rather than losing existing fences", async () => {
    const { service, options } = setup();
    await startErasure(service, actor(), operation, confirm);
    const changed = new AccountErasureService({ ...options, allowUnboundSyntheticStore: true, identitySecret: "different-fixture-dedicated-secret-32-characters" });
    await expect(changed.assertAllowed(actor())).rejects.toMatchObject({ status: 503, code: "ERASURE_CONFIGURATION_CHANGED" });
  });

  it("commits terminal state with the last checkpoint and repairs previously interrupted finalization", async () => {
    const { service, options, store, adapters } = setup();
    await startErasure(service, actor(), operation, confirm);
    const rows = await store.transact([], tx => tx.scan<{ completedAt?: string; sealedPrincipal?: string }>("account-erasure:job:"));
    const entry = rows[0]!;
    expect(entry.value.completedAt).toBeDefined(); expect(entry.value.sealedPrincipal).toBeUndefined();
    await store.transact([entry.key], async tx => {
      const job = await tx.get<Record<string, unknown>>(entry.key);
      delete job!.completedAt;
      await tx.set(entry.key, job);
    });
    const restarted = new AccountErasureService(options);
    expect(await restarted.read(actor(), operation)).toMatchObject({ status: "deleted", accountDeleted: true, remaining: [] });
    expect((await store.transact([], tx => tx.get<{ completedAt?: string }>(entry.key)))?.completedAt).toBeDefined();
    for (const adapter of adapters) expect(adapter.erase).toHaveBeenCalledTimes(1);
  });

  it("returnsHTTP202 for a true pending cleanup and200 only after all owner proofs complete", async () => {
    const { service, adapters } = setup();
    adapters[5]!.erase.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" });
    const app = Fastify();
    app.post("/test-erasure", async (_request, reply) => {
      const receipt = await startErasure(service, actor(), operation, confirm);
      return reply.code(receipt.accountDeleted ? 200 : 202).send(receipt);
    });
    try {
      const pending = await app.inject({ method: "POST", url: "/test-erasure" });
      expect(pending.statusCode).toBe(202); expect(pending.json()).toMatchObject({ accountDeleted: false, status: "deleting", remaining: ["keycloak", "cop_content_media"] });
      const finished = await app.inject({ method: "POST", url: "/test-erasure" });
      expect(finished.statusCode).toBe(200); expect(finished.json()).toMatchObject({ accountDeleted: true, status: "deleted", remaining: [] });
    } finally { await app.close(); }
  });
});

async function startErasure(service: AccountErasureService, principal: Parameters<AccountErasureService["request"]>[0], operationId: string, body: unknown) {
  let authorization: { planId: string; capability: string } | undefined;
  try {
    const prepared = await service.preflight(principal, operationId);
    if (prepared.response.planId && prepared.capability) authorization = { planId: prepared.response.planId, capability: prepared.capability };
  } catch (error) { if (!(error instanceof Error) || error.message !== "ERASURE_ALREADY_REQUESTED") throw error; }
  return service.request(principal, operationId, body, authorization);
}
