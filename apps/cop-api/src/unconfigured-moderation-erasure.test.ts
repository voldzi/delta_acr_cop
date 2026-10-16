import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { COMMUNICATION_RETENTION_POLICY_ID, CommunicationSafetyService } from "./communication-safety.js";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import { createUnconfiguredModerationErasureAdapter } from "./unconfigured-moderation-erasure.js";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";

const issuer = "https://synthetic.identity.test/cop";
const actor = (subjectId: string): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, username: "Synthetic", displayName: "Synthetic" });
const a = actor("a"), b = actor("b");
const owner = (value: AuthenticatedActor) => createHash("sha256").update(JSON.stringify([value.issuer, value.subjectId])).digest("hex");
const fenceKey = (value: AuthenticatedActor) => "communication-safety:erasure-fence:" + owner(value);
const context = () => ({ operationId: randomUUID(), accountKey: "a".repeat(64), requestedAt: "2026-10-16T00:00:00.000Z", signal: new AbortController().signal });
function fixture(store = new MemoryMobilityStore()) {
  const confirmed = vi.fn(async (_actor: AuthenticatedActor, _context: { accountKey: string; operationId: string }) => true);
  return { store, confirmed, adapter: createUnconfiguredModerationErasureAdapter({ store, issuer, assertCopAccessFenced: confirmed }) };
}
const reporting = (store: MemoryMobilityStore) => new CommunicationSafetyService({ store, encryptionSecret: "synthetic-reporting-secret-at-least32characters",
  policy: { block: async () => true, directAllowed: async () => true, eventMatchesPeer: async () => true }, validateTarget: async () => ({ peerIssuer: issuer }),
  moderatorRole: "synthetic-moderator", contactEmail: "synthetic@example.test", retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID });
const report = { target: { kind: "user" as const, peerSubjectId: "peer", conversationId: "synthetic-conversation" }, reason: "spam" as const };

