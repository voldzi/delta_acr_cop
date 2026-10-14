import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { createCOPSessionsProfilesErasureAdapter } from "./cop-sessions-profiles-erasure.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
const issuer = "https://identity.preflight.test", operation = "b95832cf-1130-4a73-8644-38a3a460a638";
function fixture() {
  let clock = Date.parse("2026-10-13T12:00:00Z");
  const store = new MemoryMobilityStore();
  const actor = { authMode: "oidc" as const, issuer, subjectId: "synthetic-a", username: "", displayName: "", authTime: clock / 1000 };
  const adapters: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true,
    preflight: async () => ({ ready: true, version: "synthetic_version_v1" }),
    erase: vi.fn(async () => ({ status: "completed" as const, proofId: "synthetic_proof_v1" })) }));
  const options = { store, issuer, identitySecret: "synthetic-account-erasure-secret-only-32-plus", allowUnboundSyntheticStore: true, accepted: true, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, now: () => new Date(clock) };
  return { store, actor, adapters, options, service: new AccountErasureService(options), advance: (ms: number) => { clock += ms; } };
}
async function start(f: ReturnType<typeof fixture>, actor = f.actor, operationId = operation) {
  const p = await f.service.preflight(actor, operationId);
  return { capability: p.capability!, receipt: await f.service.request(actor, operationId, { confirmAccountDeletion: true }, { planId: p.response.planId!, capability: p.capability! }) };
}
describe("actor-aware erasure preflight and independent receipt", () => {
  it("rejects a local ownership change under the final fence transaction", async () => {
    const f = fixture(), adapter = f.adapters.find(a => a.id === "mobility_dispatch")!;
    await f.store.transact([], tx => tx.set("synthetic-impact", "impact_version_v1"));
    adapter.preflight = async () => ({ ready: true, version: "synthetic_remote_v1", transactionVersion: "impact_version_v1" });
    adapter.preflightWithin = async (_actor, context) => ({ ready: true, version: (await context.transaction.get<string>("synthetic-impact"))! });
    const p = await f.service.preflight(f.actor, operation);
    // The ordinary provider probe remains unchanged; only the same-transaction
    // impact CAS can detect the admitted write before accepting a global fence.
    await f.store.transact([], tx => tx.set("synthetic-impact", "impact_version_v2"));
    await expect(f.service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: p.response.planId!, capability: p.capability! })).rejects.toMatchObject({ status: 409 });
    await f.service.assertAllowed(f.actor);
    expect(await f.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    for (const a of f.adapters) expect(a.erase).not.toHaveBeenCalled();
  });
  it("reassesses and commits the global fence inside the actual admission hook, then releases it before provider erasure", async () => {
    const f = fixture(); let held = false, guardedProbes = 0;
    const admissionGuard = { async run<T>(_actor: unknown, _signal: AbortSignal, run: () => Promise<T>) { held = true; try { return await run(); } finally { held = false; } } };
    f.adapters[2]!.preflight = async () => { if (held) guardedProbes++; return { ready: true, version: "synthetic_version_v1" }; };
    f.adapters[2]!.erase = vi.fn(async () => { expect(held).toBe(false); return { status: "completed" as const, proofId: "synthetic_proof_v1" }; });
    const service = new AccountErasureService({ ...f.options, admissionGuard });
    expect(service.usesAdmissionGuard(admissionGuard)).toBe(true);
    const p = await service.preflight(f.actor, operation);
    expect((await service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: p.response.planId!, capability: p.capability! })).accountDeleted).toBe(true);
    expect(guardedProbes).toBe(1); expect(held).toBe(false);
    await expect(f.store.transact([], tx => service.assertAllowedWithin(tx, f.actor))).rejects.toMatchObject({ status: 403 });
  });
  it("does not fence an unresolved owner or unsupported custom preflight", async () => {
    const f = fixture(); delete f.adapters[2]!.preflight;
    f.adapters[1]!.preflight = async () => ({ ready: false, reason: "ownership_unresolved" });
    const p = await f.service.preflight(f.actor, operation);
    expect(p.response.canConfirm).toBe(false); expect(p.capability).toBeUndefined();
    expect(p.response.blockers).toContainEqual({ domain: "cop_sessions_profiles", reason: "ownership_unresolved" });
    await f.service.assertAllowed(f.actor);
    expect(await f.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    for (const a of f.adapters) expect(a.erase).not.toHaveBeenCalled();
  });
  it("rejects missing, expired and changed plans before a permanent fence", async () => {
    const f = fixture(); const p = await f.service.preflight(f.actor, operation);
    await expect(f.service.request(f.actor, operation, { confirmAccountDeletion: true })).rejects.toMatchObject({ code: "ERASURE_PREFLIGHT_REQUIRED" });
    f.adapters[2]!.preflight = async () => ({ ready: true, version: "changed_version_v2" });
    await expect(f.service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: p.response.planId!, capability: p.capability! })).rejects.toMatchObject({ code: "ERASURE_PLAN_EXPIRED_OR_CHANGED" });
    f.advance(300001); const fresh = { ...f.actor, authTime: Math.floor(f.options.now().getTime() / 1000) };
    await expect(f.service.request(fresh, operation, { confirmAccountDeletion: true }, { planId: p.response.planId!, capability: p.capability! })).rejects.toMatchObject({ status: 409 });
    await f.service.assertAllowed(fresh);
  });
  it("keeps capability hash-only, isolated and usable without the removed login", async () => {
    const f = fixture(); f.adapters[7]!.erase = async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const });
    const { receipt, capability } = await start(f);
    expect(receipt.accountDeleted).toBe(false);
    const persisted = JSON.stringify(await f.store.transact([], tx => tx.scan("account-erasure:")));
    expect(persisted).not.toContain(capability); expect(persisted).not.toContain(f.actor.subjectId);
    const otherOperation = "bc8c341b-b4f6-4f4d-9e45-f8ad154e89e5";
    const other = await start(f, { ...f.actor, subjectId: "synthetic-b" }, otherOperation);
    expect((await f.service.readWithCapability(otherOperation, other.capability)).operationId).toBe(otherOperation);
    await expect(f.service.readWithCapability(operation, other.capability)).rejects.toMatchObject({ status: 401 });
    f.advance(301000);
    await expect(f.service.read(f.actor, operation)).rejects.toMatchObject({ code: "FRESH_AUTH_REQUIRED" });
    expect(await f.service.readWithCapability(operation, capability)).toEqual(receipt);
    await expect(f.service.readWithCapability("bc8c341b-b4f6-4f4d-9e45-f8ad154e89e5", capability)).rejects.toMatchObject({ status: 401 });
    await expect(f.service.readWithCapability(operation, "x".repeat(43))).rejects.toMatchObject({ status: 401 });
    f.advance(30 * 86400000);
    await expect(f.service.readWithCapability(operation, capability)).rejects.toMatchObject({ status: 401 });
  });
  it("repeated preflight replaces its plan and revokes the prior read capability without fencing", async () => {
    const f = fixture(), first = await f.service.preflight(f.actor, operation), second = await f.service.preflight(f.actor, operation);
    expect(second.response.planId).not.toBe(first.response.planId);
    await expect(f.service.readWithCapability(operation, first.capability!)).rejects.toMatchObject({ status: 401 });
    await expect(f.service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: first.response.planId!, capability: first.capability! })).rejects.toMatchObject({ status: 409 });
    await f.service.assertAllowed(f.actor);
  });
  it("waits for every nonidentity proof and continues accepted work after intake is off", async () => {
    const f = fixture(); const pending = f.adapters[7]!;
    pending.erase = vi.fn(async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }));
    const { capability } = await start(f);
    expect(f.adapters[0]!.erase).not.toHaveBeenCalled();
    pending.erase = vi.fn(async () => ({ status: "completed" as const, proofId: "synthetic_proof_v1" }));
    const restarted = new AccountErasureService({ ...f.options, accepted: false });
    await restarted.resumePending();
    expect((await restarted.readWithCapability(operation, capability)).accountDeleted).toBe(true);
    expect(f.adapters[0]!.erase).toHaveBeenCalledTimes(1);
  });
  it("uses accepted-operation readiness only after a durable confirmed job, while new intake stays unavailable", async () => {
    const f = fixture(), adapter = f.adapters.find(value => value.id === "ai_router")!;
    adapter.erase = vi.fn(async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }));
    adapter.readyForAcceptedOperation = vi.fn(async (actor, context) => {
      expect(actor.subjectId).toBe(f.actor.subjectId); expect(context.operationId).toBe(operation);
      expect(await f.service.operationFenceConfirmed(actor, context)).toBe(true);
      return true;
    });
    const plan = await f.service.preflight(f.actor, operation);
    expect(adapter.readyForAcceptedOperation).not.toHaveBeenCalled();
    await f.service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! });
    adapter.ready = async () => false;
    expect((await f.service.capabilities()).accountDeletion).toBe(false);
    const other = { ...f.actor, subjectId: "synthetic-other-unconfirmed" };
    expect((await f.service.preflight(other, "54b48135-0f3d-4a69-80e3-f076e17b1509")).response.canConfirm).toBe(false);
    adapter.erase = vi.fn(async () => ({ status: "completed" as const, proofId: "accepted_existing_provider_proof" }));
    await f.service.resumePending();
    expect(adapter.readyForAcceptedOperation).toHaveBeenCalledTimes(2);
    expect(adapter.erase).toHaveBeenCalledTimes(1);
    expect((await f.service.readWithCapability(operation, plan.capability!)).accountDeleted).toBe(true);
    await f.service.assertAllowed(other);
  });
  it("does not erase an accepted job when its operation-specific authority is unavailable", async () => {
    const f = fixture(), adapter = f.adapters.find(value => value.id === "ai_router")!;
    adapter.erase = vi.fn(async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }));
    const started = await start(f);
    adapter.erase = vi.fn(async () => ({ status: "completed" as const, proofId: "must_not_be_used_proof" }));
    adapter.readyForAcceptedOperation = async () => false;
    await f.service.resumePending();
    expect(adapter.erase).not.toHaveBeenCalled();
    expect(await f.service.readWithCapability(operation, started.capability)).toMatchObject({ accountDeleted: false, remaining: ["keycloak", "ai_router"] });
  });
  it("rotates beyond persistently pending jobs instead of starving later jobs", async () => {
    const f = fixture(); f.adapters[7]!.erase = vi.fn(async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }));
    const principals = Array.from({ length: 4 }, (_, index) => ({ ...f.actor, subjectId: "synthetic-" + index }));
    for (const principal of principals) { await start(f, principal); f.advance(1000); }
    const seen: string[] = []; f.adapters[7]!.erase = vi.fn(async principal => { seen.push(principal.subjectId); return { status: "pending" as const, remaining: "cleanup_pending" as const }; });
    await f.service.resumePending(2); f.advance(1000); await f.service.resumePending(2);
    expect(new Set(seen).size).toBe(4);
  });
  it("actual local preflight reads legacy provenance without deleting or fencing", async () => {
    const profiles = new InMemoryUserProfileStore(), sessions = new InMemoryWebSessionStore(), f = fixture();
    const profile = { subjectId: f.actor.subjectId, displayName: "Synthetic", username: "synthetic", preferences: {}, alertPreferences: {}, updatedAt: new Date().toISOString() };
    await profiles.upsertProfile(profile);
    const adapter = createCOPSessionsProfilesErasureAdapter({ issuer, sessions, profiles: [profiles] });
    expect(await adapter.preflight!(f.actor, { signal: new AbortController().signal })).toMatchObject({ ready: false, reason: "ownership_unresolved" });
    expect(await profiles.getProfile(f.actor.subjectId)).not.toBeNull();
    await profiles.upsertProfile({ ...profile, issuer });
    expect(await adapter.preflight!(f.actor, { signal: new AbortController().signal })).toMatchObject({ ready: false, reason: "ownership_unresolved" });
    const verifiedProfiles = new InMemoryUserProfileStore();
    await verifiedProfiles.upsertProfile({ ...profile, issuer });
    const verified = createCOPSessionsProfilesErasureAdapter({ issuer, sessions, profiles: [verifiedProfiles] });
    expect(await verified.preflight!(f.actor, { signal: new AbortController().signal })).toMatchObject({ ready: true });
  });
  it("requires independently bound persisted store identity rather than adopting an empty replacement", async () => {
    const f = fixture(), storeId = "94f0532a-630a-4775-a47e-bf09a19f7802";
    const bound = new AccountErasureService({ ...f.options, expectedGuardStoreId: storeId, allowUnboundSyntheticStore: false });
    await expect(bound.init()).rejects.toMatchObject({ code: "ERASURE_STORE_ID_MISMATCH" });
    await f.store.transact([], tx => tx.set("account-safety:store-identity-v1", { storeId }));
    await bound.init();
    const wrong = new AccountErasureService({ ...f.options, expectedGuardStoreId: "wrong-store", allowUnboundSyntheticStore: false });
    await expect(wrong.init()).rejects.toMatchObject({ code: "ERASURE_STORE_ID_MISMATCH" });
  });
});

