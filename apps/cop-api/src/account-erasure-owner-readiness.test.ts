import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";
import type { AccountErasureContinuity, AccountErasureReplay } from "./account-erasure-continuity.js";
import { registerAccountErasureRoutes } from "./account-erasure-routes.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { clearJwksCacheForTests, requireBearerToken } from "./security.js";

const issuer = "https://identity.owner-readiness.test/realms/cop", storeId = "90c013af-df82-4cca-9a5a-8854027a2c49";
const secret = "synthetic-owner-readiness-identity-secret-32-plus", operation = "1ea3db0e-90e8-4c38-bbfb-18990ec9ce5e";
const originalEnv = { ...process.env };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
afterEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const store = new MemoryMobilityStore(), now = new Date();
  await store.transact([], tx => tx.set("account-safety:store-identity-v1", { storeId }));
  const replay: AccountErasureReplay = { contractVersion: "cop-erasure-replay-v1", applicationStoreId: storeId,
    configurationFingerprint: createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret).digest("hex"),
    frontier: { sequence: 0, digest: "0".repeat(64) }, entries: [],
    datasetBinding: { incarnationId: "68370110-e066-4127-8d39-5f66038b28d9", restoreGeneration: 1 } };
  // A synthetic controller port, never an actual provider/whole acceptance claim.
  const continuity: AccountErasureContinuity = { requiresDatasetBinding: true,
    snapshot: vi.fn(async () => structuredClone(replay)),
    assertCurrent: vi.fn(async () => ({ validUntil: new Date(Date.now() + 5000).toISOString() })),
    publishFence: vi.fn(async entry => ({ frontier: replay.frontier, entry })) };
  const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: vi.fn(async () => true),
    preflight: vi.fn(async () => ({ ready: true as const, version: "synthetic_owner_readiness" })),
    erase: vi.fn(async () => ({ status: "completed" as const, proofId: "synthetic_never_erased" })) }));
  const options = { store, identitySecret: secret, issuer, expectedGuardStoreId: storeId, continuityRequired: true,
    continuity, accepted: false, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters };
  const service = new AccountErasureService(options);
  await service.init();
  const before = await store.transact([], tx => tx.scan(""));
  const actor = { authMode: "oidc" as const, issuer, subjectId: "synthetic-a", username: "", displayName: "", authTime: Math.floor(now.getTime() / 1000) };
  return { store, replay, continuity, adapters, options, service, before, actor };
}
async function http(f: Awaited<ReturnType<typeof fixture>>, service: AccountErasureService | undefined = f.service) {
  process.env.COP_AUTH_MODE = "oidc"; process.env.COP_OIDC_ISSUER = issuer;
  process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web"; process.env.COP_OIDC_REQUIRED_ROLE = "";
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: "synthetic-owner-readiness", use: "sig" }] }), { headers: { "content-type": "application/json" } })));
  const now = Math.floor(Date.now() / 1000), header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-owner-readiness", typ: "JWT" })).toString("base64url"),
    payload = Buffer.from(JSON.stringify({ iss: issuer, sub: f.actor.subjectId, azp: "cop-web", iat: now, exp: now + 300, auth_time: now })).toString("base64url"),
    body = header + "." + payload, signature = createSign("RSA-SHA256").update(body).end().sign(privateKey).toString("base64url");
  const app = Fastify(); await app.register(rateLimit, { global: true, max: 100 });
  app.addHook("onRequest", requireBearerToken); registerAccountErasureRoutes(app, service);
  return { app, headers: { authorization: "Bearer " + body + "." + signature } };
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.store.transact([], tx => tx.scan(""))).toEqual(f.before);
  expect(f.continuity.publishFence).not.toHaveBeenCalled();
  for (const adapter of f.adapters) { expect(adapter.preflight).not.toHaveBeenCalled(); expect(adapter.erase).not.toHaveBeenCalled(); }
}

