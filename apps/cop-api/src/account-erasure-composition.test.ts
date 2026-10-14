import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { buildServer, type BuildServerOptions } from "./server.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

const issuer = "https://identity.composition.test/realms/cop";
const operationId = "69376c34-6b32-4ed7-8348-f1d3c737e72e";
type RestoreAdapter = NonNullable<BuildServerOptions["backupRestoreErasureAdapter"]>;

function restoreAdapter(): RestoreAdapter {
  return {
    id: "backup_restore",
    ready: vi.fn(async () => false),
    preflight: vi.fn(async () => ({ ready: false as const, reason: "adapter_unavailable" as const })),
    erase: vi.fn(async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }))
  };
}

function environment(): void {
  for (const [key, value] of Object.entries({
    COP_DATABASE_URL: "", COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer,
    COP_ACCOUNT_ERASURE_SECRET: "synthetic-composition-erasure-secret-32-plus",
    COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false",
    COP_ACCOUNT_SAFETY_STORE_ID: "", COP_ALLOW_LAB_TOKEN: "false",
    COP_SHARED_MOBILITY_ENABLED: "false", COP_PRIVATE_DISPATCH_ENABLED: "false",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_DRIVER_MEASUREMENTS_ENABLED: "false",
    COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED: "false", COP_MEDIA_STORE: "disabled"
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No provider access in composition fixtures"); }));
}

function captureComposition(): () => AccountErasureService {
  const services: AccountErasureService[] = [];
  const init = AccountErasureService.prototype.init;
  vi.spyOn(AccountErasureService.prototype, "init").mockImplementation(function (this: AccountErasureService) {
    services.push(this);
    return init.call(this);
  });
  return () => {
    expect(services.length).toBeGreaterThan(0);
    return services[0]!;
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("additive account restore owner composition", () => {
  it("preserves the actual local stores, adapter effects and shared transaction store", async () => {
    environment();
    const captured = captureComposition(), store = new MemoryMobilityStore();
    const profiles = new InMemoryUserProfileStore(), sessions = new InMemoryWebSessionStore();
    const now = new Date(), expiry = new Date(now.getTime() + 60_000);
    for (const subjectId of ["synthetic-a", "synthetic-b"]) {
      await profiles.upsertProfile({ issuer, subjectId, displayName: subjectId, username: subjectId,
        preferences: {}, alertPreferences: {} });
    }
    const session = async (subjectId: string) => sessions.create({ accessToken: "synthetic-no-provider-token",
      accessTokenExpiresAt: expiry, profile: { issuer, subjectId, name: subjectId, username: subjectId } }, expiry);
    const first = await session("synthetic-a"), second = await session("synthetic-b");
    const backup = restoreAdapter();
    const app = buildServer({ mobilityStore: store, userProfileStore: profiles, webSessionStore: sessions,
      backupRestoreErasureAdapter: backup });
    try {
      await app.ready();
      const service = captured(), ids = service.options.adapters.map(adapter => adapter.id);
      expect(service.options.store).toBe(store);
      expect(ids).toEqual(expect.arrayContaining(["cop_sessions_profiles", "cop_devices", "cop_content_media",
        "voice_livekit", "mobility_dispatch", "messaging_matrix", "ai_router", "sim_measurements", "backup_restore"]));
      expect(ids.filter(id => id === "backup_restore")).toHaveLength(1);
      expect(service.options.adapters.find(adapter => adapter.id === "backup_restore")).toBe(backup);
      expect((await service.capabilities()).accountDeletion).toBe(false);
      const local = service.options.adapters.find(adapter => adapter.id === "cop_sessions_profiles")!;
      expect(await local.erase({ authMode: "oidc", issuer, subjectId: "synthetic-a", username: "", displayName: "" },
        { operationId, requestedAt: now.toISOString(), accountKey: "a".repeat(64), signal: AbortSignal.timeout(1000) })).toMatchObject({ status: "completed" });
      expect(await profiles.getProfile("synthetic-a")).toBeNull();
      expect(await sessions.get(first.sessionId)).toBeNull();
      expect(await profiles.getProfile("synthetic-b")).not.toBeNull();
      expect(await sessions.get(second.sessionId)).not.toBeNull();
      expect(backup.erase).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("keeps the existing standalone full adapter override", async () => {
    environment();
    const captured = captureComposition();
    const adapters: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ ...restoreAdapter(), id }));
    const app = buildServer({ accountSafetyStore: new MemoryMobilityStore(), accountErasureAdapters: adapters });
    try {
      await app.ready();
      expect(captured().options.adapters).toBe(adapters);
    } finally { await app.close(); }
  });

  it.each(["ai_router", null])("rejects an invalid additive owner %s before constructing the server", id => {
    const value = id === null ? null : { ...restoreAdapter(), id };
    expect(() => buildServer({ backupRestoreErasureAdapter: value as unknown as RestoreAdapter }))
      .toThrow("The additive restore adapter must own backup_restore.");
  });

  it("rejects a simultaneous full adapter override", () => {
    expect(() => buildServer({ backupRestoreErasureAdapter: restoreAdapter(), accountErasureAdapters: [] }))
      .toThrow("The additive restore adapter cannot be combined with a full account erasure override.");
  });

  it("rejects a simultaneous prebuilt erasure service", () => {
    const service = new AccountErasureService({ store: new MemoryMobilityStore(), issuer,
      identitySecret: "synthetic-composition-erasure-secret-32-plus", requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
      adapters: [], accepted: false });
    expect(() => buildServer({ backupRestoreErasureAdapter: restoreAdapter(), accountErasure: service }))
      .toThrow("The additive restore adapter cannot be combined with a full account erasure override.");
  });
});
