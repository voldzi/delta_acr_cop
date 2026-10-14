import { describe, expect, it, vi } from "vitest";
import type { AccountErasureAdapter } from "./account-erasure.js";
import { composeCOPDriverConsentErasureAdapter } from "./cop-driver-consent-erasure.js";
import { InMemoryDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";

const issuer = "https://identity.driver-erasure.test/realms/cop", secret = "synthetic-driver-consent-erasure-secret-32-plus";
const owner = { issuer, subjectId: "synthetic-driver-a" }, other = { issuer, subjectId: "synthetic-driver-b" };
const actor = { ...owner, authMode: "oidc" as const, username: "", displayName: "" };
const op = "e4cb3efe-36d8-4929-a769-cb91b9fcd771", now = new Date("2026-10-14T12:00:00Z");
const context = () => ({ accountKey: "synthetic-account-key", operationId: op, requestedAt: now.toISOString(), signal: new AbortController().signal });
function remote() {
  return { id: "sim_measurements" as const, ready: vi.fn(async () => true),
    preflight: vi.fn(async () => ({ ready: true as const, version: "verified_remote_inventory_v1" })),
    erase: vi.fn(async () => ({ status: "completed" as const, proofId: "actual_fixture_manifest_completed_v1" })),
    verifiedCompletedOperationProof: vi.fn(async () => ({ status: "completed" as const, proofId: "actual_fixture_manifest_completed_v1" })) } satisfies AccountErasureAdapter & { verifiedCompletedOperationProof: AccountErasureAdapter["erase"] };
}
async function fixture() {
  const store = new InMemoryDriverMeasurementConsentStore(); await store.init(secret);
  const provider = remote(), adapter = composeCOPDriverConsentErasureAdapter(provider, store, issuer);
  return { store, provider, adapter };
}
describe("COP local consent is part of the actual measurement erasure owner", () => {
  it("does not use an absent local row or unavailable native inventory as a zero-history proof", async () => {
    const f = await fixture(); f.provider.preflight.mockResolvedValue({ ready: false, reason: "adapter_unavailable" } as never);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.erasureCheckpoint(owner, op)).toBeNull(); expect(f.provider.erase).not.toHaveBeenCalled();
    expect(await composeCOPDriverConsentErasureAdapter(f.provider, undefined, issuer).ready()).toBe(false);
  });
  it("leaves unknown historical provenance blocked even after a new verified grant", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now);
    await f.store.grant(owner.subjectId, now, owner);
    expect(await f.adapter.preflight!(actor, context())).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect((await f.store.get(owner.subjectId)).grantedAt).not.toBeNull();
    expect(await f.store.erasureCheckpoint(owner, op)).toBeNull(); expect(f.provider.erase).not.toHaveBeenCalled();
  });
  it("retains fenced consent and immutable pending dates while SIM is pending, then purges only after completed provider proof", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner); await f.store.revoke(owner.subjectId, now, owner);
    await f.store.grant(other.subjectId, now, other);
    const original = await f.store.get(owner.subjectId);
    f.provider.erase.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" } as never);
    expect(await f.adapter.erase(actor, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.get(owner.subjectId)).toEqual(original);
    const checkpoint = await f.store.erasureCheckpoint(owner, op);
    expect(checkpoint).toMatchObject({ completed: false, pendingDays: original.pendingDays, inventoryVersion: "verified_remote_inventory_v1" });
    await expect(f.store.grant(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
    await expect(f.store.revoke(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
    await expect(f.store.markDeleted(owner.subjectId, original.pendingDays[0]!)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
    const restarted = composeCOPDriverConsentErasureAdapter(f.provider, f.store, issuer);
    expect((await restarted.erase(actor, context())).status).toBe("completed");
    expect(await f.store.get(owner.subjectId)).toMatchObject({ grantedAt: null, pendingDays: [] });
    expect((await f.store.erasureCheckpoint(owner, op))?.pendingDays).toEqual([]);
    expect((await f.store.get(other.subjectId)).grantedAt).not.toBeNull();
    await expect(f.store.withActive(owner.subjectId, async () => true, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
  });
  it("cannot cross issuer or operation, change completion proof, or turn local absence into completion without SIM", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner);
    expect((await f.adapter.erase(actor, context())).status).toBe("completed");
    await expect(f.store.erasureCheckpoint({ ...owner, issuer: "https://another.test" }, op)).rejects.toThrow("CONFLICT");
    await expect(f.store.fenceActorErasure(owner, "b0d16a33-3e8d-4a38-9f41-34ce7ad3c855", "inventory_version_v1", "unused_version_after_completion")).rejects.toThrow("CONFLICT");
    expect(await f.store.purgeActorErasure(owner, op, "different_remote_proof_v1")).toBe(false);
    f.provider.verifiedCompletedOperationProof.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" } as never);
    expect((await f.adapter.erase(actor, context())).status).toBe("pending");
  });
  it("waits for an admitted batch before the fence and denies every later local producer", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const active = f.store.withActive(owner.subjectId, async () => { enter(); await held; return "admitted-before-fence"; }, owner);
    await entered;
    let done = false; const erasing = f.adapter.erase(actor, context()).then(result => { done = true; return result; });
    await new Promise(resolve => setImmediate(resolve)); expect(done).toBe(false); expect(f.provider.erase).not.toHaveBeenCalled();
    release(); expect(await active).toBe("admitted-before-fence"); expect((await erasing).status).toBe("completed");
    await expect(f.store.grant(owner.subjectId, now, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
    await expect(f.store.withActive(owner.subjectId, async () => true, owner)).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
  });
  it("rejects a changed local consent version before accepting a remote preflight as current", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner);
    f.provider.preflight.mockImplementationOnce(async () => {
      await f.store.revoke(owner.subjectId, now, owner);
      return { ready: true, version: "old_remote_inventory_v1" };
    });
    expect((await f.adapter.erase(actor, context())).status).toBe("pending");
    expect(await f.store.erasureCheckpoint(owner, op)).toBeNull(); expect(f.provider.erase).not.toHaveBeenCalled();
    expect((await f.store.get(owner.subjectId)).pendingDays).toHaveLength(9);
    expect((await f.adapter.erase(actor, context())).status).toBe("completed");
  });
  it("blocks stale ordinary-cleanup snapshots before their remote handoff", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner); await f.store.revoke(owner.subjectId, now, owner);
    const snapshot = (await f.store.pending())[0]!;
    const assessed = await f.store.preflightActorErasure(owner);
    await f.store.fenceActorErasure(owner, op, "verified_inventory_v1", assessed.version);
    const deletion = vi.fn(async () => undefined);
    expect(await f.store.pending()).toEqual([]);
    expect(await f.store.withPendingDeletion(snapshot.subjectId, snapshot.days[0]!, deletion)).toBe(false);
    expect(deletion).not.toHaveBeenCalled();
  });
  it("uses a fresh matching GET proof after clearing dates and never rebuilds or posts the completed manifest", async () => {
    const f = await fixture(); await f.store.grant(owner.subjectId, now, owner); await f.store.revoke(owner.subjectId, now, owner);
    const initial = await f.adapter.erase(actor, context()); expect(initial.status).toBe("completed");
    f.provider.ready.mockResolvedValue(false);
    const retried = composeCOPDriverConsentErasureAdapter(f.provider, f.store, issuer);
    expect(await retried.readyForAcceptedOperation!(actor, context())).toBe(true);
    expect(await retried.erase(actor, context())).toEqual(initial);
    expect(f.provider.erase).toHaveBeenCalledTimes(1);
    f.provider.verifiedCompletedOperationProof.mockResolvedValueOnce({ status: "completed", proofId: "a_different_readback_proof_v2" });
    expect((await retried.erase(actor, context())).status).toBe("pending");
  });
});