describe("read-only owner readiness while new COP erasure intake is disabled", () => {
  it("checks all eleven actual adapter ports and continuity without accepting, initializing or fencing", async () => {
    const f = await fixture(), init = vi.spyOn(f.service, "init");
    expect(await f.service.ownerReadiness()).toMatchObject({ contractVersion: "cop-account-erasure-owner-readiness-v1", ready: true });
    expect((await f.service.capabilities())).toEqual({ contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_accepted" });
    expect(init).not.toHaveBeenCalled();
    f.adapters.forEach(adapter => expect(adapter.ready).toHaveBeenCalledTimes(1));
    await unchanged(f);
  });
  it("never initializes missing local configuration during the diagnostic read", async () => {
    const f = await fixture(); await f.store.transact([], tx => tx.remove("account-erasure:configuration-v1"));
    const before = await f.store.transact([], tx => tx.scan(""));
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    expect(await f.store.transact([], tx => tx.scan(""))).toEqual(before);
    expect(f.continuity.publishFence).not.toHaveBeenCalled();
  });
  it("fails closed for a missing owner, false/throwing owner and unavailable or changed independent journal", async () => {
    const f = await fixture(), missing = new AccountErasureService({ ...f.options, adapters: f.adapters.slice(1) });
    expect(await missing.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "required_adapters_missing" });
    f.adapters[3]!.ready.mockResolvedValue(false);
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    f.adapters[3]!.ready.mockRejectedValueOnce(new Error("private synthetic provider failure"));
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    f.adapters[3]!.ready.mockResolvedValue(true);
    vi.mocked(f.continuity.snapshot).mockRejectedValueOnce(new Error("synthetic guard outage"));
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    f.adapters[2]!.ready.mockImplementation(async () => { f.replay.frontier.sequence++; return true; });
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    await unchanged(f);
  });
  it("rejects mismatched dataset binding without rewriting it or accepting copied completion", async () => {
    const f = await fixture(); f.replay.datasetBinding!.restoreGeneration++;
    expect(await f.service.ownerReadiness()).toMatchObject({ ready: false, unavailableReason: "adapter_unavailable" });
    await unchanged(f);
  });
  it("preserves default HTTP capability and reports ready separately while confirmation and preflight stay503", async () => {
    const f = await fixture(), { app, headers } = await http(f);
    try {
      const normal = await app.inject({ url: "/api/v1/me/account-deletion/capabilities", headers });
      expect(normal.statusCode).toBe(200); expect(normal.json()).toEqual({ contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_accepted" });
      const checked = await app.inject({ url: "/api/v1/me/account-deletion/capabilities?includeOwnerReadiness=true", headers });
      expect(checked.statusCode).toBe(200); expect(checked.headers["cache-control"]).toBe("no-store");
      expect(checked.json()).toMatchObject({ ...normal.json(), ownerReadiness: { contractVersion: "cop-account-erasure-owner-readiness-v1", ready: true } });
      expect(Number.isFinite(Date.parse(checked.json().ownerReadiness.checkedAt))).toBe(true);
      for (const suffix of ["", "/preflight"]) {
        const r = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion" + suffix, headers: { ...headers, "idempotency-key": operation }, payload: suffix ? {} : { confirmAccountDeletion: true } });
        expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe("ERASURE_NOT_READY");
      }
      await unchanged(f);
    } finally { await app.close(); }
  });
  it("reports unavailable ports independently from the disabled acceptance switch", async () => {
    const f = await fixture(); f.adapters[1]!.ready.mockResolvedValue(false); const { app, headers } = await http(f);
    try { const r = await app.inject({ url: "/api/v1/me/account-deletion/capabilities?includeOwnerReadiness=true", headers });
      expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ accountDeletion: false, unavailableReason: "not_accepted", ownerReadiness: { ready: false, unavailableReason: "adapter_unavailable" } }); await unchanged(f);
    } finally { await app.close(); }
  });
  it.each(["includeOwnerReadiness=false", "includeOwnerReadiness=1", "includeOwnerReadiness=TRUE", "includeOwnerReadiness=true&includeOwnerReadiness=true", "other=true", "includeOwnerReadiness=true&other=1"])("rejects noncanonical diagnostic query %s", async query => {
    const f = await fixture(), { app, headers } = await http(f);
    try { const r = await app.inject({ url: "/api/v1/me/account-deletion/capabilities?" + query, headers }); expect(r.statusCode).toBe(400); f.adapters.forEach(a => expect(a.ready).not.toHaveBeenCalled()); await unchanged(f); }
    finally { await app.close(); }
  });
  it.each([undefined, "Bearer malformed", "Bearer dev-lab-token"])("requires ordinary signature-verified OIDC authentication (%s)", async authorization => {
    const f = await fixture(), { app } = await http(f);
    try { const r = await app.inject({ url: "/api/v1/me/account-deletion/capabilities?includeOwnerReadiness=true", headers: authorization ? { authorization } : {} }); expect(r.statusCode).toBe(401); f.adapters.forEach(a => expect(a.ready).not.toHaveBeenCalled()); await unchanged(f); }
    finally { await app.close(); }
  });
  it("limits expensive diagnostic checks to five per minute while default capability remains available", async () => {
    const f = await fixture(), { app, headers } = await http(f);
    try {
      for (let i = 0; i < 5; i++) expect((await app.inject({ url: "/api/v1/me/account-deletion/capabilities?includeOwnerReadiness=true", headers })).statusCode).toBe(200);
      const blocked = await app.inject({ url: "/api/v1/me/account-deletion/capabilities?includeOwnerReadiness=true", headers }); expect(blocked.statusCode).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect((await app.inject({ url: "/api/v1/me/account-deletion/capabilities", headers })).statusCode).toBe(200);
      f.adapters.forEach(a => expect(a.ready).toHaveBeenCalledTimes(5)); await unchanged(f);
    } finally { await app.close(); }
  });
});