it("ignores a timed-out late reply and retries the same idempotent provider operation", async () => {
  const f = fixture(); let release!: () => void; const late = new Promise<void>(resolve => { release = resolve; });
  let effectiveCleanups = 0; const remoteCompleted = new Set<string>();
  f.adapters[0]!.erase = async (_actor, context) => {
    if (!remoteCompleted.has(context.operationId)) {
      remoteCompleted.add(context.operationId); effectiveCleanups += 1;
      await late; // The remote cleanup completed; its response ignores local cancellation.
    }
    return { status: "completed" as const, proofId: "idempotent_remote_proof_v1" };
  };
  const service = new AccountErasureService({ ...f.options, adapterTimeoutMs: 20 });
  const prepared = await service.preflight(f.actor, operation);
  await expect(service.request(f.actor, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! })).rejects.toMatchObject({ status: 503 });
  expect((await service.readWithCapability(operation, prepared.capability!)).remaining).toEqual(["keycloak"]);
  await service.resumePending();
  const terminal = await service.readWithCapability(operation, prepared.capability!);
  expect(terminal.accountDeleted).toBe(true); expect(effectiveCleanups).toBe(1);
  release(); await late; await new Promise(resolve => setImmediate(resolve));
  expect(await service.readWithCapability(operation, prepared.capability!)).toEqual(terminal);
});
