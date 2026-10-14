import { afterEach, expect, it, vi } from "vitest";
import { createSimMeasurementsAccountErasureAdapter, type SimMeasurementsErasureOptions } from "./sim-account-erasure.js";
import { createCOPDriverMeasurementsErasureAdapter } from "./cop-driver-consent-erasure.js";
import { InMemoryDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import { buildServer } from "./server.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";

const issuer = "https://identity.consent-http.test/realms/cop", secret = "synthetic-consent-http-secret-32-plus";
const owner = { issuer, subjectId: "synthetic-owner-a" }, actor = { ...owner, authMode: "oidc" as const, username: "", displayName: "" };
const op = "69795c63-e2e8-4b1e-8f5e-1df816645d94", now = new Date("2026-10-14T12:00:00.000Z");
const context = () => ({ operationId: op, accountKey: "synthetic-cop-account-key", requestedAt: now.toISOString(), signal: new AbortController().signal });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function fixture() {
  let enabled = true, authority = true, pending = false;
  let receipt: Record<string, unknown> | undefined, manifest: string | undefined;
  const calls: Array<{ method: string; path: string; subject?: string; body?: Record<string, unknown> }> = [];
  const base = "https://sim-driver.synthetic.test", path = "/api/v1/internal/driver-measurements/v1/account-erasure-operations";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: RequestInit) => {
    const url = new URL(input), headers = init.headers as Record<string, string>;
    const claim = headers["x-cop-actor"] ? JSON.parse(Buffer.from(headers["x-cop-actor"], "base64url").toString()) as Record<string, string> : undefined;
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const call = { method: init.method!, path: url.pathname, subject: claim?.sub, body }; calls.push(call);
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    if (url.origin !== base || !url.pathname.startsWith(path)) throw new Error("No external provider access");
    if (url.pathname.endsWith("/capability") || url.pathname.endsWith("/preflight")) {
      const isActor = url.pathname.endsWith("/preflight");
      const checks = { schemaReady: true, permissionsReady: true, identityReviewed: true, restoreCheckpointCurrent: true, retentionReviewed: true, publicationFenceVerified: true,
        ...(isActor ? { identityBindingReviewed: true, manifestShapeAndCoverageValid: true } : {}) };
      if (receipt && isActor && JSON.stringify(body) !== manifest) return reply({}, 409);
      return reply({ contractVersion: "sim-account-erasure-v1", owner: "sim_measurements", scope: "online_driver_scope", enabled, ready: enabled,
        checkedAt: now.toISOString(), blockers: enabled ? [] : ["erasure_disabled"], mutates: false, providerCalls: false, wholeAccountComplete: false, checks, reportProtection: "no_report",
        ...(isActor ? { operationId: op, identityBinding: "cop_attested_daily_manifest", contributorCount: (body!.contributors as unknown[]).length, manifestValid: true,
          coverageAnchor: { kind: receipt ? "first_accepted_at" : "checked_at", at: now.toISOString() } } : {}) });
    }
    if (init.method === "GET") {
      if (!receipt || claim?.sub !== owner.subjectId || url.pathname !== path + "/" + op) return reply({}, 404);
      return pending ? reply({ ...receipt, status: "pending", pendingReason: "derived_report_pending", derivedReportAcknowledged: false }, 202) : reply(receipt);
    }
    if (url.pathname !== path || claim?.sub !== owner.subjectId) return reply({}, 404);
    manifest = JSON.stringify(body);
    receipt = { contractVersion: "sim-account-erasure-v1", operationId: op, status: "completed", scope: "online_driver_scope", wholeAccountComplete: false, backupReplayRequired: true,
      acceptedAt: now.toISOString(), updatedAt: now.toISOString(), contributorCount: (body!.contributors as unknown[]).length, deletedBatchCount: 1, remainingBatchCount: 0,
      databaseZeroVerified: true, derivedReportAcknowledged: true, reportProtection: "no_report", publicationFenceVerified: true, replayReady: true, retentionReviewed: true, pendingReason: null };
    return reply(receipt);
  }));
  const options: SimMeasurementsErasureOptions = { issuer, baseUrl: base, token: "synthetic-service-token-32-plus-characters", actorSecret: secret, userIdSecret: secret, now: () => now,
    verifyConfiguredOwner: async () => authority, reviewExistingIdentity: async () => ({ reviewed: true, version: "a".repeat(64) }),
    inventory: async () => ({ version: "b".repeat(64), retainedComplete: true, outboxComplete: true, keyVersionsComplete: true, retainedDays: [], outboxDays: [], keys: [{ version: "synthetic-v1", secret }] }) };
  return { options, calls, disable: () => { enabled = false; }, outage: () => { authority = false; }, pending: () => { pending = true; } };
}
it("normal verified coverage and fresh completed GET have the same versioned proof; GET cannot admit foreign/pending/unavailable work", async () => {
  const f = fixture(), adapter = createSimMeasurementsAccountErasureAdapter(f.options);
  const original = await adapter.erase(actor, context()); expect(original.status).toBe("completed");
  f.calls.length = 0;
  expect(await adapter.verifiedCompletedOperationProof(actor, context())).toEqual(original);
  expect(f.calls.map(value => value.method)).toEqual(["GET"]);
  expect(f.calls[0]!.body).toBeUndefined();
  expect((await adapter.verifiedCompletedOperationProof({ ...actor, subjectId: "synthetic-other" }, context())).status).toBe("pending");
  expect((await adapter.verifiedCompletedOperationProof(actor, { ...context(), operationId: "c451b31f-e89d-415b-b9d1-9a47c31a18b3" })).status).toBe("pending");
  await expect(adapter.verifiedCompletedOperationProof({ ...actor, issuer: "https://wrong.test" }, context())).rejects.toMatchObject({ status: 401 });
  f.pending(); expect((await adapter.verifiedCompletedOperationProof(actor, context())).status).toBe("pending");
  f.outage(); const before = f.calls.length;
  expect((await adapter.verifiedCompletedOperationProof(actor, context())).status).toBe("pending"); expect(f.calls).toHaveLength(before);
});
it("sends historical COP pending dates in the actual manifest, clears them after completion, and resumes with only a verified GET", async () => {
  const f = fixture(), store = new InMemoryDriverMeasurementConsentStore(); await store.init(secret);
  await store.grant(owner.subjectId, new Date("2026-10-01T12:00:00Z"), owner);
  await store.revoke(owner.subjectId, new Date("2026-10-04T12:00:00Z"), owner);
  const originalDays = (await store.get(owner.subjectId)).pendingDays;
  const adapter = createCOPDriverMeasurementsErasureAdapter(f.options, store);
  const completed = await adapter.erase(actor, context()); expect(completed.status).toBe("completed");
  const posted = f.calls.find(value => value.method === "POST" && !value.path.endsWith("preflight"))!.body!;
  const ids = posted.contributors as Array<{ contributorDay: string; contributorIdDay: string }>;
  for (const day of originalDays) expect(ids).toContainEqual({ contributorDay: day, contributorIdDay: contributorIdDay(secret, owner.subjectId, day) });
  expect((await store.erasureCheckpoint(owner, op))?.pendingDays).toEqual([]);
  expect(JSON.stringify(posted)).not.toContain(owner.subjectId); expect(JSON.stringify(posted)).not.toContain(secret);
  f.disable(); f.calls.length = 0;
  expect(await adapter.readyForAcceptedOperation!(actor, context())).toBe(true);
  expect(await adapter.erase(actor, context())).toEqual(completed);
  expect(f.calls.every(value => value.method === "GET" && !value.path.endsWith("preflight"))).toBe(true);
});
it("initializes and closes the actual erasure-only consent dependency with collection and normal cleanup both off", async () => {
  for (const [name, value] of Object.entries({ COP_DRIVER_MEASUREMENTS_ENABLED: "false", COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED: "false", COP_ACCOUNT_ERASURE_ENABLED: "false",
    COP_ACCOUNT_ERASURE_SECRET: secret, COP_DRIVER_MEASUREMENTS_HASH_SECRET: secret, COP_OIDC_ISSUER: issuer, COP_SHARED_MOBILITY_ENABLED: "false" })) vi.stubEnv(name, value);
  const store = new InMemoryDriverMeasurementConsentStore(), init = vi.spyOn(store, "init"), close = vi.spyOn(store, "close"), pending = vi.spyOn(store, "pending");
  const app = buildServer({ driverMeasurementConsentStore: store, accountSafetyStore: new MemoryMobilityStore() });
  try {
    expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
    expect(init).toHaveBeenCalledTimes(1); expect(init).toHaveBeenCalledWith(secret); expect(pending).not.toHaveBeenCalled();
  } finally { await app.close(); }
  expect(close).toHaveBeenCalledTimes(1);
});
it("awaits actual global fence loading before normal cleanup starts and refuses unavailable binding at startup", async () => {
  for (const [name, value] of Object.entries({ COP_DRIVER_MEASUREMENTS_ENABLED: "false", COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED: "true", COP_ACCOUNT_ERASURE_ENABLED: "false",
    COP_ACCOUNT_ERASURE_SECRET: secret, COP_DRIVER_MEASUREMENTS_HASH_SECRET: secret, COP_OIDC_ISSUER: issuer, COP_SHARED_MOBILITY_ENABLED: "false" })) vi.stubEnv(name, value);
  const guardStore = new MemoryMobilityStore();
  const service = new AccountErasureService({ store: guardStore, issuer, identitySecret: secret, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: false, allowUnboundSyntheticStore: true });
  const store = new InMemoryDriverMeasurementConsentStore(), originalPending = store.pending.bind(store);
  const pending = vi.spyOn(store, "pending").mockImplementation(async () => { expect(service.cachedGuardReady()).toBe(true); return originalPending(); });
  const actualInit = service.init.bind(service);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(service, "init").mockImplementationOnce(async () => { enter(); await held; return actualInit(); });
  const source = { send: vi.fn(async () => { throw new Error("No measurement intake in test"); }), delete: vi.fn(async () => undefined) };
  const app = buildServer({ driverMeasurementConsentStore: store, driverMeasurementSource: source, accountSafetyStore: guardStore, accountErasure: service });
  try {
    const ready = app.ready(); await entered; expect(pending).not.toHaveBeenCalled();
    release(); await ready; expect(pending).toHaveBeenCalledTimes(1); expect(source.send).not.toHaveBeenCalled(); expect(source.delete).not.toHaveBeenCalled();
  } finally { release(); await app.close(); }
  const unavailableStore = new MemoryMobilityStore();
  const unavailable = new AccountErasureService({ store: unavailableStore, issuer, identitySecret: secret, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: false,
    expectedGuardStoreId: "660d672d-0e50-4b3d-8cba-4e5e6bb29997" });
  const denied = new InMemoryDriverMeasurementConsentStore(), deniedPending = vi.spyOn(denied, "pending");
  const failedApp = buildServer({ driverMeasurementConsentStore: denied, driverMeasurementSource: source, accountSafetyStore: unavailableStore, accountErasure: unavailable });
  try { await expect(failedApp.ready()).rejects.toMatchObject({ code: "ERASURE_STORE_ID_MISMATCH" }); expect(deniedPending).not.toHaveBeenCalled(); }
  finally { await failedApp.close(); }
});