describe("proven empty unconfigured moderation owner", () => {
  it("proves absence, records a compatible permanent fence and repeats exactly without introducing reporting configuration", async () => {
    const f = fixture(), op = context();
    expect(await f.adapter.ready()).toBe(true);
    expect(await f.adapter.preflight!(a, op)).toMatchObject({ ready: true });
    const erased = await f.adapter.erase(a, op); expect(erased.status).toBe("completed");
    expect(await f.adapter.erase(a, op)).toEqual(erased);
    expect(await f.store.transact([], tx => tx.scan("communication-safety:"))).toEqual([{ key: fenceKey(a), value: { operationId: op.operationId, proofId: "proofId" in erased ? erased.proofId : undefined } }]);
  });
  it("participates in the real controller preflight and rejects data appearing before confirmation", async () => {
    const f = fixture(), op = context(), now = new Date(op.requestedAt);
    const verifiedActor = { ...a, authTime: Math.floor(now.getTime() / 1000) };
    const controller = new AccountErasureService({ store: f.store, issuer,
      identitySecret: "synthetic-moderation-controller-secret-at-least32",
      requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, accepted: true, allowUnboundSyntheticStore: true, now: () => now,
      adapters: ACCOUNT_ERASURE_ADAPTER_IDS.map(id => id === "moderation_audit" ? f.adapter : {
        id, ready: async () => true, preflight: async () => ({ ready: true as const, version: "synthetic-other-domain" }),
        erase: async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const })
      }) });
    const plan = await controller.preflight(verifiedActor, op.operationId);
    expect(plan.response.canConfirm).toBe(true);
    expect(plan.response.blockers).toEqual([]);
    await f.store.transact([], tx => tx.set("communication-safety:unknown:late", { retained: true }));
    await expect(controller.request(verifiedActor, op.operationId, { confirmAccountDeletion: true },
      { planId: plan.response.planId!, capability: plan.capability! })).rejects.toMatchObject({ code: "ERASURE_NOT_READY" });
    expect(await f.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    expect(await f.store.transact([], tx => tx.get("communication-safety:unknown:late"))).toEqual({ retained: true });
  });
  it.each(["configuration-v1", "report:legacy", "operation:legacy", "rate:legacy", "pending-index", "report-count", "unknown:legacy"])("blocks latent %s data even with reporting off", async suffix => {
    const f = fixture(); await f.store.transact([], tx => tx.set("communication-safety:" + suffix, { synthetic: "latent" }));
    const before = await f.store.transact([], tx => tx.scan("communication-safety:"));
    expect(await f.adapter.ready()).toBe(false);
    expect(await f.adapter.preflight!(a, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(await f.adapter.erase(a, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.transact([], tx => tx.scan("communication-safety:"))).toEqual(before);
  });
  it("accepts only exact valid pre-existing fence shapes and preserves B and unrelated application rows", async () => {
    const f = fixture(), bFence = { operationId: randomUUID(), proofId: randomUUID() };
    await f.store.transact([], async tx => { await tx.set(fenceKey(b), bFence); await tx.set("unrelated:synthetic", { retained: true }); });
    expect(await f.adapter.ready()).toBe(true); expect(await f.adapter.erase(a, context())).toMatchObject({ status: "completed" });
    expect(await f.store.transact([], tx => tx.get(fenceKey(b)))).toEqual(bFence);
    expect(await f.store.transact([], tx => tx.get("unrelated:synthetic"))).toEqual({ retained: true });
    await f.store.transact([], tx => tx.set(fenceKey(b), { ...bFence, rawIdentity: "synthetic-extra" }));
    expect(await f.adapter.ready()).toBe(false);
  });
  it("rejects wrong actor, operation and absent real global fence before a domain write", async () => {
    const f = fixture(), op = context();
    for (const wrong of [{ ...a, issuer: "https://foreign.identity.test/cop" }, { ...a, authMode: "lab" as const }, { ...a, subjectId: "" }])
      await expect(f.adapter.erase(wrong, op)).rejects.toMatchObject({ status: 401 });
    await expect(f.adapter.erase(a, { ...op, operationId: "unbound-operation" })).rejects.toMatchObject({ status: 503 });
    f.confirmed.mockResolvedValue(false); await expect(f.adapter.erase(a, op)).rejects.toMatchObject({ status: 503 });
    expect(await f.store.transact([], tx => tx.scan("communication-safety:"))).toEqual([]);
    f.confirmed.mockResolvedValue(true); await f.adapter.erase(a, op);
    await expect(f.adapter.erase(a, { ...op, operationId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("binds the callback to the actual actor and operation and can assess inside the existing transaction", async () => {
    const f = fixture(), op = context();
    expect(await f.store.transact([], tx => f.adapter.preflightWithin!(a, { transaction: tx, signal: op.signal, operationId: op.operationId }))).toMatchObject({ ready: true });
    await f.adapter.erase(a, op); expect(f.confirmed).toHaveBeenCalledWith(a, { accountKey: op.accountKey, operationId: op.operationId });
  });
  it("snapshots actor and operation before an asynchronous global-fence review", async () => {
    const f = fixture(), mutable = actor("a"), op = context(), originalOperation = op.operationId;
    let release!: () => void;
    f.confirmed.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    const erasing = f.adapter.erase(mutable, op);
    while (!release) await Promise.resolve();
    mutable.subjectId = "b"; op.operationId = randomUUID(); op.accountKey = "b".repeat(64); release();
    expect(await erasing).toMatchObject({ status: "completed" });
    expect(await f.store.transact([], tx => tx.get(fenceKey(a)))).toMatchObject({ operationId: originalOperation });
    expect(await f.store.transact([], tx => tx.get(fenceKey(b)))).toBeUndefined();
  });
  it("future explicitly configured reporting honors A's fence while B can submit", async () => {
    const f = fixture(); await f.adapter.erase(a, context()); const service = reporting(f.store);
    await expect(service.submit(a, report, "synthetic-late-a")).rejects.toMatchObject({ status: 403 });
    expect(await service.submit(b, report, "synthetic-b")).toMatchObject({ status: "submitted" });
    expect(await f.adapter.ready()).toBe(false);
  });
  it("does not complete if a serialized old writer commits latent data before its absence check", async () => {
    const f = fixture(); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const legacy = f.store.transact([], async tx => { entered(); await hold; await tx.set("communication-safety:pending-index", []); });
    await started; const erasing = f.adapter.erase(a, context()); release(); await legacy;
    expect(await erasing).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.transact([], tx => tx.get("communication-safety:pending-index"))).toEqual([]);
  });
  it("normalizes store failures, rolls back unproven readback and never records proof after cancellation", async () => {
    class FaultStore extends MemoryMobilityStore {
      fail = true;
      override transact<T>(keys: string[], run: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
        return super.transact(keys, tx => run({ ...tx, get: async <V>(key: string) => {
          const value = await tx.get<V>(key); if (this.fail && key.startsWith("communication-safety:erasure-fence:") && value) throw Error("SYNTHETIC_PRIVATE_ERROR"); return value;
        } }));
      }
    }
    const store = new FaultStore(), f = fixture(store), op = context();
    await expect(f.adapter.erase(a, op)).rejects.toMatchObject({ status: 503, message: "UNCONFIGURED_MODERATION_UNAVAILABLE" });
    expect(await store.transact([], tx => tx.scan("communication-safety:"))).toEqual([]);
    store.fail = false; const cancelled = AbortSignal.abort(); await expect(f.adapter.erase(a, { ...op, signal: cancelled })).rejects.toBeDefined();
    expect(await store.transact([], tx => tx.scan("communication-safety:"))).toEqual([]);
    expect(await f.adapter.erase(a, op)).toMatchObject({ status: "completed" });
  });
});
