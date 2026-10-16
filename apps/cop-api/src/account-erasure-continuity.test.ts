import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter, type AccountErasureProof } from "./account-erasure.js";
import type { AccountErasureContinuity, AccountErasureDatasetBinding, AccountErasureFenceEntry } from "./account-erasure-continuity.js";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const instant = new Date("2026-10-15T10:00:00.000Z"), storeId = "c9b98553-9dd0-4dc8-9db9-51bf1ad4c9dc";
const operationId = "608bf235-2504-412a-894c-9194e28696de", issuer = "https://identity.test/cop";
const secret = "synthetic-continuity-key-with-more-than-32-characters";
const actor: AuthenticatedActor = { issuer, subjectId: "synthetic-first", authMode: "oidc", username: "", displayName: "", authTime: instant.getTime() / 1000 };
const fingerprint = createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret).digest("hex");
// Explicitly synthetic port: these tests exercise the controller, not Root authority.
class SyntheticJournal implements AccountErasureContinuity {
  requiresDatasetBinding?: true;
  datasetBinding?: AccountErasureDatasetBinding;
  entries: AccountErasureFenceEntry[] = [];
  unavailable = false;
  head = { sequence: 0, digest: "0".repeat(64) };
  async snapshot() {
    if (this.unavailable) throw new Error("synthetic outage");
    return structuredClone({ contractVersion: "cop-erasure-replay-v1" as const, applicationStoreId: storeId,
      configurationFingerprint: fingerprint, frontier: this.head, entries: this.entries,
      ...(this.datasetBinding !== undefined ? { datasetBinding: this.datasetBinding } : {}) });
  }
  async assertCurrent(frontier: typeof this.head) {
    if (this.unavailable || JSON.stringify(frontier) !== JSON.stringify(this.head)) throw new Error("synthetic stale frontier");
    return { validUntil: new Date(instant.getTime() + 5000).toISOString() };
  }
  async publishFence(entry: AccountErasureFenceEntry) {
    if (this.unavailable) throw new Error("synthetic outage");
    const original = this.entries.find(e => e.accountKey === entry.accountKey);
    if (!original) {
      this.entries.push(structuredClone(entry));
      this.head = { sequence: this.head.sequence + 1, digest: createHash("sha256").update(JSON.stringify(this.entries)).digest("hex") };
    }
    return structuredClone({ frontier: this.head, entry: original ?? entry });
  }
}
class InterruptedStore extends MemoryMobilityStore {
  failFence = false;
  override transact<T>(keys: string[], run: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
    return super.transact(keys, tx => run({ ...tx, set: async (key, value) => {
      if (this.failFence && key.startsWith("account-erasure:job:")) { this.failFence = false; throw new Error("synthetic lost local commit"); }
      await tx.set(key, value);
    } }));
  }
}
async function setup() {
  const store = new InterruptedStore(), journal = new SyntheticJournal();
  await store.transact([], tx => tx.set("account-safety:store-identity-v1", { storeId }));
  const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true,
    preflight: async () => ({ ready: true as const, version: "synthetic_preflight" }),
    erase: vi.fn(async (..._args: Parameters<AccountErasureAdapter["erase"]>): Promise<AccountErasureProof> =>
      ({ status: "completed", proofId: "synthetic_proof" })) }));
  const options = { store, identitySecret: secret, issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters,
    accepted: true, expectedGuardStoreId: storeId, continuityRequired: true, continuity: journal, now: () => instant };
  return { store, journal, adapters, options, service: new AccountErasureService(options) };
}
async function start(service: AccountErasureService) {
  const plan = await service.preflight(actor, operationId);
  return service.request(actor, operationId, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! });
}
describe("independent fence controller recovery", () => {
  it("requires the configured bridge and never silently uses legacy version3", async () => {
    const { options, store } = await setup();
    await expect(new AccountErasureService({ ...options, continuity: undefined }).init()).rejects.toMatchObject({ status: 503 });
    await new AccountErasureService({ ...options, continuity: undefined, continuityRequired: false }).init();
    await expect(new AccountErasureService(options).init()).rejects.toMatchObject({ code: "ERASURE_CONFIGURATION_UNSUPPORTED" });
    expect(await store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
  });
  it("journals before local commit; a lost local transaction is replayed with original job before admitting writers", async () => {
    const { service, store, journal, adapters, options } = await setup();
    const plan = await service.preflight(actor, operationId);
    store.failFence = true;
    await expect(service.request(actor, operationId, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! })).rejects.toMatchObject({ status: 503 });
    expect(journal.entries).toHaveLength(1);
    expect(await store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    adapters.forEach(a => expect(a.erase).not.toHaveBeenCalled());
    const recovered = new AccountErasureService(options);
    await expect(recovered.assertAllowed(actor)).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    await recovered.assertAllowed({ ...actor, subjectId: "synthetic-second" });
    const rows = await store.transact([], tx => tx.scan("account-erasure:job:"));
    expect(rows[0]!.value).toEqual(journal.entries[0]!.job);
    expect(JSON.stringify(journal.entries)).not.toContain("sealedPrincipal");
    // A background worker cannot guess the missing account identity after loss.
    await recovered.resumePending(); adapters.forEach(a => expect(a.erase).not.toHaveBeenCalled());
    expect((await recovered.read(actor, operationId)).accountDeleted).toBe(false);
    await recovered.resumePending();
    expect((await recovered.read(actor, operationId)).accountDeleted).toBe(true);
    expect(journal.entries[0]!.job.requestedAt).toBe(instant.toISOString());
  });
  it("outage or advanced frontier blocks capability, reads, workers and both writer guards", async () => {
    const { service, journal, store, adapters } = await setup();
    await service.init();
    journal.head = { sequence: 1, digest: "1".repeat(64) };
    await expect(service.assertAllowed(actor)).rejects.toMatchObject({ code: "ERASURE_CONTINUITY_UNAVAILABLE" });
    expect(service.cachedGuardReady()).toBe(false);
    expect(() => service.assertCachedActorAllowed({ issuer, subjectId: actor.subjectId! })).toThrow();
    journal.unavailable = true;
    expect((await service.capabilities()).accountDeletion).toBe(false);
    await expect(service.read(actor, operationId)).rejects.toMatchObject({ status: 503 });
    await expect(service.resumePending()).rejects.toMatchObject({ status: 503 });
    await expect(store.transact([], tx => service.assertAllowedWithin(tx, actor))).rejects.toMatchObject({ status: 503 });
    adapters.forEach(a => expect(a.erase).not.toHaveBeenCalled());
  });
  it("rejects changed actor, store, malformed or duplicate replay entries before local import", async () => {
    const { service, journal } = await setup();
    await start(service);
    for (const mutate of [
      (e: AccountErasureFenceEntry) => { e.accountKey = "invalid"; },
      (e: AccountErasureFenceEntry) => { e.applicationStoreId = operationId; },
      (e: AccountErasureFenceEntry) => { e.job.requestedAt = "invalid"; },
      (e: AccountErasureFenceEntry) => { Object.assign(e.job, { sealedPrincipal: "forbidden" }); }
    ]) {
      const next = await setup();
      next.journal.entries = structuredClone(journal.entries); mutate(next.journal.entries[0]!);
      await expect(next.service.init()).rejects.toMatchObject({ status: 503 });
      expect(await next.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    }
    const duplicate = await setup(); duplicate.journal.entries = [journal.entries[0]!, journal.entries[0]!];
    await expect(duplicate.service.init()).rejects.toMatchObject({ status: 503 });
  });
  it("does not reset completed checkpoints on restart or repeat provider effects", async () => {
    const { service, options, adapters } = await setup();
    expect((await start(service)).accountDeleted).toBe(true);
    const restarted = new AccountErasureService(options);
    await restarted.resumePending();
    expect((await restarted.read(actor, operationId)).accountDeleted).toBe(true);
    adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(1));
  });
  it("requires actual dataset identity from a database-mode continuity port", async () => {
    const { journal, service, store } = await setup();
    journal.requiresDatasetBinding = true;
    await expect(service.init()).rejects.toMatchObject({ code: "ERASURE_REPLAY_UNPROVEN" });
    expect(await store.transact([], tx => tx.get("account-erasure:configuration-v1"))).toBeUndefined();
  });
  it("keeps same-dataset restart idempotent but invalidates all copied completion after an enrolled restore", async () => {
    const { options, journal, service, adapters, store } = await setup();
    journal.requiresDatasetBinding = true;
    journal.datasetBinding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    expect((await start(service)).accountDeleted).toBe(true);
    const restarted = new AccountErasureService(options);
    await restarted.resumePending();
    expect((await restarted.read(actor, operationId)).accountDeleted).toBe(true);
    adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(1));
    journal.datasetBinding = { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 2 };
    const restored = new AccountErasureService(options);
    await restored.init();
    await restored.resumePending(); // A completed operation has no retained sealed identity to guess.
    adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(1));
    const jobs = await store.transact([], tx => tx.scan<Record<string, unknown>>("account-erasure:job:"));
    expect(jobs[0]!.value).toMatchObject({ operationId, requestedAt: instant.toISOString(), checkpoints: {} });
    expect(jobs[0]!.value.completedAt).toBeUndefined();
    expect(jobs[0]!.value.sealedPrincipal).toBeUndefined();
    const pending = await restored.read(actor, operationId); // Fresh, verified original actor only.
    expect(pending.accountDeleted).toBe(false);
    expect(pending.remaining).toEqual([...ACCOUNT_ERASURE_ADAPTER_IDS]);
    await restored.resumePending();
    expect((await restored.read(actor, operationId)).accountDeleted).toBe(true);
    adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(2));
    expect(journal.entries[0]!.job.checkpoints).toEqual({});
  });
  it("denies generation rewind, reused incarnation and dropped binding without accepting old completion", async () => {
    for (const changed of [
      undefined,
      { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 1 },
      { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 2 },
      { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 0 }
    ]) {
      const { options, journal, service, adapters, store } = await setup();
      journal.requiresDatasetBinding = true;
      journal.datasetBinding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
      await start(service);
      const before = await store.transact([], tx => tx.scan("account-erasure:"));
      journal.datasetBinding = changed;
      await expect(new AccountErasureService(options).init()).rejects.toMatchObject({ status: 503 });
      expect(await store.transact([], tx => tx.scan("account-erasure:"))).toEqual(before);
      adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(1));
    }
  });
  it("passes the actual recovery binding to each owner without sharing a mutable object", async () => {
    const { service, journal, adapters } = await setup();
    const binding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    journal.requiresDatasetBinding = true; journal.datasetBinding = structuredClone(binding);
    const seen: unknown[] = [];
    adapters[1]!.erase.mockImplementation(async (_actor, context) => {
      seen.push(structuredClone(context.datasetBinding));
      context.datasetBinding!.restoreGeneration = 99;
      return { status: "completed", proofId: "synthetic_proof" };
    });
    expect((await start(service)).accountDeleted).toBe(true);
    expect(seen).toEqual([binding]);
    for (const adapter of adapters.filter((_, index) => index !== 1))
      expect(adapter.erase.mock.calls[0]![1].datasetBinding).toEqual(binding);
    expect(journal.datasetBinding).toEqual(binding);
  });
  it("does not adopt unbound historical completion when switching to dataset-bound authority", async () => {
    const { service, journal, options, store, adapters } = await setup();
    await start(service);
    const before = await store.transact([], tx => tx.scan("account-erasure:"));
    journal.requiresDatasetBinding = true;
    journal.datasetBinding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    await expect(new AccountErasureService(options).init()).rejects.toMatchObject({ code: "ERASURE_DATASET_HISTORY_UNPROVEN" });
    expect(await store.transact([], tx => tx.scan("account-erasure:"))).toEqual(before);
    adapters.forEach(a => expect(a.erase).toHaveBeenCalledTimes(1));
  });
  it("replays an interrupted original actor after restore without adopting another identity", async () => {
    const { service, options, journal, adapters } = await setup();
    journal.requiresDatasetBinding = true;
    journal.datasetBinding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    adapters[0]!.erase.mockResolvedValue({ status: "pending", remaining: "cleanup_pending" });
    expect((await start(service)).accountDeleted).toBe(false);
    journal.datasetBinding = { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 2 };
    adapters[0]!.erase.mockResolvedValue({ status: "completed", proofId: "fresh_synthetic_proof" });
    const restored = new AccountErasureService(options);
    await restored.resumePending();
    expect((await restored.read(actor, operationId)).accountDeleted).toBe(true);
    for (const adapter of adapters) for (const call of adapter.erase.mock.calls) {
      // Effects always use the same verified actor; journal metadata is never
      // guessed into a new identity or a new deletion operation.
      expect(call[0]).toMatchObject({ issuer, subjectId: actor.subjectId });
      expect(call[1]).toMatchObject({ operationId, requestedAt: instant.toISOString() });
    }
  });
  it("rejects a valid encrypted principal copied from another account before restore writes", async () => {
    const a = await setup(), b = await setup();
    const other = { ...actor, subjectId: "synthetic-other-owner" };
    a.journal.requiresDatasetBinding = true;
    a.journal.datasetBinding = { incarnationId: "10000000-0000-4000-8000-000000000001", restoreGeneration: 1 };
    a.adapters[0]!.erase.mockResolvedValue({ status: "pending", remaining: "cleanup_pending" });
    b.adapters[0]!.erase.mockResolvedValue({ status: "pending", remaining: "cleanup_pending" });
    await start(a.service);
    const plan = await b.service.preflight(other, operationId);
    await b.service.request(other, operationId, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! });
    const foreign = await b.store.transact([], tx => tx.scan<{ sealedPrincipal: string }>("account-erasure:job:"));
    await a.store.transact([], async tx => {
      const [row] = await tx.scan<Record<string, unknown>>("account-erasure:job:");
      await tx.set(row!.key, { ...row!.value, sealedPrincipal: foreign[0]!.value.sealedPrincipal });
    });
    const before = await a.store.transact([], tx => tx.scan("account-erasure:"));
    const calls = a.adapters.map(adapter => adapter.erase.mock.calls.length);
    a.journal.datasetBinding = { incarnationId: "20000000-0000-4000-8000-000000000001", restoreGeneration: 2 };
    await expect(new AccountErasureService(a.options).init()).rejects.toMatchObject({ code: "ERASURE_PRINCIPAL_INVALID" });
    expect(await a.store.transact([], tx => tx.scan("account-erasure:"))).toEqual(before);
    a.adapters.forEach((adapter, index) => expect(adapter.erase).toHaveBeenCalledTimes(calls[index]!));
  });
  it("expires the synchronous RAM guard and cannot guess an identity during background replay", async () => {
    const { options, journal } = await setup(); let now = instant;
    const service = new AccountErasureService({ ...options, now: () => now });
    await service.init(); expect(service.cachedGuardReady()).toBe(true);
    now = new Date(instant.getTime() + 5001);
    expect(service.cachedGuardReady()).toBe(false);
    expect(() => service.assertCachedActorAllowed({ issuer, subjectId: "synthetic-second" })).toThrow();
    await expect(service.assertAllowed({ ...actor, subjectId: "synthetic-second" })).rejects.toMatchObject({ status: 503 });
    expect(journal.entries).toEqual([]);
  });
});
